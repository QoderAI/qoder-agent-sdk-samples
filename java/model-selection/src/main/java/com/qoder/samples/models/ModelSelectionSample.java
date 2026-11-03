package com.qoder.samples.models;

import com.qoder.sdk.MessageCursor;
import com.qoder.sdk.OneShotQueryRequest;
import com.qoder.sdk.QoderClient;
import com.qoder.sdk.QoderQuery;
import com.qoder.sdk.QoderSession;
import com.qoder.sdk.SessionOptions;
import com.qoder.sdk.auth.Auth;
import com.qoder.sdk.json.JsonNumber;
import com.qoder.sdk.json.JsonObject;
import com.qoder.sdk.json.JsonString;
import com.qoder.sdk.json.JsonValue;
import com.qoder.sdk.message.AssistantMessage;
import com.qoder.sdk.message.ResultMessage;
import com.qoder.sdk.message.ResultOutcome;
import com.qoder.sdk.message.SdkMessage;
import com.qoder.sdk.model.ModelId;
import com.qoder.sdk.model.ModelInfo;
import com.qoder.sdk.model.ModelPolicyResult;
import com.qoder.sdk.model.ModelSelection;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;

public final class ModelSelectionSample {
    static JsonObject object(JsonValue value) {
        return value != null && value.isObject() ? value.asObject() : JsonObject.empty();
    }

    static boolean flag(JsonValue value) {
        return value != null && value.isBoolean() && value.asBoolean();
    }

    static Long positiveInteger(JsonValue value) {
        if (value == null || !value.isNumber()) return null;
        try {
            long number = value.asNumber().longValueExact();
            return number > 0 ? number : null;
        } catch (ArithmeticException invalid) {
            return null;
        }
    }

    // Optional catalog metadata is deliberately parsed defensively: its shape may evolve.
    static final class Choices {
        final List<Long> windows = new ArrayList<Long>();
        final List<String> efforts = new ArrayList<String>();
        Long defaultWindow;
        String defaultEffort;

        Choices(ModelInfo model) {
            JsonObject raw = object(model.raw());
            LinkedHashSet<Long> windowSet = new LinkedHashSet<Long>();
            JsonValue direct = raw.get("availableContextWindows");
            if (direct != null && direct.isArray()) {
                for (JsonValue value : direct.asArray().values()) {
                    Long number = positiveInteger(value);
                    if (number != null) windowSet.add(number);
                }
            }
            defaultWindow = positiveInteger(raw.get("defaultContextWindow"));
            for (JsonValue value : object(raw.get("context_config")).members().values()) {
                JsonObject entry = object(value);
                Long number = positiveInteger(entry.get("token_count"));
                if (number != null) {
                    windowSet.add(number);
                    if (defaultWindow == null && flag(entry.get("is_default"))) defaultWindow = number;
                }
            }
            windows.addAll(windowSet);
            Collections.sort(windows);
            if (!windows.contains(defaultWindow)) defaultWindow = windows.isEmpty() ? null : windows.get(0);

            LinkedHashSet<String> effortSet = new LinkedHashSet<String>();
            JsonValue directEfforts = raw.get("efforts");
            if (directEfforts != null && directEfforts.isArray()) {
                for (JsonValue value : directEfforts.asArray().values()) {
                    if (value.isString() && !value.asString().trim().isEmpty()) effortSet.add(value.asString());
                }
            }
            JsonValue configuredDefault = raw.get("defaultEffort");
            if (configuredDefault != null && configuredDefault.isString()) defaultEffort = configuredDefault.asString();
            JsonObject configured = object(object(object(raw.get("thinking_config")).get("enabled")).get("efforts"));
            for (Map.Entry<String, JsonValue> entry : configured.members().entrySet()) {
                if (entry.getKey().trim().isEmpty() || !entry.getValue().isObject()) continue;
                effortSet.add(entry.getKey());
                if (defaultEffort == null && flag(entry.getValue().asObject().get("is_default"))) {
                    defaultEffort = entry.getKey();
                }
            }
            efforts.addAll(effortSet);
            if (!efforts.contains(defaultEffort)) defaultEffort = efforts.isEmpty() ? null : efforts.get(0);
        }
    }

    static List<ModelInfo> enabled(List<ModelInfo> models) {
        List<ModelInfo> result = new ArrayList<ModelInfo>();
        for (ModelInfo model : models) if (model.isEnabled()) result.add(model);
        if (result.isEmpty()) throw new IllegalStateException("No enabled models in runtime catalog.");
        return result;
    }

    static int selection(String input, List<String> values, int fallback) {
        String value = input.trim();
        if (value.isEmpty()) return fallback;
        try {
            int index = Integer.parseInt(value) - 1;
            if (index >= 0 && index < values.size()) return index;
        } catch (NumberFormatException ignored) { /* also accept a catalog value */ }
        for (int i = 0; i < values.size(); i++) if (values.get(i).equalsIgnoreCase(value)) return i;
        throw new IllegalArgumentException("Select a listed number or value.");
    }

    static int choose(BufferedReader input, String label, List<String> values, int fallback, boolean defaults)
            throws Exception {
        for (int i = 0; i < values.size(); i++) System.out.println((i + 1) + ". " + values.get(i));
        if (defaults) return fallback;
        while (true) {
            System.out.print(label + " [" + (fallback + 1) + "]: ");
            String line = input.readLine();
            if (line == null) throw new IllegalArgumentException("Selection input ended.");
            try { return selection(line, values, fallback); }
            catch (IllegalArgumentException invalid) { System.out.println("Enter a listed number or value."); }
        }
    }

    static ModelPolicyResult policy(ModelInfo selected, Long window, String effort, List<ModelInfo> available) {
        if (!available.isEmpty()) {
            boolean found = false;
            for (ModelInfo model : available) {
                if (model.isEnabled() && model.modelId().equals(selected.modelId())) found = true;
            }
            if (!found) throw new IllegalStateException("Selected model is no longer available.");
        }
        Choices choices = new Choices(selected);
        if (window != null && !choices.windows.contains(window)) throw new IllegalArgumentException("Unknown context window.");
        if (effort != null && !choices.efforts.contains(effort)) throw new IllegalArgumentException("Unknown reasoning effort.");
        JsonObject.Builder parameters = JsonObject.builder();
        if (window != null) parameters.put("contextWindow", JsonNumber.of(window));
        if (effort != null) parameters.put("reasoningEffort", JsonString.of(effort));
        ModelPolicyResult.Builder result = ModelPolicyResult.builder().model(selected.modelId());
        if (window != null || effort != null) result.parameters(parameters.build());
        return result.build();
    }

    public static void main(String[] args) {
        try {
            boolean defaults = false;
            List<String> words = new ArrayList<String>();
            for (String arg : args) {
                if ("--defaults".equals(arg)) defaults = true;
                else words.add(arg);
            }
            List<ModelInfo> models;
            // Close the discovery session before waiting for user input.
            try (QoderClient client = QoderClient.builder().auth(Auth.accessTokenEnv()).build();
                 QoderSession session = client.openSession(SessionOptions.builder()
                         .tools(Collections.<String>emptyList()).build()).toCompletableFuture().get()) {
                models = enabled(session.getAvailableModels().toCompletableFuture().get());
            }
            BufferedReader input = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
            List<String> ids = new ArrayList<String>();
            int defaultModel = 0;
            boolean foundDefault = false;
            for (int i = 0; i < models.size(); i++) {
                ModelInfo model = models.get(i);
                ids.add(model.modelId().value());
                if (!foundDefault && (flag(object(model.raw()).get("isDefault")) || "auto".equals(model.modelId().value()))) {
                    defaultModel = i;
                    foundDefault = true;
                }
            }
            ModelInfo selected = models.get(choose(input, "Model", ids, defaultModel, defaults));
            Choices choices = new Choices(selected);
            List<String> windows = new ArrayList<String>();
            for (Long window : choices.windows) windows.add(window.toString());
            final Long window = windows.isEmpty() ? null : choices.windows.get(choose(input, "Context window",
                    windows, choices.windows.indexOf(choices.defaultWindow), defaults));
            final String effort = choices.efforts.isEmpty() ? null : choices.efforts.get(choose(input, "Reasoning effort",
                    choices.efforts, choices.efforts.indexOf(choices.defaultEffort), defaults));
            System.out.println("Selected: " + selected.modelId().value() + "; context="
                    + (window == null ? "model default" : window) + "; reasoning=" + (effort == null ? "model default" : effort));
            ModelPolicyResult cached = policy(selected, window, effort, Collections.<ModelInfo>emptyList());
            SessionOptions options = SessionOptions.builder().tools(Collections.<String>emptyList()).maxTurns(1)
                    .modelSelection(ModelSelection.policy(selected.modelId(), context -> {
                        policy(selected, window, effort, context.availableModels());
                        System.out.println("[model-policy] using cached selection");
                        return CompletableFuture.completedFuture(cached);
                    })).build();
            query(options, words.isEmpty() ? "Explain in one sentence why applications should select models from runtime metadata."
                    : String.join(" ", words));
        } catch (Exception failure) {
            System.err.println("Model selection failed (" + failure.getClass().getSimpleName() + ").");
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
