package com.qoder.samples.permissions;
import com.qoder.sdk.json.*;
import com.qoder.sdk.permission.*;
import org.junit.Test;
import java.nio.file.Paths;
import java.util.Collections;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.Assert.*;

public class ToolPermissionsTest {
    private static final CancellationToken ACTIVE = token(false);
    private static CancellationToken token(final boolean cancelled) {
        return new CancellationToken() {
            public boolean isCancelled() { return cancelled; }
            public void onCancel(Runnable listener) { if (cancelled) listener.run(); }
        };
    }
    private static ToolPermissionRequest request(String tool, JsonValue input) {
        return ToolPermissionRequest.of(tool, input, Collections.<JsonValue>emptyList());
    }
    private static JsonObject command(String command) {
        return JsonObject.builder().put("command", JsonString.of(command)).build();
    }
    @Test public void permitsOnlyExactStatusAndDropsOtherFields() {
        JsonObject input = JsonObject.builder().put("command", JsonString.of("git --no-pager status --short"))
                .put("other", JsonString.of("unreviewed")).build();
        PermissionResult result = ToolPermissions.authorize(request("Bash", input), ACTIVE);
        assertTrue(result.isAllowed());
        assertEquals(command("git --no-pager status --short"), result.updatedInput().get());
    }
    @Test public void deniesShellCombinationsAndOtherPrograms() {
        for (String text : new String[]{"git status --short; echo hi", "git status --short\necho hi",
                "git status --short && echo hi", "git status --short $(echo hi)", "git status --short > x",
                "git reset --hard", "echo git status --short"}) {
            assertFalse(text, ToolPermissions.authorize(request("Bash", command(text)), ACTIVE).isAllowed());
        }
    }
    @Test public void deniesMalformedInputsAndOtherTools() {
        assertFalse(ToolPermissions.authorize(request("Bash", JsonObject.empty()), ACTIVE).isAllowed());
        assertFalse(ToolPermissions.authorize(request("Bash", JsonString.of("git status --short")), ACTIVE).isAllowed());
        assertFalse(ToolPermissions.authorize(request("Write", command("git status --short")), ACTIVE).isAllowed());
        assertFalse(ToolPermissions.authorize(request("Bash",
                JsonObject.builder().put("command", JsonNumber.of(1)).build()), ACTIVE).isAllowed());
    }
    @Test public void cancellationDeniesEvenSafeCommands() {
        assertFalse(ToolPermissions.authorize(request("Bash", command("git status --short")), token(true)).isAllowed());
    }
    @Test public void bashIsVisibleButNotPreapproved() {
        com.qoder.sdk.SessionOptions options = ToolPermissions.options(Paths.get("."), new AtomicInteger());
        assertTrue(options.tools().contains("Bash"));
        assertFalse(options.allowedTools().contains("Bash"));
        assertTrue(options.canUseTool().isPresent());
        assertEquals(PermissionMode.DEFAULT, options.permissionMode().get());
    }
}
