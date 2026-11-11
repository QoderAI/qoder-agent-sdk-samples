package com.qoder.samples.storage;

import com.qoder.sdk.MessageCursor;
import com.qoder.sdk.SessionOptions;
import com.qoder.sdk.SessionStorage;
import com.qoder.sdk.message.MirrorErrorMessage;
import com.qoder.sdk.message.ResultMessage;
import com.qoder.sdk.message.SdkMessage;
import com.qoder.sdk.session.InMemorySessionStore;
import com.qoder.sdk.session.SessionKey;
import com.qoder.sdk.session.VersionToken;
import org.junit.Test;

import java.nio.file.Paths;
import java.util.Arrays;
import java.util.Collections;
import java.util.Iterator;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.TimeUnit;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertSame;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

public class SessionHandoffTest {
    @Test
    public void everyLaunchUsesTheExternalStoreWithoutTools() {
        InMemorySessionStore store = new InMemorySessionStore();
        SessionOptions first = SessionHandoff.options(Paths.get("."), store, null);
        assertEquals(SessionStorage.external(store).mode(), first.sessionStorage().mode());
        assertSame(store, first.sessionStorage().externalStore().get());
        assertFalse(first.resumeSessionId().isPresent());
        assertEquals(Collections.singletonList(""), first.tools());
        assertEquals(Integer.valueOf(1), first.maxTurns().get());
        assertEquals(Paths.get("."), first.workingDirectory().get());

        SessionOptions resumed = SessionHandoff.options(Paths.get("."), store, "previous-session");
        assertEquals("previous-session", resumed.resumeSessionId().get());
        assertSame(store, resumed.sessionStorage().externalStore().get());
    }

    @Test
    public void returnsTheSuccessfulResultAndClosesTheCursor() {
        ResultMessage success = ResultMessage.builder().wireSubtype("success").result("stored").build();
        Cursor cursor = new Cursor(success);
        assertSame(success, SessionHandoff.consume(cursor));
        assertTrue(cursor.closed);
    }

    @Test
    public void aMirrorErrorFailsTheRunEvenWhenTheTurnSucceeds() {
        Cursor cursor = new Cursor(
                new MirrorErrorMessage(null, null, "{\"type\":\"system\",\"error\":\"append timed out\"}"),
                ResultMessage.builder().wireSubtype("success").build());
        SessionHandoff.SampleFailure failure =
                assertThrows(SessionHandoff.SampleFailure.class, () -> SessionHandoff.consume(cursor));
        assertEquals("SessionStore could not persist the transcript: append timed out", failure.getMessage());
        assertTrue(cursor.closed);
        for (String raw : new String[]{null, "not json", "[]", "{\"error\":7}"}) {
            assertEquals("no details", SessionHandoff.mirrorError(new MirrorErrorMessage(null, null, raw)));
        }
    }

    @Test
    public void failsOnErrorResultsAndMissingResults() {
        Cursor error = new Cursor(ResultMessage.builder().wireSubtype("error").wireIsError(true).build());
        assertThrows(SessionHandoff.SampleFailure.class, () -> SessionHandoff.consume(error));
        assertTrue(error.closed);
        Cursor empty = new Cursor();
        assertThrows(SessionHandoff.SampleFailure.class, () -> SessionHandoff.consume(empty));
        assertTrue(empty.closed);
    }

    @Test
    public void theResumedResponseMustContainTheMarker() {
        SessionHandoff.requireMarker("The marker is session-storage-1.", "session-storage-1");
        assertThrows(SessionHandoff.SampleFailure.class,
                () -> SessionHandoff.requireMarker("I do not know.", "session-storage-1"));
    }

    @Test
    public void redisKeysEncodeEverySegmentAndSeparateChildren() {
        RedisSessionStore store = new RedisSessionStore(null, "app:sessions::");
        SessionKey root = SessionKey.of("/work/repo:1", "session-1");
        SessionKey child = SessionKey.of("/work/repo:1", "session-1", "subagents/agent:1");
        String project = RedisSessionStore.encoded("/work/repo:1");
        String session = RedisSessionStore.encoded("session-1");
        assertEquals("/work/repo:1", RedisSessionStore.decoded(project));
        assertFalse(project.contains(":") || project.contains("/") || project.contains("="));
        assertEquals(session + ":main", RedisSessionStore.member(root));
        assertEquals(session + ":child:" + RedisSessionStore.encoded("subagents/agent:1"),
                RedisSessionStore.member(child));
        assertEquals("app:sessions:entries:" + project + ":" + session + ":main",
                store.transcriptKey("entries", root));
        assertEquals("app:sessions:index:" + project, store.indexKey("/work/repo:1"));
        // The seal of a whole session is a different key from the seal of its root transcript.
        assertEquals("app:sessions:sealed:" + project + ":" + session, store.sessionSealKey("/work/repo:1", "session-1"));
        assertEquals("app:sessions:sealed:" + project + ":" + session + ":main", store.transcriptKey("sealed", root));
        store.close();
    }

    @Test
    public void postgresRejectsUnsafeTablePrefixesAndUrlsWithoutEchoingThem() {
        for (String prefix : new String[]{"", "1table", "name; DROP TABLE x", "has-dash", "has space"}) {
            assertThrows(prefix, IllegalArgumentException.class, () -> new PostgresSessionStore(null, prefix));
        }
        new PostgresSessionStore(null, "tenant_1").close();
        for (String url : new String[]{"mysql://user:secret@host/db", "postgresql:secret", "not a url secret"}) {
            IllegalArgumentException invalid =
                    assertThrows(IllegalArgumentException.class, () -> PostgresSessionStore.open(url));
            assertFalse(invalid.getMessage().contains("secret"));
        }
        assertEquals(VersionToken.initial(), PostgresSessionStore.token(0));
        assertEquals("3", PostgresSessionStore.token(3).value());
    }

    @Test
    public void adapterFailuresCompleteTheStageInsteadOfBeingThrown() throws Exception {
        SessionKey key = SessionKey.of("project", "session");
        // Without a client or connection every command fails; the failure must arrive through the stage.
        RedisSessionStore redis = new RedisSessionStore(null);
        PostgresSessionStore postgres = new PostgresSessionStore(null);
        assertTrue(failure(redis.load(key)) instanceof NullPointerException);
        assertTrue(failure(postgres.load(key)) instanceof NullPointerException);
        redis.close();
        postgres.close();
        assertTrue(failure(redis.load(key)) instanceof RejectedExecutionException);
        assertTrue(failure(postgres.deleteSessionTree("project", "session")) instanceof RejectedExecutionException);
    }

    private static Throwable failure(CompletionStage<?> stage) {
        return assertThrows(ExecutionException.class,
                () -> stage.toCompletableFuture().get(10, TimeUnit.SECONDS)).getCause();
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
