package com.qoder.samples.streaming;

import com.qoder.sdk.MessageCursor;
import com.qoder.sdk.QoderClient;
import com.qoder.sdk.QoderSession;
import com.qoder.sdk.SessionOptions;
import com.qoder.sdk.UserInput;
import com.qoder.sdk.auth.Auth;
import com.qoder.sdk.json.JsonObject;
import com.qoder.sdk.json.JsonValue;
import com.qoder.sdk.message.AssistantMessage;
import com.qoder.sdk.message.PartialMessage;
import com.qoder.sdk.message.ResultMessage;
import com.qoder.sdk.message.ResultOutcome;
import com.qoder.sdk.message.SdkMessage;
import com.qoder.sdk.model.ModelId;
import com.qoder.sdk.model.ModelSelection;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

public final class StreamingChat {
    static final class Renderer {
        private final PrintStream output;
        private boolean streamedMessage;
        int deltas;

        Renderer(PrintStream output) { this.output = output; }

        void accept(SdkMessage message) {
            if (message instanceof PartialMessage) {
                JsonValue raw = JsonValue.parse(message.rawJson().orElse("{}"));
                JsonValue eventValue = raw.isObject() ? raw.asObject().get("event") : null;
                if (eventValue == null || !eventValue.isObject()) return;
                JsonObject event = eventValue.asObject();
                JsonValue type = event.get("type");
                if (type != null && type.isString() && "message_start".equals(type.asString())) {
                    streamedMessage = false;
                }
                JsonValue delta = event.get("delta");
                if (delta != null && delta.isObject()) {
                    JsonValue kind = delta.asObject().get("type");
                    JsonValue text = delta.asObject().get("text");
                    if (kind != null && kind.isString() && "text_delta".equals(kind.asString())
                            && text != null && text.isString() && !text.asString().isEmpty()) {
                        output.print(text.asString());
                        output.flush();
                        streamedMessage = true;
                        deltas++;
                    }
                }
            } else if (message instanceof AssistantMessage) {
                if (!streamedMessage) output.print(((AssistantMessage) message).getText());
                // The next assistant message may use only full-message delivery.
                streamedMessage = false;
            }
        }
    }

    static int readTurn(MessageCursor cursor, PrintStream output) {
        Renderer renderer = new Renderer(output);
        while (cursor.hasNext()) {
            SdkMessage message = cursor.next();
            renderer.accept(message);
            if (message instanceof ResultMessage) {
                ResultOutcome outcome = ((ResultMessage) message).outcome();
                if (outcome != ResultOutcome.SUCCESS) throw new IllegalStateException("Turn failed: " + outcome);
                output.println();
                return renderer.deltas;
            }
        }
        throw new IllegalStateException("Session ended before the turn result.");
    }

    public static void run(Path workspace, List<String> prompts) throws Exception {
        SessionOptions options = SessionOptions.builder().workingDirectory(workspace)
                .modelSelection(ModelSelection.staticModel(ModelId.of("auto")))
                .tools(Arrays.asList("Read", "Glob", "Grep")).allowedTools(Arrays.asList("Read", "Glob", "Grep"))
                .includePartialMessages(true).maxTurns(6).build();
        try (QoderClient client = QoderClient.builder().auth(Auth.accessTokenEnv()).build();
             QoderSession session = client.openSession(options).toCompletableFuture().get();
             MessageCursor cursor = session.messages().openCursor()) {
            BufferedReader input = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
            int index = 0;
            int turns = 0;
            int deltas = 0;
            while (true) {
                String prompt;
                if (prompts.isEmpty()) {
                    System.out.print("you> ");
                    prompt = input.readLine();
                    if (prompt == null || prompt.trim().isEmpty() || "/exit".equals(prompt.trim())) break;
                } else {
                    if (index == prompts.size()) break;
                    prompt = prompts.get(index++);
                    if (prompt.trim().isEmpty()) throw new IllegalArgumentException("Empty prompt.");
                }
                session.send(UserInput.text(prompt)).toCompletableFuture().get();
                deltas += readTurn(cursor, System.out);
                turns++;
            }
            session.completeInput().toCompletableFuture().get();
            System.out.println("[stream] completed turns: " + turns + ", text deltas: " + deltas);
        }
    }

    public static void main(String[] args) {
        try {
            Path workspace = Paths.get(".").toAbsolutePath().normalize();
            List<String> prompts = new ArrayList<String>();
            for (int i = 0; i < args.length; i++) {
                if ("--workspace".equals(args[i])) {
                    if (++i == args.length) throw new IllegalArgumentException("--workspace requires a path.");
                    workspace = Paths.get(args[i]).toAbsolutePath().normalize();
                } else prompts.add(args[i]);
            }
            run(workspace, prompts);
        } catch (Exception failure) {
            System.err.println("Streaming chat failed (" + failure.getClass().getSimpleName() + ").");
            System.exit(1);
        }
    }
}
