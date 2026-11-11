package com.qoder.samples.tools;

import com.qoder.sdk.MessageCursor;
import com.qoder.sdk.OneShotQueryRequest;
import com.qoder.sdk.QoderClient;
import com.qoder.sdk.QoderQuery;
import com.qoder.sdk.SessionOptions;
import com.qoder.sdk.auth.Auth;
import com.qoder.sdk.json.JsonArray;
import com.qoder.sdk.json.JsonBoolean;
import com.qoder.sdk.json.JsonObject;
import com.qoder.sdk.json.JsonString;
import com.qoder.sdk.json.JsonValue;
import com.qoder.sdk.mcp.McpServerConfig;
import com.qoder.sdk.mcp.server.InProcessMcpServer;
import com.qoder.sdk.mcp.server.InProcessMcpTool;
import com.qoder.sdk.message.AssistantMessage;
import com.qoder.sdk.message.ResultMessage;
import com.qoder.sdk.message.ResultOutcome;
import com.qoder.sdk.message.SdkMessage;
import com.qoder.sdk.model.ModelId;
import com.qoder.sdk.model.ModelSelection;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;

public final class CustomTools {
    static final String SERVER_NAME = "release_readiness";
    static final String BUILD_STATUS = "get_build_status";
    static final String OPEN_INCIDENTS = "get_open_incidents";
    // The CLI exposes an MCP tool as mcp__<server>__<tool>.
    static final List<String> TOOL_NAMES = Collections.unmodifiableList(Arrays.asList(
            "mcp__" + SERVER_NAME + "__" + BUILD_STATUS, "mcp__" + SERVER_NAME + "__" + OPEN_INCIDENTS));
    static final JsonValue SERVICE_INPUT = JsonValue.parse("{\"type\":\"object\",\"properties\":{"
            + "\"service\":{\"type\":\"string\",\"description\":\"Service name\"}},\"required\":[\"service\"]}");

    /** A failure this sample detected itself; its message contains no SDK or model output. */
    static final class SampleFailure extends RuntimeException {
        SampleFailure(String message) {
            super(message);
        }
    }

    /**
     * Application-owned release data. The checked-in data.json stands in for CI and incident-management
     * clients. Immutable, so the tool handlers that share it are thread-safe.
     */
    static final class ReleaseData {
        private final JsonObject services;

        ReleaseData(JsonValue data) {
            JsonValue services = data != null && data.isObject() ? data.asObject().get("services") : null;
            if (services == null || !services.isObject()) {
                throw new IllegalArgumentException("Release data must contain a services object.");
            }
            this.services = services.asObject();
        }

        static ReleaseData load() {
            try (InputStream input = CustomTools.class.getResourceAsStream("/data.json")) {
                if (input == null) throw new SampleFailure("data.json is missing from the classpath.");
                ByteArrayOutputStream bytes = new ByteArrayOutputStream();
                byte[] buffer = new byte[4096];
                int count;
                while ((count = input.read(buffer)) != -1) bytes.write(buffer, 0, count);
                return new ReleaseData(JsonValue.parse(new String(bytes.toByteArray(), StandardCharsets.UTF_8)));
            } catch (IOException failure) {
                throw new SampleFailure("data.json could not be read.");
            }
        }

        /** Returns the named service's record, or fails with a message meant for the model. */
        JsonObject service(String name) {
            JsonValue record = services.get(name);
            if (record == null || !record.isObject()) throw new IllegalArgumentException("Unknown service: " + name);
            return record.asObject();
        }
    }

    static String serviceArgument(JsonValue arguments) {
        JsonValue service = arguments != null && arguments.isObject() ? arguments.asObject().get("service") : null;
        if (service == null || !service.isString() || service.asString().isEmpty()) {
            throw new IllegalArgumentException("The service argument must be a non-empty string.");
        }
        return service.asString();
    }

    /** An MCP tool result with one text block; {@code isError} tells the model the call failed. */
    static JsonObject textResult(String text, boolean isError) {
        JsonObject.Builder result = JsonObject.builder().put("content", JsonArray.of(JsonObject.builder()
                .put("type", JsonString.of("text")).put("text", JsonString.of(text)).build()));
        if (isError) result.put("isError", JsonBoolean.TRUE);
        return result.build();
    }

    /** A tool that returns one field of a service record as JSON text. */
    static InProcessMcpTool tool(String name, String description, ReleaseData data, String field) {
        return InProcessMcpTool.of(name, description, SERVICE_INPUT, arguments -> {
            JsonValue result;
            try {
                JsonValue value = data.service(serviceArgument(arguments)).get(field);
                result = textResult(value == null ? "null" : value.toJson(), false);
            } catch (IllegalArgumentException failure) {
                // An unknown service is an answer for the model, not a protocol error.
                result = textResult(failure.getMessage(), true);
            }
            CompletionStage<JsonValue> stage = CompletableFuture.completedFuture(result);
            return stage;
        });
    }

    static InProcessMcpServer server(ReleaseData data) {
        return InProcessMcpServer.builder().name(SERVER_NAME).version("1.0.0")
                .addTool(tool(BUILD_STATUS, "Return the latest CI build status for a service.", data, "build"))
                .addTool(tool(OPEN_INCIDENTS, "Return open production incidents for a service.", data, "incidents"))
                .build();
    }

    static SessionOptions options(InProcessMcpServer server) {
        return SessionOptions.builder()
                .modelSelection(ModelSelection.staticModel(ModelId.of("auto")))
                .mcpServers(Collections.singletonList(McpServerConfig.inProcess(SERVER_NAME, server)))
                .tools(TOOL_NAMES)
                .allowedTools(TOOL_NAMES)
                .maxTurns(4)
                .build();
    }

    static String prompt(String service) {
        return "Use both available tools to assess whether " + service + " is ready to release. "
                + "Cite the build revision and every open incident in a concise recommendation.";
    }

    /** Prints assistant text, reads to EOF, and requires a successful terminal result. */
    static void consume(MessageCursor cursor, PrintStream out) {
        boolean completed = false;
        try {
            while (cursor.hasNext()) {
                SdkMessage message = cursor.next();
                if (message instanceof AssistantMessage) {
                    out.print(((AssistantMessage) message).getText());
                    out.flush();
                } else if (message instanceof ResultMessage) {
                    ResultOutcome outcome = ((ResultMessage) message).outcome();
                    if (outcome != ResultOutcome.SUCCESS) throw new SampleFailure("Query did not succeed: " + outcome);
                    completed = true;
                }
            }
        } finally {
            cursor.close();
        }
        if (!completed) throw new SampleFailure("The query ended without a success result.");
        out.println();
    }

    static void run(String service, PrintStream out) {
        InProcessMcpServer server = server(ReleaseData.load());
        try (QoderClient client = QoderClient.builder().auth(Auth.accessTokenEnv()).build()) {
            QoderQuery query = client.query(OneShotQueryRequest.builder()
                    .prompt(prompt(service)).options(options(server)).build());
            consume(query.messages().openCursor(), out);
        }
    }

    public static void main(String[] args) {
        try {
            run(args.length == 0 ? "payments-api" : args[0], System.out);
        } catch (SampleFailure failure) {
            System.err.println("Custom tools failed: " + failure.getMessage());
            System.exit(1);
        } catch (Exception failure) {
            // SDK failures report only their type, so raw details and credentials stay out of the log.
            System.err.println("Custom tools failed (" + failure.getClass().getSimpleName() + ").");
            System.exit(1);
        }
    }
}
