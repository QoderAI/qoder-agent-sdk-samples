package com.qoder.samples.tools;

import com.qoder.sdk.MessageCursor;
import com.qoder.sdk.SessionOptions;
import com.qoder.sdk.json.JsonObject;
import com.qoder.sdk.json.JsonString;
import com.qoder.sdk.json.JsonValue;
import com.qoder.sdk.mcp.McpServerConfig;
import com.qoder.sdk.mcp.server.InProcessMcpServer;
import com.qoder.sdk.mcp.server.InProcessMcpTool;
import com.qoder.sdk.message.AssistantMessage;
import com.qoder.sdk.message.ResultMessage;
import com.qoder.sdk.message.SdkMessage;
import com.qoder.sdk.message.TextBlock;
import org.junit.Test;

import java.io.ByteArrayOutputStream;
import java.io.PrintStream;
import java.util.Arrays;
import java.util.Iterator;
import java.util.concurrent.TimeUnit;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

public class CustomToolsTest {
    private static final CustomTools.ReleaseData DATA = CustomTools.ReleaseData.load();

    private static JsonValue call(InProcessMcpTool tool, String arguments) throws Exception {
        return tool.handler().call(JsonValue.parse(arguments)).toCompletableFuture().get(5, TimeUnit.SECONDS);
    }

    private static InProcessMcpTool tool(InProcessMcpServer server, String name) {
        for (InProcessMcpTool tool : server.tools()) if (tool.name().equals(name)) return tool;
        throw new AssertionError("No tool named " + name);
    }

    private static String text(JsonValue result) {
        return result.asObject().get("content").asArray().get(0).asObject().get("text").asString();
    }

    private static PrintStream sink() {
        return new PrintStream(new ByteArrayOutputStream());
    }

    @Test
    public void loadsTheCheckedInDataAndRejectsUnknownServices() {
        assertEquals("8f2a1c4", DATA.service("payments-api").get("build").asObject().get("revision").asString());
        assertEquals(1, DATA.service("payments-api").get("incidents").asArray().size());
        IllegalArgumentException unknown = assertThrows(IllegalArgumentException.class,
                () -> DATA.service("search-api"));
        assertEquals("Unknown service: search-api", unknown.getMessage());
        assertThrows(IllegalArgumentException.class,
                () -> new CustomTools.ReleaseData(JsonValue.parse("{\"services\":[]}")));
    }

    @Test
    public void registersBothToolsWithTheServiceSchema() {
        InProcessMcpServer server = CustomTools.server(DATA);
        assertEquals(Arrays.asList("get_build_status", "get_open_incidents"),
                Arrays.asList(server.tools().get(0).name(), server.tools().get(1).name()));
        for (InProcessMcpTool tool : server.tools()) {
            assertFalse(tool.description().isEmpty());
            JsonObject schema = tool.inputSchema().asObject();
            assertEquals("object", schema.get("type").asString());
            assertEquals("string", schema.get("properties").asObject().get("service").asObject().get("type").asString());
            assertEquals(JsonString.of("service"), schema.get("required").asArray().get(0));
        }
    }

    @Test
    public void returnsServiceDataAsTextContent() throws Exception {
        InProcessMcpServer server = CustomTools.server(DATA);
        JsonValue build = call(tool(server, "get_build_status"), "{\"service\":\"payments-api\"}");
        assertNull(build.asObject().get("isError"));
        assertEquals(DATA.service("payments-api").get("build"), JsonValue.parse(text(build)));
        JsonValue incidents = call(tool(server, "get_open_incidents"), "{\"service\":\"payments-api\"}");
        assertEquals("INC-1042", JsonValue.parse(text(incidents)).asArray().get(0).asObject().get("id").asString());
    }

    @Test
    public void reportsBadArgumentsAsToolErrorsInsteadOfFailingTheCall() throws Exception {
        InProcessMcpTool tool = tool(CustomTools.server(DATA), "get_build_status");
        JsonValue unknown = call(tool, "{\"service\":\"search-api\"}");
        assertTrue(unknown.asObject().get("isError").asBoolean());
        assertEquals("Unknown service: search-api", text(unknown));
        for (String arguments : new String[]{"{}", "{\"service\":7}", "{\"service\":\"\"}", "[]"}) {
            JsonValue invalid = call(tool, arguments);
            assertTrue(arguments, invalid.asObject().get("isError").asBoolean());
            assertEquals("The service argument must be a non-empty string.", text(invalid));
        }
    }

    @Test
    public void servesToolCallsOverTheJsonRpcChannel() throws Exception {
        InProcessMcpServer server = CustomTools.server(DATA);
        JsonValue listed = server.handle(JsonValue.parse("{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\"}"))
                .toCompletableFuture().get(5, TimeUnit.SECONDS);
        JsonObject listing = listed.asObject().get("result").asObject();
        assertEquals(2, listing.get("tools").asArray().size());
        assertEquals("get_build_status", listing.get("tools").asArray().get(0).asObject().get("name").asString());

        JsonValue called = server.handle(JsonValue.parse("{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\","
                + "\"params\":{\"name\":\"get_open_incidents\",\"arguments\":{\"service\":\"search-api\"}}}"))
                .toCompletableFuture().get(5, TimeUnit.SECONDS);
        JsonObject result = called.asObject().get("result").asObject();
        assertTrue(result.get("isError").asBoolean());
        assertEquals("Unknown service: search-api", text(result));
    }

    @Test
    public void exposesAndPreapprovesOnlyTheTwoMcpTools() {
        SessionOptions options = CustomTools.options(CustomTools.server(DATA));
        assertEquals(Arrays.asList("mcp__release_readiness__get_build_status",
                "mcp__release_readiness__get_open_incidents"), options.tools());
        assertEquals(options.tools(), options.allowedTools());
        assertEquals(1, options.mcpServers().size());
        McpServerConfig config = options.mcpServers().get(0);
        assertEquals("release_readiness", config.name());
        assertTrue(config.inProcessHandler().isPresent());
        assertEquals(Integer.valueOf(4), options.maxTurns().get());
        assertTrue(CustomTools.prompt("payments-api").contains("payments-api"));
    }

    @Test
    public void printsAssistantTextAndClosesTheCursor() throws Exception {
        Cursor cursor = new Cursor(new AssistantMessage(null, null, null, Arrays.asList(new TextBlock("Ship it."))),
                ResultMessage.builder().wireSubtype("success").result("Ship it.").build());
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        CustomTools.consume(cursor, new PrintStream(bytes, true, "UTF-8"));
        assertEquals("Ship it." + System.lineSeparator(), bytes.toString("UTF-8"));
        assertTrue(cursor.closed);
    }

    @Test
    public void failsOnErrorResultsAndMissingResults() {
        Cursor error = new Cursor(ResultMessage.builder().wireSubtype("error").wireIsError(true).build());
        assertThrows(CustomTools.SampleFailure.class, () -> CustomTools.consume(error, sink()));
        assertTrue(error.closed);
        Cursor empty = new Cursor();
        assertThrows(CustomTools.SampleFailure.class, () -> CustomTools.consume(empty, sink()));
        assertTrue(empty.closed);
    }

    private static final class Cursor implements MessageCursor {
        final Iterator<SdkMessage> messages;
        boolean closed;

        Cursor(SdkMessage... messages) { this.messages = Arrays.asList(messages).iterator(); }
        public boolean hasNext() { return messages.hasNext(); }
        public SdkMessage next() { return messages.next(); }
        public void close() { closed = true; }
    }
}
