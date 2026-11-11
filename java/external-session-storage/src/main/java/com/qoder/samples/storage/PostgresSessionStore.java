package com.qoder.samples.storage;

import com.qoder.sdk.SessionStoreConflictException;
import com.qoder.sdk.SessionStoreDeletedException;
import com.qoder.sdk.session.AppendBatch;
import com.qoder.sdk.session.AppendResult;
import com.qoder.sdk.session.SessionDeletionStore;
import com.qoder.sdk.session.SessionKey;
import com.qoder.sdk.session.SessionSnapshot;
import com.qoder.sdk.session.SessionStoreEntry;
import com.qoder.sdk.session.VersionToken;

import java.net.URI;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Properties;
import java.util.concurrent.Callable;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.TimeUnit;

/**
 * PostgreSQL reference adapter for the Java SDK's SessionStore contract.
 *
 * <p>Entries are TEXT rows, because the contract requires each raw JSON line to be returned
 * byte for byte and JSONB would normalize it. The increasing seq column preserves append order.
 * Three small tables hold what the contract adds to plain storage: the version of each transcript,
 * the operations already applied, and the seals of deleted transcripts.
 *
 * <p>Every write is one transaction that first takes an advisory lock for its session, so appends
 * and deletions from any number of hosts are applied one at a time.
 */
public final class PostgresSessionStore implements SessionDeletionStore, AutoCloseable {
    private static final String KEY = "project_key = ? AND session_id = ? AND subpath = ?";

    private final Connection connection;
    private final String entries;
    private final String heads;
    private final String operations;
    private final String seals;
    // The SDK must not be blocked by store I/O, so every statement runs on this worker, which is
    // also the only thread that uses the connection.
    private final ExecutorService worker = Executors.newSingleThreadExecutor(task -> {
        Thread thread = new Thread(task, "postgres-session-store");
        thread.setDaemon(true);
        return thread;
    });

    /** The caller owns {@code connection}, uses it for nothing else, and closes it after this store. */
    public PostgresSessionStore(Connection connection) {
        this(connection, "qoder_session");
    }

    public PostgresSessionStore(Connection connection, String tablePrefix) {
        if (!tablePrefix.matches("[A-Za-z_][A-Za-z0-9_]{0,39}")) {
            throw new IllegalArgumentException(
                    "Invalid table prefix. Use up to 40 letters, digits, and underscores.");
        }
        this.connection = connection;
        this.entries = tablePrefix + "_entries";
        this.heads = tablePrefix + "_heads";
        this.operations = tablePrefix + "_operations";
        this.seals = tablePrefix + "_seals";
    }

    /**
     * Opens a connection from the URL form the TypeScript and Python samples use,
     * {@code postgresql://user:password@host:port/database}. The URL is never logged.
     */
    public static Connection open(String url) throws SQLException {
        URI uri;
        try {
            uri = URI.create(url);
        } catch (IllegalArgumentException malformed) {
            uri = URI.create("invalid:/");
        }
        boolean postgres = "postgresql".equals(uri.getScheme()) || "postgres".equals(uri.getScheme());
        if (!postgres || uri.getHost() == null) {
            throw new IllegalArgumentException("Use postgresql://user:password@host:port/database.");
        }
        Properties credentials = new Properties();
        String userInfo = uri.getUserInfo();
        if (userInfo != null) {
            int colon = userInfo.indexOf(':');
            credentials.setProperty("user", colon < 0 ? userInfo : userInfo.substring(0, colon));
            if (colon >= 0) credentials.setProperty("password", userInfo.substring(colon + 1));
        }
        String jdbc = "jdbc:postgresql://" + uri.getHost() + (uri.getPort() < 0 ? "" : ":" + uri.getPort())
                + (uri.getRawPath() == null ? "/" : uri.getRawPath())
                + (uri.getRawQuery() == null ? "" : "?" + uri.getRawQuery());
        // Calling the driver directly does not depend on which class loader DriverManager searches.
        return new org.postgresql.Driver().connect(jdbc, credentials);
    }

    public CompletionStage<Void> ensureSchema() {
        return transaction(() -> {
            String key = "project_key TEXT NOT NULL, session_id TEXT NOT NULL, subpath TEXT NOT NULL";
            try (Statement statement = connection.createStatement()) {
                statement.execute("CREATE TABLE IF NOT EXISTS " + entries + " (seq BIGSERIAL PRIMARY KEY, "
                        + key + ", uuid TEXT, entry TEXT NOT NULL)");
                statement.execute("CREATE INDEX IF NOT EXISTS " + entries + "_lookup_idx ON " + entries
                        + " (project_key, session_id, subpath, seq)");
                statement.execute("CREATE UNIQUE INDEX IF NOT EXISTS " + entries + "_uuid_idx ON " + entries
                        + " (project_key, session_id, subpath, uuid) WHERE uuid IS NOT NULL");
                statement.execute("CREATE TABLE IF NOT EXISTS " + heads + " (" + key
                        + ", version BIGINT NOT NULL, PRIMARY KEY (project_key, session_id, subpath))");
                statement.execute("CREATE TABLE IF NOT EXISTS " + operations + " (" + key
                        + ", operation_id TEXT NOT NULL, version BIGINT NOT NULL, appended INTEGER NOT NULL, "
                        + "PRIMARY KEY (project_key, session_id, subpath, operation_id))");
                // whole_session marks a seal that covers the root and every subpath of the session.
                statement.execute("CREATE TABLE IF NOT EXISTS " + seals + " (" + key
                        + ", whole_session BOOLEAN NOT NULL, "
                        + "PRIMARY KEY (project_key, session_id, subpath, whole_session))");
            }
            return null;
        });
    }

    @Override
    public CompletionStage<AppendResult> append(SessionKey key, AppendBatch batch) {
        return transaction(() -> {
            lock(key.projectKey(), key.sessionId());
            try (PreparedStatement sealed = prepare("SELECT 1 FROM " + seals
                    + " WHERE project_key = ? AND session_id = ? AND (whole_session OR subpath = ?)", key);
                 ResultSet rows = sealed.executeQuery()) {
                if (rows.next()) throw new SessionStoreDeletedException("session transcript was deleted");
            }
            // Replay is resolved before the version check: a retry may carry a stale expected version.
            try (PreparedStatement applied = prepare("SELECT version, appended FROM " + operations
                    + " WHERE " + KEY + " AND operation_id = ?", key, batch.operationId().value());
                 ResultSet rows = applied.executeQuery()) {
                if (rows.next()) return AppendResult.replayed(token(rows.getLong(1)), rows.getInt(2));
            }
            long version = 0;
            try (PreparedStatement head = prepare("SELECT version FROM " + heads + " WHERE " + KEY, key);
                 ResultSet rows = head.executeQuery()) {
                if (rows.next()) version = rows.getLong(1);
            }
            VersionToken current = token(version);
            if (batch.expectedVersion() != null && !batch.expectedVersion().equals(current)) {
                throw new SessionStoreConflictException("expectedVersion " + batch.expectedVersion().value()
                        + " does not match current version " + current.value(), current.value());
            }

            // The same UUID with identical JSON is a retry and is skipped; different JSON is a conflict.
            List<SessionStoreEntry> fresh = new ArrayList<SessionStoreEntry>();
            Map<String, String> added = new HashMap<String, String>();
            for (SessionStoreEntry entry : batch.entries()) {
                // Only an absent UUID skips this check; an empty string is a UUID like any other.
                if (!entry.uuid().isPresent()) {
                    fresh.add(entry);
                    continue;
                }
                String uuid = entry.uuid().get();
                String known = added.get(uuid);
                if (known == null) {
                    try (PreparedStatement stored = prepare("SELECT entry FROM " + entries
                            + " WHERE " + KEY + " AND uuid = ?", key, uuid);
                         ResultSet rows = stored.executeQuery()) {
                        if (rows.next()) known = rows.getString(1);
                    }
                }
                if (known == null) {
                    added.put(uuid, entry.rawJson());
                    fresh.add(entry);
                } else if (!known.equals(entry.rawJson())) {
                    throw new SessionStoreConflictException("uuid " + uuid
                            + " already stored with different rawJson");
                }
            }

            try (PreparedStatement insert = connection.prepareStatement("INSERT INTO " + entries
                    + " (project_key, session_id, subpath, uuid, entry) VALUES (?, ?, ?, ?, ?)")) {
                for (SessionStoreEntry entry : fresh) {
                    bind(insert, key, entry.uuid().orElse(null), entry.rawJson());
                    insert.addBatch();
                }
                insert.executeBatch();
            }
            try (PreparedStatement head = prepare("INSERT INTO " + heads
                    + " (project_key, session_id, subpath, version) VALUES (?, ?, ?, ?) "
                    + "ON CONFLICT (project_key, session_id, subpath) DO UPDATE SET version = EXCLUDED.version",
                    key, version + 1)) {
                head.executeUpdate();
            }
            try (PreparedStatement operation = prepare("INSERT INTO " + operations
                    + " (project_key, session_id, subpath, operation_id, version, appended) "
                    + "VALUES (?, ?, ?, ?, ?, ?)", key, batch.operationId().value(), version + 1, fresh.size())) {
                operation.executeUpdate();
            }
            return AppendResult.applied(token(version + 1), fresh.size());
        });
    }

    @Override
    public CompletionStage<Optional<SessionSnapshot>> load(SessionKey key) {
        // One statement reads one snapshot, so the entries and their version are consistent.
        return transaction(() -> {
            try (PreparedStatement select = prepare("SELECT h.version, e.entry FROM " + heads + " h LEFT JOIN "
                    + entries + " e ON e.project_key = h.project_key AND e.session_id = h.session_id "
                    + "AND e.subpath = h.subpath WHERE h.project_key = ? AND h.session_id = ? "
                    + "AND h.subpath = ? ORDER BY e.seq", key);
                 ResultSet rows = select.executeQuery()) {
                List<SessionStoreEntry> loaded = new ArrayList<SessionStoreEntry>();
                long version = 0;
                while (rows.next()) {
                    version = rows.getLong(1);
                    String entry = rows.getString(2);
                    if (entry != null) loaded.add(SessionStoreEntry.of(entry));
                }
                return version == 0 ? Optional.<SessionSnapshot>empty()
                        : Optional.of(SessionSnapshot.of(loaded, token(version)));
            }
        });
    }

    @Override
    public CompletionStage<List<SessionKey>> listSessions(String projectKey) {
        return transaction(() -> {
            try (PreparedStatement select = connection.prepareStatement(
                    "SELECT session_id, subpath FROM " + heads + " WHERE project_key = ?")) {
                select.setString(1, projectKey);
                try (ResultSet rows = select.executeQuery()) {
                    List<SessionKey> keys = new ArrayList<SessionKey>();
                    while (rows.next()) keys.add(SessionKey.of(projectKey, rows.getString(1), rows.getString(2)));
                    return keys;
                }
            }
        });
    }

    @Override
    public CompletionStage<Void> deleteSession(SessionKey key) {
        return transaction(() -> {
            lock(key.projectKey(), key.sessionId());
            try (PreparedStatement seal = prepare("INSERT INTO " + seals
                    + " (project_key, session_id, subpath, whole_session) VALUES (?, ?, ?, FALSE) "
                    + "ON CONFLICT DO NOTHING", key)) {
                seal.executeUpdate();
            }
            for (String table : new String[]{entries, heads, operations}) {
                try (PreparedStatement delete = prepare("DELETE FROM " + table + " WHERE " + KEY, key)) {
                    delete.executeUpdate();
                }
            }
            return null;
        });
    }

    @Override
    public CompletionStage<Void> deleteSessionTree(String projectKey, String sessionId) {
        return transaction(() -> {
            lock(projectKey, sessionId);
            SessionKey root = SessionKey.of(projectKey, sessionId);
            // The seal commits with the deletion, so a transcript created later is rejected too.
            try (PreparedStatement seal = prepare("INSERT INTO " + seals
                    + " (project_key, session_id, subpath, whole_session) VALUES (?, ?, ?, TRUE) "
                    + "ON CONFLICT DO NOTHING", root)) {
                seal.executeUpdate();
            }
            for (String table : new String[]{entries, heads, operations}) {
                try (PreparedStatement delete = connection.prepareStatement(
                        "DELETE FROM " + table + " WHERE project_key = ? AND session_id = ?")) {
                    delete.setString(1, projectKey);
                    delete.setString(2, sessionId);
                    delete.executeUpdate();
                }
            }
            return null;
        });
    }

    /** Lets accepted statements finish, then stops the worker. The connection stays open. */
    @Override
    public void close() {
        worker.shutdown();
        try {
            worker.awaitTermination(5, TimeUnit.SECONDS);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
        }
    }

    static VersionToken token(long version) {
        return version == 0 ? VersionToken.initial() : VersionToken.of(Long.toString(version));
    }

    // Serializes writers of one session until the transaction ends. A hash collision between two
    // sessions only makes them wait for each other.
    private void lock(String projectKey, String sessionId) throws SQLException {
        try (PreparedStatement lock = connection.prepareStatement(
                "SELECT pg_advisory_xact_lock(hashtext(?), hashtext(?))")) {
            lock.setString(1, projectKey);
            lock.setString(2, sessionId);
            lock.execute();
        }
    }

    private PreparedStatement prepare(String sql, SessionKey key, Object... more) throws SQLException {
        PreparedStatement statement = connection.prepareStatement(sql);
        try {
            bind(statement, key, more);
            return statement;
        } catch (SQLException failure) {
            statement.close();
            throw failure;
        }
    }

    private static void bind(PreparedStatement statement, SessionKey key, Object... more) throws SQLException {
        statement.setString(1, key.projectKey());
        statement.setString(2, key.sessionId());
        statement.setString(3, key.subpath());
        for (int index = 0; index < more.length; index++) statement.setObject(index + 4, more[index]);
    }

    // Runs one transaction on the worker. Failures complete the returned stage with the original
    // exception; nothing is thrown to the SDK.
    private <T> CompletionStage<T> transaction(Callable<T> work) {
        CompletableFuture<T> stage = new CompletableFuture<T>();
        try {
            worker.execute(() -> {
                try {
                    connection.setAutoCommit(false);
                    T result = work.call();
                    connection.commit();
                    stage.complete(result);
                } catch (Throwable failure) {
                    try {
                        connection.rollback();
                    } catch (Exception ignored) {
                        // The original failure is the one worth reporting.
                    }
                    stage.completeExceptionally(failure);
                }
            });
        } catch (RejectedExecutionException closed) {
            stage.completeExceptionally(closed);
        }
        return stage;
    }
}
