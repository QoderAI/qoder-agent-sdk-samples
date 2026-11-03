package com.qoder.samples.permissions;

import com.qoder.sdk.MessageCursor;
import com.qoder.sdk.OneShotQueryRequest;
import com.qoder.sdk.QoderClient;
import com.qoder.sdk.QoderQuery;
import com.qoder.sdk.SessionOptions;
import com.qoder.sdk.auth.Auth;
import com.qoder.sdk.json.JsonObject;
import com.qoder.sdk.json.JsonValue;
import com.qoder.sdk.message.AssistantMessage;
import com.qoder.sdk.message.ResultMessage;
import com.qoder.sdk.message.ResultOutcome;
import com.qoder.sdk.message.SdkMessage;
import com.qoder.sdk.model.ModelId;
import com.qoder.sdk.model.ModelSelection;
import com.qoder.sdk.permission.CancellationToken;
import com.qoder.sdk.permission.PermissionMode;
import com.qoder.sdk.permission.PermissionResult;
import com.qoder.sdk.permission.ToolPermissionRequest;

import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.atomic.AtomicInteger;

public final class ToolPermissions {
    private static final Set<String> COMMANDS = new HashSet<String>(Arrays.asList(
            "git status --short", "git status --porcelain",
            "git --no-pager status --short", "git --no-pager status --porcelain"));

    static PermissionResult authorize(ToolPermissionRequest request, CancellationToken cancellation) {
        if (cancellation.isCancelled()) return PermissionResult.deny("Request cancelled.");
        if (!"Bash".equals(request.toolName()) || !request.toolInput().isObject()) {
            return PermissionResult.deny("Only a read-only git status command is permitted.");
        }
        JsonValue command = request.toolInput().asObject().get("command");
        if (command == null || !command.isString() || !COMMANDS.contains(command.asString().trim())) {
            return PermissionResult.deny("Only a read-only git status command is permitted.");
        }
        // Drop other input fields rather than allowing unreviewed execution options through.
        return PermissionResult.allow(JsonObject.builder().put("command", command).build());
    }

    static SessionOptions options(Path workspace, AtomicInteger callbacks) {
        return SessionOptions.builder().workingDirectory(workspace)
                .modelSelection(ModelSelection.staticModel(ModelId.of("auto")))
                .tools(Arrays.asList("Read", "Glob", "Grep", "Bash"))
                .allowedTools(Arrays.asList("Read", "Glob", "Grep"))
                .permissionMode(PermissionMode.DEFAULT)
                .canUseTool((request, cancellation) -> {
                    callbacks.incrementAndGet();
                    PermissionResult decision = authorize(request, cancellation);
                    // Do not log tool inputs or denial details supplied by external sources.
                    System.out.println("[permission] " + (decision.isAllowed() ? "allowed" : "denied"));
                    return CompletableFuture.completedFuture(decision);
                })
                .maxTurns(3).build();
    }

    public static void main(String[] args) {
        try {
            Path workspace = Paths.get(args.length == 0 ? "." : args[0]).toAbsolutePath().normalize();
            AtomicInteger callbacks = new AtomicInteger();
            query(options(workspace, callbacks),
                    "Run exactly `git --no-pager status --short`, then explain the repository "
                    + "status in one sentence. Do not modify files.");
            System.out.println("[permission] callbacks: " + callbacks.get());
        } catch (Exception failure) {
            System.err.println("Tool permissions failed (" + failure.getClass().getSimpleName() + ").");
            System.exit(1);
        }
    }

    static void query(SessionOptions options, String prompt) {
        try (QoderClient client = QoderClient.builder().auth(Auth.accessTokenEnv()).build()) {
            QoderQuery query = client.query(OneShotQueryRequest.builder()
                    .prompt(prompt).options(options).build());
            boolean completed = false;
            try (MessageCursor cursor = query.messages().openCursor()) {
                while (cursor.hasNext()) {
                    SdkMessage message = cursor.next();
                    if (message instanceof AssistantMessage) {
                        System.out.println(((AssistantMessage) message).getText());
                    } else if (message instanceof ResultMessage) {
                        ResultOutcome outcome = ((ResultMessage) message).outcome();
                        if (outcome != ResultOutcome.SUCCESS) {
                            throw new IllegalStateException("Query did not succeed: " + outcome);
                        }
                        completed = true;
                    }
                }
                if (!completed) throw new IllegalStateException("Missing successful result.");
            }
        }
    }
}
