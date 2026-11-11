package com.qoder.samples.storage;

import com.qoder.sdk.MessageCursor;
import com.qoder.sdk.OneShotQueryRequest;
import com.qoder.sdk.QoderClient;
import com.qoder.sdk.QoderQuery;
import com.qoder.sdk.SessionOptions;
import com.qoder.sdk.SessionRepository;
import com.qoder.sdk.SessionStorage;
import com.qoder.sdk.auth.Auth;
import com.qoder.sdk.json.JsonValue;
import com.qoder.sdk.message.MirrorErrorMessage;
import com.qoder.sdk.message.ResultMessage;
import com.qoder.sdk.message.ResultOutcome;
import com.qoder.sdk.message.SdkMessage;
import com.qoder.sdk.model.ModelId;
import com.qoder.sdk.model.ModelSelection;
import com.qoder.sdk.session.InMemorySessionStore;
import com.qoder.sdk.session.SessionDeletionStore;
import com.qoder.sdk.session.SessionSnapshot;
import com.qoder.sdk.session.SessionStore;
import redis.clients.jedis.RedisClient;

import java.io.PrintStream;
import java.net.URI;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.sql.Connection;
import java.util.Collections;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public final class SessionHandoff {
    // SDK 0.2.4 omits `--tools` for an empty list, which keeps the CLI default tools. A single empty
    // name produces `--tools ""`, the same argument the TypeScript and Python SDKs send for `tools: []`.
    static final List<String> NO_TOOLS = Collections.singletonList("");

    /** A failure this sample detected itself; its message contains no credentials or connection URLs. */
    static final class SampleFailure extends RuntimeException {
        SampleFailure(String message) {
            super(message);
        }
    }

    static SessionOptions options(Path workspace, SessionStore store, String resume) {
        SessionOptions.Builder builder = SessionOptions.builder().workingDirectory(workspace)
                .modelSelection(ModelSelection.staticModel(ModelId.of("auto")))
                .tools(NO_TOOLS).maxTurns(1)
                // The SDK mirrors every transcript entry of this launch into the store. With
                // resume(), it first restores the transcript from the store, never from local history.
                .sessionStorage(SessionStorage.external(store));
        if (resume != null) builder.resume(resume);
        return builder.build();
    }

    /** Reads to EOF and returns the successful result. A failed mirror write fails the run. */
    static ResultMessage consume(MessageCursor cursor) {
        ResultMessage result = null;
        try {
            while (cursor.hasNext()) {
                SdkMessage message = cursor.next();
                if (message instanceof MirrorErrorMessage) {
                    // A mirror error never fails the turn itself, so the application has to react.
                    throw new SampleFailure("SessionStore could not persist the transcript: " + mirrorError(message));
                }
                if (message instanceof ResultMessage) {
                    result = (ResultMessage) message;
                    if (result.outcome() != ResultOutcome.SUCCESS) {
                        throw new SampleFailure("Query did not succeed: " + result.outcome());
                    }
                }
            }
        } finally {
            cursor.close();
        }
        if (result == null) throw new SampleFailure("The query ended without a success result.");
        return result;
    }

    // The SDK redacts this text. It is a description for people, not a stable error code.
    static String mirrorError(SdkMessage message) {
        try {
            JsonValue raw = JsonValue.parse(message.rawJson().orElse("{}"));
            JsonValue error = raw.isObject() ? raw.asObject().get("error") : null;
            return error != null && error.isString() ? error.asString() : "no details";
        } catch (RuntimeException malformed) {
            return "no details";
        }
    }

    /** One host: its own client and CLI process, sharing nothing with other hosts but the store. */
    static ResultMessage runQuery(Path workspace, SessionStore store, String prompt, String resume) {
        try (QoderClient client = QoderClient.builder().auth(Auth.accessTokenEnv()).build()) {
            QoderQuery query = client.query(OneShotQueryRequest.builder()
                    .prompt(prompt).options(options(workspace, store, resume)).build());
            return consume(query.messages().openCursor());
        }
    }

    static void requireMarker(String response, String marker) {
        if (!response.contains(marker)) {
            throw new SampleFailure("The resumed response did not contain the stored marker.");
        }
    }

    static void handoff(Path workspace, SessionDeletionStore store, String backend, PrintStream out)
            throws Exception {
        String marker = "session-storage-" + UUID.randomUUID();
        // The repository reads and deletes transcripts in the store without starting a CLI process.
        try (QoderClient application = QoderClient.builder().auth(Auth.accessTokenEnv()).build()) {
            SessionRepository sessions = application.sessions(options(workspace, store, null));
            String sessionId = null;
            try {
                out.println("[host-a] Starting a session with " + backend + " storage.");
                ResultMessage first = runQuery(workspace, store, "Remember this exact deployment marker: "
                        + marker + ". Reply only that it is stored.", null);
                sessionId = first.sessionId()
                        .orElseThrow(() -> new SampleFailure("The result did not report a session ID."));
                Optional<SessionSnapshot> stored = sessions.get(sessionId).toCompletableFuture().get();
                if (!stored.isPresent()) throw new SampleFailure("The store holds no transcript for the session.");
                out.println("[host-a] Stored session " + sessionId + "; the store holds "
                        + stored.get().entries().size() + " transcript entries.");

                out.println("[host-b] Resuming from the store in a new CLI process.");
                ResultMessage resumed = runQuery(workspace, store,
                        "What exact deployment marker did I ask you to remember? Reply only with the marker.",
                        sessionId);
                String response = resumed.result().orElse("");
                out.println("[host-b] Resumed session " + resumed.sessionId().orElse("(unreported)") + ".");
                out.println("[host-b] Agent response: " + response);
                requireMarker(response, marker);
                out.println("[app] External session handoff verified.");
            } finally {
                if (sessionId != null) {
                    // Seals the session and removes its root transcript and every child transcript.
                    sessions.delete(sessionId).toCompletableFuture().get();
                    out.println("[app] Deleted sample transcript from the store.");
                }
            }
        }
    }

    static String setting(String name, String fallback) {
        String value = System.getenv(name);
        return value == null || value.trim().isEmpty() ? fallback : value.trim();
    }

    public static void main(String[] args) {
        try {
            String backend = args.length == 0 ? "" : args[0];
            Path workspace = Paths.get(args.length < 2 ? "." : args[1]).toAbsolutePath().normalize();
            if ("redis".equals(backend)) {
                try (RedisClient client = RedisClient.create(
                        URI.create(setting("QODER_SAMPLE_REDIS_URL", "redis://127.0.0.1:6379")));
                     RedisSessionStore store = new RedisSessionStore(client)) {
                    handoff(workspace, store, "Redis", System.out);
                }
            } else if ("postgres".equals(backend)) {
                try (Connection connection = PostgresSessionStore.open(setting("QODER_SAMPLE_POSTGRES_URL",
                        "postgresql://qoder:qoder@127.0.0.1:5432/qoder_session_store"));
                     PostgresSessionStore store = new PostgresSessionStore(connection)) {
                    store.ensureSchema().toCompletableFuture().get();
                    handoff(workspace, store, "PostgreSQL", System.out);
                }
            } else if ("memory".equals(backend)) {
                // The SDK's reference store: the same handoff without a database, inside one JVM.
                handoff(workspace, new InMemorySessionStore(), "in-memory", System.out);
            } else {
                System.err.println("Usage: SessionHandoff <redis|postgres|memory> [workspace]");
                System.exit(2);
            }
        } catch (SampleFailure failure) {
            System.err.println("Session handoff failed: " + failure.getMessage());
            System.exit(1);
        } catch (Exception failure) {
            // Other failures report only their type, so connection URLs and credentials stay out of the log.
            System.err.println("Session handoff failed (" + failure.getClass().getSimpleName() + ").");
            System.exit(1);
        }
    }
}
