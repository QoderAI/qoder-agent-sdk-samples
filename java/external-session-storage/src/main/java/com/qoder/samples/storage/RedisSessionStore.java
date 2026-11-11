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
import redis.clients.jedis.UnifiedJedis;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Base64;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.Callable;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.TimeUnit;

/**
 * Redis reference adapter for the Java SDK's SessionStore contract.
 *
 * <p>Each transcript is a Redis list in append order plus a hash holding its version, applied
 * operation IDs, and entry UUID digests. A set indexes the transcripts of a project, and string keys
 * seal deleted transcripts. Every write is one Lua script, so Redis applies it atomically and
 * serializes writers from any number of hosts.
 *
 * <p>The scripts build some key names from their arguments, which a standalone Redis accepts and a
 * Redis Cluster does not.
 */
public final class RedisSessionStore implements SessionDeletionStore, AutoCloseable {
    // KEYS: entries, meta, transcript seal, session seal, project index.
    // ARGV: initial version, operation ID, "1" when a version is expected, expected version,
    //       index member, then one (uuid field, rawJson) pair per entry. The field is "u:" plus the
    //       UUID, or "" when the entry has none; an empty-string UUID is still a UUID ("u:").
    private static final String APPEND = String.join("\n",
            "if redis.call('EXISTS', KEYS[3], KEYS[4]) > 0 then return {'deleted'} end",
            // Replay is resolved before the version check: a retry may carry a stale expected version.
            "local prior = redis.call('HGET', KEYS[2], 'o:' .. ARGV[2])",
            "if prior then return {'replayed', prior} end",
            "local version = tonumber(redis.call('HGET', KEYS[2], 'version') or '0')",
            "local current = version == 0 and ARGV[1] or tostring(version)",
            "if ARGV[3] == '1' and ARGV[4] ~= current then return {'conflict', current} end",
            "local fresh, added = {}, {}",
            "for i = 6, #ARGV, 2 do",
            "  local field, raw = ARGV[i], ARGV[i + 1]",
            "  if field == '' then",
            "    fresh[#fresh + 1] = raw",
            "  else",
            "    local digest = redis.sha1hex(raw)",
            "    local known = added[field] or redis.call('HGET', KEYS[2], field)",
            "    if not known then",
            "      added[field] = digest",
            "      fresh[#fresh + 1] = raw",
            "    elseif known ~= digest then",
            "      return {'uuid', string.sub(field, 3)}",
            "    end",
            "  end",
            "end",
            "for _, raw in ipairs(fresh) do redis.call('RPUSH', KEYS[1], raw) end",
            "for field, digest in pairs(added) do redis.call('HSET', KEYS[2], field, digest) end",
            "local result = tostring(version + 1) .. ':' .. tostring(#fresh)",
            "redis.call('HSET', KEYS[2], 'version', version + 1, 'o:' .. ARGV[2], result)",
            "redis.call('SADD', KEYS[5], ARGV[5])",
            "return {'applied', result}");

    // KEYS: entries, meta. Reading both in one script keeps the entries and their version consistent.
    private static final String LOAD = String.join("\n",
            "local version = redis.call('HGET', KEYS[2], 'version')",
            "if not version then return false end",
            "return {version, redis.call('LRANGE', KEYS[1], 0, -1)}");

    // KEYS: entries, meta, transcript seal, project index. ARGV: index member.
    private static final String DELETE = String.join("\n",
            "redis.call('SET', KEYS[3], '1')",
            "redis.call('DEL', KEYS[1], KEYS[2])",
            "redis.call('SREM', KEYS[4], ARGV[1])",
            "return 1");

    // KEYS: project index, session seal. ARGV: member prefix, entries key prefix, meta key prefix.
    // The seal is written first, so a transcript created later under this session is rejected too.
    private static final String DELETE_TREE = String.join("\n",
            "redis.call('SET', KEYS[2], '1')",
            "for _, member in ipairs(redis.call('SMEMBERS', KEYS[1])) do",
            "  if string.sub(member, 1, #ARGV[1]) == ARGV[1] then",
            "    redis.call('DEL', ARGV[2] .. member, ARGV[3] .. member)",
            "    redis.call('SREM', KEYS[1], member)",
            "  end",
            "end",
            "return 1");

    private final UnifiedJedis client;
    private final String prefix;
    // The SDK must not be blocked by store I/O, so every command runs on this worker.
    private final ExecutorService worker = Executors.newSingleThreadExecutor(task -> {
        Thread thread = new Thread(task, "redis-session-store");
        thread.setDaemon(true);
        return thread;
    });

    /** The caller owns {@code client} and closes it after closing this store. */
    public RedisSessionStore(UnifiedJedis client) {
        this(client, "qoder:samples:session-storage");
    }

    public RedisSessionStore(UnifiedJedis client, String prefix) {
        this.client = client;
        this.prefix = prefix.replaceAll(":+$", "");
    }

    @Override
    public CompletionStage<AppendResult> append(SessionKey key, AppendBatch batch) {
        return submit(() -> {
            List<String> arguments = new ArrayList<String>();
            arguments.add(VersionToken.initial().value());
            arguments.add(batch.operationId().value());
            arguments.add(batch.expectedVersion() == null ? "0" : "1");
            arguments.add(batch.expectedVersion() == null ? "" : batch.expectedVersion().value());
            arguments.add(member(key));
            for (SessionStoreEntry entry : batch.entries()) {
                arguments.add(entry.uuid().map(uuid -> "u:" + uuid).orElse(""));
                arguments.add(entry.rawJson());
            }
            List<?> reply = (List<?>) client.eval(APPEND, Arrays.asList(transcriptKey("entries", key),
                    transcriptKey("meta", key), transcriptKey("sealed", key), sessionSealKey(key.projectKey(),
                            key.sessionId()), indexKey(key.projectKey())), arguments);
            String outcome = (String) reply.get(0);
            if ("deleted".equals(outcome)) {
                throw new SessionStoreDeletedException("session transcript was deleted");
            }
            if ("conflict".equals(outcome)) {
                String current = (String) reply.get(1);
                throw new SessionStoreConflictException("expectedVersion " + batch.expectedVersion().value()
                        + " does not match current version " + current, current);
            }
            if ("uuid".equals(outcome)) {
                throw new SessionStoreConflictException("uuid " + reply.get(1)
                        + " already stored with different rawJson");
            }
            String[] result = ((String) reply.get(1)).split(":");
            VersionToken version = VersionToken.of(result[0]);
            int appended = Integer.parseInt(result[1]);
            return "replayed".equals(outcome)
                    ? AppendResult.replayed(version, appended) : AppendResult.applied(version, appended);
        });
    }

    @Override
    public CompletionStage<Optional<SessionSnapshot>> load(SessionKey key) {
        return submit(() -> {
            List<?> reply = (List<?>) client.eval(LOAD,
                    Arrays.asList(transcriptKey("entries", key), transcriptKey("meta", key)),
                    new ArrayList<String>());
            if (reply == null) return Optional.<SessionSnapshot>empty();
            List<SessionStoreEntry> entries = new ArrayList<SessionStoreEntry>();
            for (Object raw : (List<?>) reply.get(1)) entries.add(SessionStoreEntry.of((String) raw));
            return Optional.of(SessionSnapshot.of(entries, VersionToken.of((String) reply.get(0))));
        });
    }

    @Override
    public CompletionStage<List<SessionKey>> listSessions(String projectKey) {
        return submit(() -> {
            List<SessionKey> keys = new ArrayList<SessionKey>();
            for (String member : client.smembers(indexKey(projectKey))) {
                // A member is "<session>:main" or "<session>:child:<subpath>", with encoded segments.
                String[] parts = member.split(":");
                keys.add(parts.length == 2 ? SessionKey.of(projectKey, decoded(parts[0]))
                        : SessionKey.of(projectKey, decoded(parts[0]), decoded(parts[2])));
            }
            return keys;
        });
    }

    @Override
    public CompletionStage<Void> deleteSession(SessionKey key) {
        return submit(() -> {
            client.eval(DELETE, Arrays.asList(transcriptKey("entries", key), transcriptKey("meta", key),
                    transcriptKey("sealed", key), indexKey(key.projectKey())), Arrays.asList(member(key)));
            return null;
        });
    }

    @Override
    public CompletionStage<Void> deleteSessionTree(String projectKey, String sessionId) {
        return submit(() -> {
            String project = ":" + encoded(projectKey) + ":";
            client.eval(DELETE_TREE, Arrays.asList(indexKey(projectKey), sessionSealKey(projectKey, sessionId)),
                    Arrays.asList(encoded(sessionId) + ":", prefix + ":entries" + project,
                            prefix + ":meta" + project));
            return null;
        });
    }

    /** Lets accepted commands finish, then stops the worker. The Redis client stays open. */
    @Override
    public void close() {
        worker.shutdown();
        try {
            worker.awaitTermination(5, TimeUnit.SECONDS);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
        }
    }

    // Failures complete the returned stage with the original exception; nothing is thrown to the SDK.
    private <T> CompletionStage<T> submit(Callable<T> command) {
        CompletableFuture<T> stage = new CompletableFuture<T>();
        try {
            worker.execute(() -> {
                try {
                    stage.complete(command.call());
                } catch (Throwable failure) {
                    stage.completeExceptionally(failure);
                }
            });
        } catch (RejectedExecutionException closed) {
            stage.completeExceptionally(closed);
        }
        return stage;
    }

    static String encoded(String value) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(value.getBytes(StandardCharsets.UTF_8));
    }

    static String decoded(String value) {
        return new String(Base64.getUrlDecoder().decode(value), StandardCharsets.UTF_8);
    }

    static String member(SessionKey key) {
        return encoded(key.sessionId())
                + (key.subpath().isEmpty() ? ":main" : ":child:" + encoded(key.subpath()));
    }

    String transcriptKey(String kind, SessionKey key) {
        return prefix + ":" + kind + ":" + encoded(key.projectKey()) + ":" + member(key);
    }

    String sessionSealKey(String projectKey, String sessionId) {
        return prefix + ":sealed:" + encoded(projectKey) + ":" + encoded(sessionId);
    }

    String indexKey(String projectKey) {
        return prefix + ":index:" + encoded(projectKey);
    }
}
