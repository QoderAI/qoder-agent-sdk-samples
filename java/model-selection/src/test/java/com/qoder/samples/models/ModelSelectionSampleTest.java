package com.qoder.samples.models;

import com.qoder.sdk.SessionOptions;
import com.qoder.sdk.internal.session.CliArguments;
import com.qoder.sdk.json.JsonValue;
import com.qoder.sdk.model.ModelId;
import com.qoder.sdk.model.ModelInfo;
import com.qoder.sdk.model.ModelPolicyResult;
import org.junit.Test;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

public class ModelSelectionSampleTest {
    private static ModelInfo model(boolean enabled, String metadata) {
        return ModelInfo.of(ModelId.of("test-model"), "Test", null, enabled, JsonValue.parse(metadata));
    }

    @Test
    public void combinesCatalogFormatsAndUsesAdvertisedDefaults() {
        ModelSelectionSample.Choices choices = new ModelSelectionSample.Choices(model(true,
                "{\"availableContextWindows\":[8000,16000],\"context_config\":{\"large\":{\"token_count\":32000,\"is_default\":true}},"
                + "\"efforts\":[\"low\"],\"thinking_config\":{\"enabled\":{\"efforts\":{\"high\":{\"is_default\":true},\"low\":{}}}}}"));
        assertEquals(Arrays.asList(8000L, 16000L, 32000L), choices.windows);
        assertEquals(Long.valueOf(32000), choices.defaultWindow);
        assertEquals(Arrays.asList("low", "high"), choices.efforts);
        assertEquals("high", choices.defaultEffort);
    }

    @Test
    public void ignoresMalformedMetadataAndUnadvertisedDefaults() {
        ModelSelectionSample.Choices choices = new ModelSelectionSample.Choices(model(true,
                "{\"availableContextWindows\":[0,-1,1.5,\"8000\",8000,8000,1e50],\"defaultContextWindow\":999,"
                + "\"context_config\":{\"bad\":null},\"efforts\":[3,\"\",\"low\"],\"defaultEffort\":\"missing\"}"));
        assertEquals(Collections.singletonList(8000L), choices.windows);
        assertEquals(Long.valueOf(8000), choices.defaultWindow);
        assertEquals(Collections.singletonList("low"), choices.efforts);
        assertEquals("low", choices.defaultEffort);
        assertTrue(new ModelSelectionSample.Choices(model(true, "null")).windows.isEmpty());
    }

    @Test
    public void excludesDisabledModelsAndFailsEmptyCatalog() {
        ModelInfo enabled = model(true, "{}");
        assertEquals(Collections.singletonList(enabled), ModelSelectionSample.enabled(Arrays.asList(model(false, "{}"), enabled)));
        assertThrows(IllegalStateException.class, () -> ModelSelectionSample.enabled(Collections.<ModelInfo>emptyList()));
        assertThrows(IllegalStateException.class, () -> ModelSelectionSample.enabled(Collections.singletonList(model(false, "{}"))));
    }

    @Test
    public void acceptsIndexValueOrDefaultAndRejectsInvalidSelection() {
        List<String> values = Arrays.asList("auto", "model");
        assertEquals(0, ModelSelectionSample.selection("", values, 0));
        assertEquals(1, ModelSelectionSample.selection("2", values, 0));
        assertEquals(1, ModelSelectionSample.selection("MODEL", values, 0));
        assertThrows(IllegalArgumentException.class, () -> ModelSelectionSample.selection("0", values, 0));
        assertThrows(IllegalArgumentException.class, () -> ModelSelectionSample.selection("missing", values, 0));
    }

    @Test
    public void policyCarriesStructuredParametersAndRejectsStaleOrInvalidChoices() {
        ModelInfo selected = model(true, "{\"availableContextWindows\":[8000],\"efforts\":[\"low\"]}");
        ModelPolicyResult result = ModelSelectionSample.policy(selected, 8000L, "low", Collections.singletonList(selected));
        assertEquals(selected.modelId(), result.model().get());
        assertEquals(JsonValue.parse("{\"contextWindow\":8000,\"reasoningEffort\":\"low\"}"), result.parameters().get());
        assertThrows(IllegalStateException.class, () -> ModelSelectionSample.policy(selected, null, null,
                Collections.singletonList(model(false, "{}"))));
        assertThrows(IllegalArgumentException.class, () -> ModelSelectionSample.policy(selected, 99L, null,
                Collections.<ModelInfo>emptyList()));
        assertFalse(ModelSelectionSample.policy(model(true, "{}"), null, null,
                Collections.<ModelInfo>emptyList()).parameters().isPresent());
    }

    @Test
    public void policyValidatesChoicesAgainstCurrentCatalogEntry() {
        ModelInfo selected = model(true, "{\"availableContextWindows\":[8000,16000],\"efforts\":[\"low\",\"high\"]}");
        List<ModelInfo> current = Collections.singletonList(model(true,
                "{\"availableContextWindows\":[8000],\"efforts\":[\"low\"]}"));
        assertThrows(IllegalArgumentException.class, () -> ModelSelectionSample.policy(selected, 16000L, null, current));
        assertThrows(IllegalArgumentException.class, () -> ModelSelectionSample.policy(selected, null, "high", current));
        ModelPolicyResult result = ModelSelectionSample.policy(selected, 8000L, "low", current);
        assertEquals(JsonValue.parse("{\"contextWindow\":8000,\"reasoningEffort\":\"low\"}"), result.parameters().get());
        List<ModelInfo> renamed = Collections.singletonList(ModelInfo.of(ModelId.of("other-model"), "Other", null, true,
                JsonValue.parse("{\"availableContextWindows\":[16000]}")));
        assertThrows(IllegalStateException.class, () -> ModelSelectionSample.policy(selected, 16000L, null, renamed));
    }

    // Pins the SDK 0.2.4 argument translation that NO_TOOLS depends on. CliArguments is an internal
    // SDK class used only here, so a later SDK that changes the empty-list semantics fails this test.
    @Test
    public void noToolsOptionProducesEmptyToolsArgument() {
        List<String> omitted = CliArguments.forOptions(SessionOptions.builder()
                .tools(Collections.<String>emptyList()).build(), null);
        assertFalse(omitted.contains("--tools"));
        List<String> disabled = CliArguments.forOptions(SessionOptions.builder()
                .tools(ModelSelectionSample.NO_TOOLS).maxTurns(1).build(), null);
        int index = disabled.indexOf("--tools");
        assertTrue(index >= 0);
        assertEquals("", disabled.get(index + 1));
        assertFalse(disabled.contains("--allowed-tools"));
    }
}
