package com.qoder.samples.hooks;

import com.qoder.sdk.hook.HookEvent;
import com.qoder.sdk.hook.HookRegistration;
import com.qoder.sdk.json.JsonObject;
import com.qoder.sdk.json.JsonString;
import com.qoder.sdk.json.JsonValue;
import org.junit.Test;

import java.util.List;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

public class HooksTest {
    private static JsonObject response(String name, String payload) {
        return Hooks.response(HookEvent.of(name, null, JsonValue.parse(payload))).asObject();
    }

    private static String decision(String command) {
        JsonObject input = JsonObject.builder().put("tool_name", JsonString.of("Bash"))
                .put("tool_input", JsonObject.builder().put("command", JsonString.of(command)).build()).build();
        return Hooks.response(HookEvent.of("PreToolUse", "Bash", input)).asObject()
                .get("hookSpecificOutput").asObject().get("permissionDecision").asString();
    }

    @Test
    public void preToolUsesStructuredPermissionDecisions() {
        assertEquals("allow", decision("git --no-pager status --short"));
        assertEquals("deny", decision("git status --short && echo hello"));
        assertEquals("deny", decision("git status --short\ngit reset --hard"));
        assertEquals("deny", decision("git push"));
    }

    @Test
    public void malformedPreToolPayloadFailsClosed() {
        for (String payload : new String[]{"{}", "[]", "{\"tool_name\":\"Bash\",\"tool_input\":7}"}) {
            assertEquals("deny", response("PreToolUse", payload).get("hookSpecificOutput")
                    .asObject().get("permissionDecision").asString());
        }
    }

    @Test
    public void contextResponsesNameTheirEventAndStopHasNoOverride() {
        for (String name : new String[]{"SessionStart", "UserPromptSubmit", "PostToolUse"}) {
            JsonObject output = response(name, "{}").get("hookSpecificOutput").asObject();
            assertEquals(name, output.get("hookEventName").asString());
            assertTrue(output.get("additionalContext").isString());
        }
        assertEquals(JsonObject.empty(), response("Stop", "{}"));
    }

    @Test
    public void onlyBashPreToolCallsAreFiltered() throws Exception {
        List<HookRegistration> hooks = new Hooks().registrations();
        assertEquals(5, hooks.size());
        for (HookRegistration hook : hooks) {
            if ("PreToolUse".equals(hook.event())) assertEquals("Bash", hook.matcher().get());
            else assertFalse(hook.matcher().isPresent());
            assertNotNull(hook.handler().onHookEvent(HookEvent.of(hook.event(), null, JsonObject.empty()))
                    .toCompletableFuture().get());
        }
    }
}
