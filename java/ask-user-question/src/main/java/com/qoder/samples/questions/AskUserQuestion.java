package com.qoder.samples.questions;

import com.qoder.sdk.MessageCursor;
import com.qoder.sdk.OneShotQueryRequest;
import com.qoder.sdk.QoderClient;
import com.qoder.sdk.QoderQuery;
import com.qoder.sdk.SessionOptions;
import com.qoder.sdk.auth.Auth;
import com.qoder.sdk.json.JsonObject;
import com.qoder.sdk.json.JsonString;
import com.qoder.sdk.json.JsonValue;
import com.qoder.sdk.message.ResultMessage;
import com.qoder.sdk.message.ResultOutcome;
import com.qoder.sdk.message.SdkMessage;
import com.qoder.sdk.model.ModelId;
import com.qoder.sdk.model.ModelSelection;
import com.qoder.sdk.permission.CancellationToken;
import com.qoder.sdk.permission.PermissionMode;
import com.qoder.sdk.permission.PermissionResult;
import com.qoder.sdk.permission.ToolPermissionHandler;
import com.qoder.sdk.permission.ToolPermissionRequest;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.atomic.AtomicInteger;

public final class AskUserQuestion {
    static final String DEFAULT_PROMPT = "Use AskUserQuestion exactly once before making a recommendation. "
            + "Ask these two questions:\n"
            + "1. Header \"Environment\": \"Which deployment environment should we use?\" with options "
            + "\"Staging\" and \"Production\"; single-select.\n"
            + "2. Header \"Checks\": \"Which validation checks should run?\" with options \"Unit tests\", "
            + "\"Integration tests\", and \"Security scan\"; multi-select.\n"
            + "After receiving the answers, summarize the choices in one sentence. Do not use other tools.";

    // The handler waits for a person. SDK 0.2.4 fails a permission request that is still pending after
    // controlRequestTimeoutMs (60 seconds by default), so the sample allows ten minutes.
    static final long ANSWER_TIMEOUT_MS = 10 * 60 * 1000L;

    /** A failure this sample detected itself; its message contains no SDK or model output. */
    static final class SampleFailure extends RuntimeException {
        SampleFailure(String message) {
            super(message);
        }
    }

    static final class Option {
        final String label;
        final String description;

        Option(String label, String description) {
            this.label = label;
            this.description = description;
        }
    }

    static final class Question {
        final String question;
        final String header;
        final List<Option> options;
        final boolean multiSelect;

        Question(String question, String header, List<Option> options, boolean multiSelect) {
            this.question = question;
            this.header = header;
            this.options = options;
            this.multiSelect = multiSelect;
        }
    }

    private static String text(JsonValue value) {
        return value != null && value.isString() && !value.asString().trim().isEmpty() ? value.asString() : null;
    }

    static List<Question> parseQuestions(JsonValue input) {
        JsonValue raw = input != null && input.isObject() ? input.asObject().get("questions") : null;
        if (raw == null || !raw.isArray() || raw.asArray().size() == 0) {
            throw new IllegalArgumentException("AskUserQuestion input must contain a non-empty questions array.");
        }
        List<Question> questions = new ArrayList<Question>();
        for (JsonValue rawQuestion : raw.asArray().values()) {
            int number = questions.size() + 1;
            if (!rawQuestion.isObject()) {
                throw new IllegalArgumentException("Question " + number + " must be an object.");
            }
            JsonObject value = rawQuestion.asObject();
            String question = text(value.get("question"));
            if (question == null) throw new IllegalArgumentException("Question " + number + " has no question text.");
            JsonValue rawOptions = value.get("options");
            if (rawOptions == null || !rawOptions.isArray() || rawOptions.asArray().size() < 2) {
                throw new IllegalArgumentException("Question " + number + " needs at least two options.");
            }
            List<Option> options = new ArrayList<Option>();
            for (JsonValue rawOption : rawOptions.asArray().values()) {
                String position = "Option " + (options.size() + 1) + " in question " + number;
                if (!rawOption.isObject()) throw new IllegalArgumentException(position + " must be an object.");
                String label = text(rawOption.asObject().get("label"));
                if (label == null) throw new IllegalArgumentException(position + " has no label.");
                JsonValue description = rawOption.asObject().get("description");
                options.add(new Option(label,
                        description != null && description.isString() ? description.asString() : null));
            }
            String header = text(value.get("header"));
            JsonValue multiSelect = value.get("multiSelect");
            questions.add(new Question(question, header != null ? header : "Question " + number,
                    Collections.unmodifiableList(options),
                    multiSelect != null && multiSelect.isBoolean() && multiSelect.asBoolean()));
        }
        return questions;
    }

    /** Returns the answer for one input line, or null when a numeric selection is invalid. */
    static String answer(Question question, String line) {
        String raw = line.trim();
        if (raw.isEmpty()) return question.options.get(0).label;

        String[] parts = raw.split(",", -1);
        boolean numeric = true;
        for (String part : parts) numeric &= part.trim().matches("[0-9]+");
        if (numeric) {
            if (!question.multiSelect && parts.length != 1) return null;
            List<String> labels = new ArrayList<String>();
            for (String part : parts) {
                int index;
                try {
                    index = Integer.parseInt(part.trim()) - 1;
                } catch (NumberFormatException tooLarge) {
                    return null;
                }
                if (index < 0 || index >= question.options.size()) return null;
                labels.add(question.options.get(index).label);
            }
            return String.join(", ", labels);
        }

        String match = null;
        int matches = 0;
        for (Option option : question.options) {
            if (option.label.toLowerCase(Locale.ROOT).startsWith(raw.toLowerCase(Locale.ROOT))) {
                match = option.label;
                matches++;
            }
        }
        return matches == 1 ? match : raw;
    }

    static String readAnswer(Question question, BufferedReader terminal, PrintStream out) throws IOException {
        out.println();
        out.println("[" + question.header + "] " + question.question);
        for (int index = 0; index < question.options.size(); index++) {
            Option option = question.options.get(index);
            out.println("  " + (index + 1) + ". " + option.label
                    + (option.description == null || option.description.isEmpty() ? "" : " - " + option.description));
        }
        out.println(question.multiSelect
                ? "  Enter comma-separated numbers, or type a custom answer."
                : "  Enter one number, or type a custom answer.");
        while (true) {
            out.print("  > ");
            out.flush();
            String line = terminal.readLine();
            if (line == null) throw new SampleFailure("Terminal input ended before the question was answered.");
            String answer = answer(question, line);
            if (answer != null) return answer;
            out.println("  Invalid selection; try again.");
        }
    }

    static PermissionResult respond(ToolPermissionRequest request, CancellationToken cancellation,
                                    BufferedReader terminal, PrintStream out, AtomicInteger answered) {
        String tool = request.toolName();
        if (!"AskUserQuestion".equals(tool) && !"ask_user".equals(tool)) {
            return PermissionResult.deny("This sample handles only AskUserQuestion, not " + tool + ".");
        }
        try {
            List<Question> questions = parseQuestions(request.toolInput());
            JsonObject.Builder answers = JsonObject.builder();
            for (Question question : questions) {
                if (cancellation.isCancelled()) return PermissionResult.deny("The question was cancelled.");
                answers.put(question.question, JsonString.of(readAnswer(question, terminal, out)));
            }
            // A late answer must not be reported as accepted after the runtime abandoned the request.
            if (cancellation.isCancelled()) return PermissionResult.deny("The question was cancelled.");
            // Keep the original question objects and add answers keyed by the exact question text.
            JsonObject.Builder updated = JsonObject.builder();
            for (Map.Entry<String, JsonValue> member : request.toolInput().asObject().members().entrySet()) {
                updated.put(member.getKey(), member.getValue());
            }
            // Answers count only when the whole request is allowed; a denied request delivers none.
            answered.addAndGet(questions.size());
            return PermissionResult.allow(updated.put("answers", answers.build()).build());
        } catch (IllegalArgumentException | SampleFailure failure) {
            return PermissionResult.deny(failure.getMessage());
        } catch (IOException failure) {
            return PermissionResult.deny("Terminal input could not be read.");
        }
    }

    static SessionOptions options(ToolPermissionHandler handler) {
        return SessionOptions.builder()
                .modelSelection(ModelSelection.staticModel(ModelId.of("auto")))
                .tools(Collections.singletonList("AskUserQuestion"))
                .permissionMode(PermissionMode.DEFAULT)
                .canUseTool(handler)
                .controlRequestTimeoutMs(ANSWER_TIMEOUT_MS)
                .maxTurns(3).build();
    }

    /** Reads to EOF, prints the final result once, and requires a successful terminal result. */
    static void consume(MessageCursor cursor, PrintStream out) {
        boolean completed = false;
        try {
            while (cursor.hasNext()) {
                SdkMessage message = cursor.next();
                if (!(message instanceof ResultMessage)) continue;
                ResultMessage result = (ResultMessage) message;
                if (result.outcome() != ResultOutcome.SUCCESS) {
                    throw new SampleFailure("Query did not succeed: " + result.outcome());
                }
                out.println();
                out.println("assistant> " + result.result().orElse(""));
                completed = true;
            }
        } finally {
            cursor.close();
        }
        if (!completed) throw new SampleFailure("The query ended without a success result.");
    }

    static void run(String prompt, BufferedReader terminal, PrintStream out) {
        AtomicInteger answered = new AtomicInteger();
        // The SDK runs this handler on its callback lane, never on the thread that reads CLI output,
        // so waiting for terminal input here does not stall the message stream.
        ToolPermissionHandler handler = (request, cancellation) ->
                CompletableFuture.completedFuture(respond(request, cancellation, terminal, out, answered));
        try (QoderClient client = QoderClient.builder().auth(Auth.accessTokenEnv()).build()) {
            QoderQuery query = client.query(OneShotQueryRequest.builder()
                    .prompt(prompt).options(options(handler)).build());
            consume(query.messages().openCursor(), out);
        }
        if (answered.get() == 0) {
            throw new SampleFailure("The agent completed without receiving an answer from AskUserQuestion.");
        }
        out.println();
        out.println("Answered " + answered.get() + " question(s).");
    }

    public static void main(String[] args) {
        try {
            run(args.length == 0 ? DEFAULT_PROMPT : String.join(" ", args),
                    new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8)), System.out);
        } catch (SampleFailure failure) {
            System.err.println("Ask user question failed: " + failure.getMessage());
            System.exit(1);
        } catch (Exception failure) {
            // SDK failures report only their type, so raw details and credentials stay out of the log.
            System.err.println("Ask user question failed (" + failure.getClass().getSimpleName() + ").");
            System.exit(1);
        }
    }
}
