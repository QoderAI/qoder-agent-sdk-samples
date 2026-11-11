package com.qoder.samples.subagents;

import com.qoder.sdk.MessageCursor;
import com.qoder.sdk.OneShotQueryRequest;
import com.qoder.sdk.QoderClient;
import com.qoder.sdk.QoderQuery;
import com.qoder.sdk.SessionOptions;
import com.qoder.sdk.agent.AgentDefinition;
import com.qoder.sdk.auth.Auth;
import com.qoder.sdk.message.AssistantMessage;
import com.qoder.sdk.message.ResultMessage;
import com.qoder.sdk.message.ResultOutcome;
import com.qoder.sdk.message.SdkMessage;
import com.qoder.sdk.model.ModelId;
import com.qoder.sdk.model.ModelSelection;

import java.io.PrintStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public final class Subagents {
    static final List<String> READ_ONLY_TOOLS = Collections.unmodifiableList(Arrays.asList("Read", "Glob", "Grep"));
    // A subagent's tools are taken from the session's tool set (CLI 1.1.80): a tool the session does
    // not expose is unavailable to every agent, and an agent whose tool set resolves empty cannot start.
    // The repository tools therefore stay exposed; the prompt keeps the main agent to delegation.
    static final List<String> SESSION_TOOLS = Collections.unmodifiableList(
            Arrays.asList("Agent", "Read", "Glob", "Grep"));
    static final String PROMPT = "Ask architecture-explorer to map the repository, then ask test-strategist to "
            + "design verification for a major dependency upgrade. Do not inspect the repository yourself; "
            + "delegate every inspection to those two agents. Synthesize their findings into a concise "
            + "migration plan with ordered steps and risks.";

    /** A failure this sample detected itself; its message contains no SDK or model output. */
    static final class SampleFailure extends RuntimeException {
        SampleFailure(String message) {
            super(message);
        }
    }

    /** Agents declared in code for this session only; nothing is written to the CLI's agent directories. */
    static Map<String, AgentDefinition> agents() {
        Map<String, AgentDefinition> agents = new LinkedHashMap<String, AgentDefinition>();
        agents.put("architecture-explorer", AgentDefinition.builder()
                .description("Maps the repository architecture and important boundaries.")
                .prompt("Inspect the repository with read-only tools. Report the main modules, their "
                        + "responsibilities, dependencies, and architectural risks. Do not modify files.")
                .tools(READ_ONLY_TOOLS)
                .maxTurns(5)
                .build());
        agents.put("test-strategist", AgentDefinition.builder()
                .description("Evaluates the test strategy for a proposed migration.")
                .prompt("Inspect tests and production code with read-only tools. Identify critical behaviors, "
                        + "coverage gaps, and a practical migration verification plan. Do not modify files.")
                .tools(READ_ONLY_TOOLS)
                .maxTurns(5)
                .build());
        return Collections.unmodifiableMap(agents);
    }

    static OneShotQueryRequest request(Path workspace) {
        if (!Files.isDirectory(workspace)) {
            throw new IllegalArgumentException("The workspace must be an existing directory.");
        }
        return OneShotQueryRequest.builder()
                .prompt(PROMPT)
                .options(SessionOptions.builder()
                        .workingDirectory(workspace)
                        .modelSelection(ModelSelection.staticModel(ModelId.of("auto")))
                        .agents(agents())
                        .tools(SESSION_TOOLS)
                        .allowedTools(SESSION_TOOLS)
                        .maxTurns(8)
                        .build())
                .build();
    }

    /** Prints assistant text, reads to EOF, and requires a successful terminal result. */
    static void consume(MessageCursor cursor, PrintStream out) {
        boolean completed = false;
        try {
            while (cursor.hasNext()) {
                SdkMessage message = cursor.next();
                if (message instanceof AssistantMessage) {
                    out.print(((AssistantMessage) message).getText());
                    out.flush();
                } else if (message instanceof ResultMessage) {
                    ResultOutcome outcome = ((ResultMessage) message).outcome();
                    if (outcome != ResultOutcome.SUCCESS) throw new SampleFailure("Query did not succeed: " + outcome);
                    completed = true;
                }
            }
        } finally {
            cursor.close();
        }
        if (!completed) throw new SampleFailure("The query ended without a success result.");
        out.println();
    }

    static void run(Path workspace, PrintStream out) {
        OneShotQueryRequest request = request(workspace);
        try (QoderClient client = QoderClient.builder().auth(Auth.accessTokenEnv()).build()) {
            QoderQuery query = client.query(request);
            consume(query.messages().openCursor(), out);
        }
    }

    public static void main(String[] args) {
        try {
            run(Paths.get(args.length == 0 ? "." : args[0]).toAbsolutePath().normalize(), System.out);
        } catch (SampleFailure | IllegalArgumentException failure) {
            System.err.println("Subagents failed: " + failure.getMessage());
            System.exit(1);
        } catch (Exception failure) {
            // SDK failures report only their type, so raw details and credentials stay out of the log.
            System.err.println("Subagents failed (" + failure.getClass().getSimpleName() + ").");
            System.exit(1);
        }
    }
}
