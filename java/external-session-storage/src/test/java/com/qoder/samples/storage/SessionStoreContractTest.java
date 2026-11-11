package com.qoder.samples.storage;

import com.qoder.sdk.SessionStoreConflictException;
import com.qoder.sdk.SessionStoreDeletedException;
import com.qoder.sdk.session.AppendBatch;
import com.qoder.sdk.session.AppendResult;
import com.qoder.sdk.session.InMemorySessionStore;
import com.qoder.sdk.session.OperationId;
import com.qoder.sdk.session.SessionDeletionStore;
import com.qoder.sdk.session.SessionKey;
import com.qoder.sdk.session.SessionSnapshot;
import com.qoder.sdk.session.SessionStoreEntry;
import com.qoder.sdk.session.VersionToken;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.junit.runners.Parameterized;
import redis.clients.jedis.RedisClient;

import java.net.URI;
import java.sql.Connection;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collection;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;
import static org.junit.Assume.assumeTrue;

/**
 * The SessionStore contract, checked against the SDK's reference store on every build and against
 * Redis and PostgreSQL when their test URLs are set. Without a URL that backend's cases are skipped.
 */
@RunWith(Parameterized.class)
public class SessionStoreContractTest {
    static final String REDIS_URL = "QODER_SAMPLE_TEST_REDIS_URL";
    static final String POSTGRES_URL = "QODER_SAMPLE_TEST_POSTGRES_URL";

    @Parameterized.Parameters(name = "{0}")
    public static Collection<Object[]> backends() {
        return Arrays.asList(new Object[][]{{"memory"}, {"redis"}, {"postgres"}});
    }

    @Parameterized.Parameter
    public String backend;

    private final String project = "project-" + UUID.randomUUID();
    private final String unique = UUID.randomUUID().toString().replace("-", "").substring(0, 12);
    private final List<AutoCloseable> stores = new ArrayList<AutoCloseable>();
    private final List<AutoCloseable> connections = new ArrayList<AutoCloseable>();
    private SessionDeletionStore store;

    @Before
    public void open() throws Exception {
        String variable = "redis".equals(backend) ? REDIS_URL : "postgres".equals(backend) ? POSTGRES_URL : null;
        String url = variable == null ? null : System.getenv(variable);
        assumeTrue(variable + " is not set", variable == null || (url != null && !url.isEmpty()));
        store = host();
    }

    /** Opens the store as one more host would: its own connection to the same data. */
    private SessionDeletionStore host() throws Exception {
        if ("redis".equals(backend)) {
            RedisClient client = RedisClient.create(URI.create(System.getenv(REDIS_URL)));
            connections.add(client);
            RedisSessionStore opened = new RedisSessionStore(client, "qoder:samples:test:" + unique);
            stores.add(opened);
            return opened;
        }
        if ("postgres".equals(backend)) {
            Connection connection = PostgresSessionStore.open(System.getenv(POSTGRES_URL));
            connections.add(connection);
            PostgresSessionStore opened = new PostgresSessionStore(connection, "qoder_test_" + unique);
            stores.add(opened);
            if (store == null) await(opened.ensureSchema());
            return opened;
        }
        // The reference store lives in one process, so every host shares the instance.
        return store == null ? new InMemorySessionStore() : store;
    }

    @After
    public void close() throws Exception {
        for (AutoCloseable opened : stores) opened.close();
        if ("redis".equals(backend) && !connections.isEmpty()) {
            RedisClient client = (RedisClient) connections.get(0);
            Set<String> keys = client.keys("qoder:samples:test:" + unique + ":*");
            if (!keys.isEmpty()) client.del(keys.toArray(new String[0]));
        }
        if ("postgres".equals(backend) && !connections.isEmpty()) {
            Connection connection = (Connection) connections.get(0);
            connection.setAutoCommit(true);
            try (Statement statement = connection.createStatement()) {
                for (String table : new String[]{"entries", "heads", "operations", "seals"}) {
                    statement.execute("DROP TABLE IF EXISTS qoder_test_" + unique + "_" + table);
                }
            }
        }
        for (AutoCloseable connection : connections) connection.close();
    }

    private static <T> T await(CompletionStage<T> stage) throws Exception {
        return stage.toCompletableFuture().get(30, TimeUnit.SECONDS);
    }

    private static Throwable failure(CompletionStage<?> stage) {
        return assertThrows(ExecutionException.class, () -> await(stage)).getCause();
    }

    private static AppendBatch batch(String operation, VersionToken expected, String... lines) {
        AppendBatch.Builder builder = AppendBatch.builder().operationId(OperationId.of(operation));
        if (expected != null) builder.expectedVersion(expected);
        for (String line : lines) builder.addEntry(SessionStoreEntry.of(line));
        return builder.build();
    }

    private SessionKey root(String session) {
        return SessionKey.of(project, session);
    }

    private List<String> lines(SessionKey key) throws Exception {
        List<String> lines = new ArrayList<String>();
        for (SessionStoreEntry entry : await(store.load(key)).get().entries()) lines.add(entry.rawJson());
        return lines;
    }

    @Test
    public void aTranscriptThatWasNeverAppendedIsAbsent() throws Exception {
        assertFalse(await(store.load(root("empty"))).isPresent());
        assertTrue(await(store.listSessions(project)).isEmpty());
    }

    @Test
    public void appendsInOrderAndReturnsEveryLineUnchanged() throws Exception {
        // Key order, spacing, escapes, and non-ASCII text must all survive storage byte for byte.
        String first = "{\"type\":\"user\",\"uuid\":\"u1\",\"z\":1,\"a\":2}";
        String second = "{ \"uuid\" : \"u2\",  \"type\":\"assistant\", \"text\":\"caf\\u00e9 你好\" }";
        String third = "{\"type\":\"summary\"}";
        AppendResult one = await(store.append(root("s"), batch("op-1", VersionToken.initial(), first, second)));
        assertEquals(2, one.appendedCount());
        assertFalse(one.alreadyApplied());
        assertNotEquals(VersionToken.initial(), one.newVersion());
        AppendResult two = await(store.append(root("s"), batch("op-2", one.newVersion(), third)));
        assertNotEquals(one.newVersion(), two.newVersion());

        SessionSnapshot snapshot = await(store.load(root("s"))).get();
        assertEquals(two.newVersion(), snapshot.version());
        assertEquals(Arrays.asList(first, second, third), lines(root("s")));
    }

    @Test
    public void replaysAnAppliedOperationEvenWithAStaleVersion() throws Exception {
        AppendResult applied = await(store.append(root("s"), batch("op-1", VersionToken.initial(), "{\"n\":1}")));
        await(store.append(root("s"), batch("op-2", applied.newVersion(), "{\"n\":2}")));

        AppendResult replayed = await(store.append(root("s"), batch("op-1", VersionToken.initial(), "{\"n\":1}")));
        assertTrue(replayed.alreadyApplied());
        // A replay reports the original operation, not the latest state of the store.
        assertEquals(applied.newVersion(), replayed.newVersion());
        assertEquals(1, replayed.appendedCount());
        assertEquals(Arrays.asList("{\"n\":1}", "{\"n\":2}"), lines(root("s")));
    }

    @Test
    public void rejectsAStaleExpectedVersionAndReportsTheCurrentOne() throws Exception {
        AppendResult applied = await(store.append(root("s"), batch("op-1", null, "{\"n\":1}")));
        for (VersionToken stale : new VersionToken[]{VersionToken.initial(), VersionToken.of("not-a-version")}) {
            Throwable conflict = failure(store.append(root("s"), batch("op-" + stale.value(), stale, "{\"n\":2}")));
            assertTrue(conflict.toString(), conflict instanceof SessionStoreConflictException);
            assertEquals(applied.newVersion().value(),
                    ((SessionStoreConflictException) conflict).currentVersion().get());
        }
        assertEquals(Arrays.asList("{\"n\":1}"), lines(root("s")));
        // The rejected operation ID was not recorded, so it can be retried on the current version.
        assertFalse(await(store.append(root("s"), batch("op-not-a-version", applied.newVersion(), "{\"n\":2}")))
                .alreadyApplied());
    }

    @Test
    public void skipsARepeatedUuidAndRejectsOneWithDifferentContent() throws Exception {
        String stored = "{\"uuid\":\"u1\",\"n\":1}";
        await(store.append(root("s"), batch("op-1", null, stored)));
        // Identical content is a retry: neither stored again nor an error, also within one batch.
        AppendResult retry = await(store.append(root("s"),
                batch("op-2", null, stored, "{\"uuid\":\"u2\"}", "{\"uuid\":\"u2\"}")));
        assertEquals(1, retry.appendedCount());

        Throwable conflict = failure(store.append(root("s"),
                batch("op-3", null, "{\"uuid\":\"u3\"}", "{\"uuid\":\"u1\",\"n\":2}")));
        assertTrue(conflict.toString(), conflict instanceof SessionStoreConflictException);
        assertFalse(((SessionStoreConflictException) conflict).currentVersion().isPresent());
        // A rejected batch is applied not at all, and entries without a UUID are never deduplicated.
        await(store.append(root("s"), batch("op-4", null, "{\"n\":9}")));
        await(store.append(root("s"), batch("op-5", null, "{\"n\":9}")));
        assertEquals(Arrays.asList(stored, "{\"uuid\":\"u2\"}", "{\"n\":9}", "{\"n\":9}"), lines(root("s")));
    }

    @Test
    public void anEmptyUuidIsDeduplicatedLikeAnyOtherUuid() throws Exception {
        // Only a missing or non-string uuid means "no UUID"; "" is a value and must be tracked.
        String empty = "{\"uuid\":\"\",\"n\":1}";
        assertEquals(1, await(store.append(root("s"), batch("op-1", null, empty))).appendedCount());
        assertEquals(0, await(store.append(root("s"), batch("op-2", null, empty, empty))).appendedCount());
        Throwable conflict = failure(store.append(root("s"), batch("op-3", null, "{\"uuid\":\"\",\"n\":2}")));
        assertTrue(conflict.toString(), conflict instanceof SessionStoreConflictException);
        // Entries whose uuid is absent, null, or not a string are all stored every time.
        for (String line : new String[]{"{\"n\":1}", "{\"uuid\":null}", "{\"uuid\":7}"}) {
            assertEquals(2, await(store.append(root("s"), batch("op-" + line, null, line, line))).appendedCount());
        }
        assertEquals(7, lines(root("s")).size());
    }

    @Test
    public void keepsTranscriptsApartAndListsChildren() throws Exception {
        SessionKey child = SessionKey.of(project, "s", "subagents/agent-1");
        SessionKey elsewhere = SessionKey.of(project + "-other", "s");
        // The same operation ID and UUID are independent in every transcript.
        await(store.append(root("s"), batch("op-1", VersionToken.initial(), "{\"uuid\":\"u1\",\"at\":\"root\"}")));
        await(store.append(child, batch("op-1", VersionToken.initial(), "{\"uuid\":\"u1\",\"at\":\"child\"}")));
        await(store.append(elsewhere, batch("op-1", VersionToken.initial(), "{\"uuid\":\"u1\",\"at\":\"other\"}")));
        await(store.append(root("t"), batch("op-1", null, "{\"n\":1}")));

        assertEquals(Arrays.asList("{\"uuid\":\"u1\",\"at\":\"root\"}"), lines(root("s")));
        assertEquals(Arrays.asList("{\"uuid\":\"u1\",\"at\":\"child\"}"), lines(child));
        assertEquals(new HashSet<SessionKey>(Arrays.asList(root("s"), child, root("t"))),
                new HashSet<SessionKey>(await(store.listSessions(project))));
    }

    @Test
    public void writersOnSeveralHostsAreAppliedOneAtATime() throws Exception {
        SessionDeletionStore[] hosts = {store, host(), host()};
        // Every host starts from the empty transcript at once: exactly one batch may win.
        List<CompletionStage<AppendResult>> racing = new ArrayList<CompletionStage<AppendResult>>();
        for (int writer = 0; writer < 30; writer++) {
            racing.add(hosts[writer % hosts.length].append(root("s"),
                    batch("race-" + writer, VersionToken.initial(), "{\"writer\":" + writer + "}")));
        }
        int applied = 0;
        for (CompletionStage<AppendResult> stage : racing) {
            try {
                await(stage);
                applied++;
            } catch (ExecutionException rejected) {
                assertTrue(rejected.getCause().toString(),
                        rejected.getCause() instanceof SessionStoreConflictException);
            }
        }
        assertEquals(1, applied);
        assertEquals(1, lines(root("s")).size());

        // Unconditional batches all succeed, and each of them advances the version.
        List<CompletionStage<AppendResult>> appending = new ArrayList<CompletionStage<AppendResult>>();
        for (int writer = 0; writer < 30; writer++) {
            appending.add(hosts[writer % hosts.length].append(root("s"),
                    batch("append-" + writer, null, "{\"n\":" + writer + "}", "{\"n\":" + writer + ",\"second\":true}")));
        }
        Set<VersionToken> versions = new HashSet<VersionToken>();
        for (CompletionStage<AppendResult> stage : appending) versions.add(await(stage).newVersion());
        assertEquals(30, versions.size());
        List<String> stored = lines(root("s"));
        assertEquals(61, stored.size());
        // A batch is atomic: its two entries are adjacent, never interleaved with another writer's.
        for (int index = 1; index < stored.size(); index += 2) {
            assertEquals(stored.get(index).replace("}", ",\"second\":true}"), stored.get(index + 1));
        }
    }

    @Test
    public void deletingOneTranscriptSealsOnlyThatTranscript() throws Exception {
        SessionKey child = SessionKey.of(project, "s", "subagents/agent-1");
        await(store.append(root("s"), batch("op-1", null, "{\"n\":1}")));
        await(store.append(child, batch("op-1", null, "{\"n\":1}")));
        await(store.deleteSession(child));
        await(store.deleteSession(child));

        assertFalse(await(store.load(child)).isPresent());
        assertEquals(Arrays.asList(root("s")), await(store.listSessions(project)));
        // Neither a new batch nor a replay may recreate a deleted transcript.
        for (String operation : new String[]{"op-1", "op-2"}) {
            Throwable deleted = failure(store.append(child, batch(operation, null, "{\"n\":1}")));
            assertTrue(deleted.toString(), deleted instanceof SessionStoreDeletedException);
        }
        assertFalse(await(store.append(root("s"), batch("op-2", null, "{\"n\":2}"))).alreadyApplied());
    }

    @Test
    public void deletingASessionSealsItsRootAndEveryChild() throws Exception {
        SessionKey child = SessionKey.of(project, "s", "subagents/agent-1");
        await(store.append(root("s"), batch("op-1", VersionToken.initial(), "{\"n\":1}")));
        await(store.append(child, batch("op-1", null, "{\"n\":1}")));
        await(store.append(root("t"), batch("op-1", null, "{\"n\":1}")));
        await(store.deleteSessionTree(project, "s"));
        await(store.deleteSessionTree(project, "s"));
        // Deleting a session that never existed succeeds and seals it as well.
        await(store.deleteSessionTree(project, "never"));

        assertFalse(await(store.load(root("s"))).isPresent());
        assertFalse(await(store.load(child)).isPresent());
        assertEquals(Arrays.asList(root("t")), await(store.listSessions(project)));
        SessionKey later = SessionKey.of(project, "s", "created-after-deletion");
        for (SessionKey sealed : new SessionKey[]{root("s"), child, later, root("never")}) {
            // Deletion wins over replay and over a version check, including the initial version.
            for (AppendBatch batch : new AppendBatch[]{batch("op-1", VersionToken.initial(), "{\"n\":1}"),
                    batch("op-9", null, "{\"n\":1}"), batch("op-8", VersionToken.of("stale"), "{\"n\":1}")}) {
                Throwable deleted = failure(store.append(sealed, batch));
                assertTrue(sealed + " " + deleted, deleted instanceof SessionStoreDeletedException);
            }
        }
        assertEquals(Arrays.asList("{\"n\":1}"), lines(root("t")));
    }
}
