package com.qoder.samples.hooks;

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
import com.qoder.sdk.hook.HookEvent;
import com.qoder.sdk.hook.HookRegistration;
import com.qoder.sdk.json.JsonObject;
import com.qoder.sdk.json.JsonString;
import com.qoder.sdk.json.JsonValue;
import java.nio.file.Paths;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

public final class Hooks {
    private static final List<String> EVENTS = Arrays.asList(
            "SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "Stop");
    private final Map<String, AtomicInteger> counts = new ConcurrentHashMap<String, AtomicInteger>();

    public Hooks() {
        for (String event : EVENTS) counts.put(event, new AtomicInteger());
    }

    static JsonObject specific(String event, String key, String value) {
        return JsonObject.builder().put("hookSpecificOutput", JsonObject.builder()
                .put("hookEventName", JsonString.of(event)).put(key, JsonString.of(value)).build()).build();
    }

    static JsonValue response(HookEvent event) {
        String name = event.eventName();
        if ("SessionStart".equals(name)) {
            return specific(name, "additionalContext", "This application inspects repositories read-only.");
        }
        if ("UserPromptSubmit".equals(name)) {
            return specific(name, "additionalContext", "Report observed facts; do not propose file changes.");
        }
        if ("PreToolUse".equals(name)) {
            JsonObject payload = event.payload().isObject() ? event.payload().asObject() : JsonObject.empty();
            JsonValue tool = payload.get("tool_name");
            JsonValue input = payload.get("tool_input");
            JsonValue command = input != null && input.isObject() ? input.asObject().get("command") : null;
            boolean allowed = tool != null && tool.isString() && "Bash".equals(tool.asString())
                    && command != null && command.isString()
                    && Arrays.asList("git status --short", "git status --porcelain",
                            "git --no-pager status --short", "git --no-pager status --porcelain")
                            .contains(command.asString().trim());
            return JsonObject.builder().put("hookSpecificOutput", JsonObject.builder()
                    .put("hookEventName", JsonString.of(name))
                    .put("permissionDecision", JsonString.of(allowed ? "allow" : "deny"))
                    .put("permissionDecisionReason", JsonString.of("Only read-only git status is permitted."))
                    .build()).build();
        }
        if ("PostToolUse".equals(name)) {
            return specific(name, "additionalContext", "The host observed completion of this tool call.");
        }
        return JsonObject.empty();
    }

    List<HookRegistration> registrations() {
        java.util.ArrayList<HookRegistration> result = new java.util.ArrayList<HookRegistration>();
        for (String name : EVENTS) {
            HookRegistration.Builder builder = HookRegistration.builder().event(name).handler(event -> {
                counts.get(name).incrementAndGet();
                System.out.println("[hook] " + name); // Never print payloads.
                return CompletableFuture.completedFuture(response(event));
            });
            if ("PreToolUse".equals(name)) builder.matcher("Bash");
            result.add(builder.build());
        }
        return result;
    }

    public static void main(String[] args) {
        try {
            Hooks hooks = new Hooks();
            String prompt = args.length < 2
                    ? "Run exactly `git --no-pager status --short`, read README.md, then describe "
                        + "this repository and its uncommitted changes in two sentences."
                    : String.join(" ", Arrays.copyOfRange(args, 1, args.length));
            query(SessionOptions.builder()
                    .workingDirectory(Paths.get(args.length == 0 ? "." : args[0]).toAbsolutePath().normalize())
                    .modelSelection(ModelSelection.staticModel(ModelId.of("auto")))
                    .tools(Arrays.asList("Read", "Bash")).allowedTools(Arrays.asList("Read", "Bash"))
                    .hooks(hooks.registrations()).maxTurns(4).build(), prompt);
            for (String event : EVENTS) System.out.println(event + ": " + hooks.counts.get(event).get());
        } catch (Exception failure) {
            System.err.println("Hooks failed (" + failure.getClass().getSimpleName() + ").");
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
