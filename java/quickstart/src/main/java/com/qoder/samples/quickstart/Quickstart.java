package com.qoder.samples.quickstart;

import com.qoder.sdk.MessageCursor;
import com.qoder.sdk.OneShotQueryRequest;
import com.qoder.sdk.QoderClient;
import com.qoder.sdk.QoderQuery;
import com.qoder.sdk.SessionOptions;
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
import java.util.List;

public final class Quickstart {
    private static final String DEFAULT_PROMPT =
            "Explain the purpose of this repository and identify its most important files.";

    private Quickstart() {
    }

    public static void main(String[] args) {
        try {
            Path workspace = Paths.get(args.length == 0 ? "." : args[0])
                    .toAbsolutePath().normalize();
            String prompt = args.length < 2 ? DEFAULT_PROMPT
                    : String.join(" ", Arrays.copyOfRange(args, 1, args.length));
            run(workspace, prompt);
        } catch (RuntimeException failure) {
            // External exception details can contain application data. Log only the type.
            System.err.println("Quickstart failed (" + failure.getClass().getSimpleName()
                    + "). Check the workspace, PAT, network access, and CLI version; see README.md.");
            System.exit(1);
        }
    }

    public static void run(Path workspace, String prompt) {
        OneShotQueryRequest request = request(workspace, prompt);
        try (QoderClient client = QoderClient.builder().auth(Auth.accessTokenEnv()).build()) {
            QoderQuery query = client.query(request);
            consume(query.messages().openCursor(), System.out);
        }
    }

    static OneShotQueryRequest request(Path workspace, String prompt) {
        if (!Files.isDirectory(workspace)) {
            throw new IllegalArgumentException("The workspace must be an existing directory.");
        }
        if (prompt == null || prompt.trim().isEmpty()) {
            throw new IllegalArgumentException("The prompt must not be empty.");
        }
        List<String> readOnlyTools = Arrays.asList("Read", "Glob", "Grep");
        return OneShotQueryRequest.builder()
                .prompt(prompt)
                .options(SessionOptions.builder()
                        .workingDirectory(workspace)
                        .modelSelection(ModelSelection.staticModel(ModelId.of("auto")))
                        .tools(readOnlyTools)
                        .allowedTools(readOnlyTools)
                        .maxTurns(4)
                        .build())
                .build();
    }

    static void consume(MessageCursor cursor, PrintStream output) {
        boolean completed = false;
        try (MessageCursor messages = cursor) {
            // Read to EOF: a successful result does not hide a later stream failure.
            while (messages.hasNext()) {
                SdkMessage message = messages.next();
                if (message instanceof AssistantMessage) {
                    output.print(((AssistantMessage) message).getText());
                } else if (message instanceof ResultMessage) {
                    ResultOutcome outcome = ((ResultMessage) message).outcome();
                    if (outcome != ResultOutcome.SUCCESS) {
                        throw new IllegalStateException("Query did not succeed: " + outcome);
                    }
                    completed = true;
                }
            }
            if (!completed) {
                throw new IllegalStateException("The query ended without a success result.");
            }
            output.println();
        }
    }
}
