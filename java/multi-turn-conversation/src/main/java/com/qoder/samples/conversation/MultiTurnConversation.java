package com.qoder.samples.conversation;

import com.qoder.sdk.MessageCursor;
import com.qoder.sdk.QoderClient;
import com.qoder.sdk.QoderSession;
import com.qoder.sdk.SessionOptions;
import com.qoder.sdk.SessionStorage;
import com.qoder.sdk.UserInput;
import com.qoder.sdk.auth.Auth;
import com.qoder.sdk.message.AssistantMessage;
import com.qoder.sdk.message.ResultMessage;
import com.qoder.sdk.message.ResultOutcome;
import com.qoder.sdk.message.SdkMessage;
import com.qoder.sdk.model.ModelId;
import com.qoder.sdk.model.ModelSelection;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Arrays;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

public final class MultiTurnConversation implements AutoCloseable {
    private final QoderClient client;
    private final Path workspace;
    private final ExecutorService output = Executors.newSingleThreadExecutor();
    // The terminal thread owns lifecycle state. Only the output worker reads the cursor.
    private QoderSession session;
    private MessageCursor cursor;
    private Future<ResultMessage> turn;
    private String sessionId;
    private boolean interrupted;

    MultiTurnConversation(QoderClient client, Path workspace) {
        this.client = client;
        this.workspace = workspace;
    }

    static SessionOptions options(Path workspace, String resume) {
        SessionOptions.Builder builder = SessionOptions.builder().workingDirectory(workspace)
                .modelSelection(ModelSelection.staticModel(ModelId.of("auto")))
                .tools(Arrays.asList("Read", "Glob", "Grep")).allowedTools(Arrays.asList("Read", "Glob", "Grep"))
                // The SDK forwards only allowlisted environment variables to the CLI child.
                // HOME locates the CLI-local history under the user home that /resume reopens.
                .putEnvironment("HOME", System.getProperty("user.home"))
                .sessionStorage(SessionStorage.cliLocal()).maxTurns(8);
        if (resume != null) builder.resume(resume);
        return builder.build();
    }

    void open(boolean resume) throws Exception {
        if (session != null) throw new IllegalStateException("Close the current session first.");
        if (resume && sessionId == null) throw new IllegalStateException("No session to resume.");
        session = client.openSession(options(workspace, resume ? sessionId : null)).toCompletableFuture().get();
        sessionId = session.initialization().toCompletableFuture().get().sessionId().orElse(sessionId);
        cursor = session.messages().openCursor();
        System.out.println("[lifecycle] session opened" + (resume ? " (resumed)" : ""));
    }

    void send(String prompt) throws Exception {
        if (session == null) {
            System.out.println("[state] closed; use /resume");
            return;
        }
        if (turn != null) {
            if (!turn.isDone()) {
                System.out.println("[state] generating; use /wait or /interrupt");
                return;
            }
            awaitTurn();
        }
        interrupted = false;
        session.send(UserInput.text(prompt)).toCompletableFuture().get();
        final MessageCursor activeCursor = cursor;
        turn = output.submit(() -> readTurn(activeCursor, System.out));
    }

    static ResultMessage readTurn(MessageCursor cursor, PrintStream out) {
        while (cursor.hasNext()) {
            SdkMessage message = cursor.next();
            if (message instanceof AssistantMessage) out.println(((AssistantMessage) message).getText());
            if (message instanceof ResultMessage) return (ResultMessage) message;
        }
        throw new IllegalStateException("Session ended before the turn result.");
    }

    static void requireTurn(ResultMessage result, boolean acknowledgedInterrupt) {
        if (result.outcome() == ResultOutcome.UNKNOWN
                || (result.outcome() != ResultOutcome.SUCCESS && !acknowledgedInterrupt)) {
            throw new IllegalStateException("Turn did not succeed: " + result.outcome());
        }
    }

    void awaitTurn() throws Exception {
        if (turn == null) return;
        ResultMessage result = turn.get(); // send() alone does not mean the answer has finished.
        turn = null;
        sessionId = result.sessionId().orElse(sessionId);
        System.out.println("[state] turn result: " + result.outcome()
                + (interrupted ? " (interrupt acknowledged)" : ""));
        requireTurn(result, interrupted);
        if (interrupted && result.outcome() == ResultOutcome.ERROR) {
            // On the pinned SDK/CLI pair, direct continuation after an interrupted
            // error result can stall. Reopen from persisted history before reuse.
            System.out.println("[lifecycle] recovering after interruption");
            closeSession();
            open(true);
        }
    }

    void interrupt() throws Exception {
        if (session == null || turn == null || turn.isDone()) return;
        interrupted = session.interrupt().toCompletableFuture().get().interrupted();
        System.out.println("[state] interrupt acknowledged: " + interrupted);
    }

    void closeSession() {
        try {
            if (session != null) session.close();
        } finally {
            if (cursor != null) cursor.close();
            if (turn != null) turn.cancel(true);
            session = null;
            cursor = null;
            turn = null;
        }
        System.out.println("[lifecycle] session closed; retained session ID: " + (sessionId != null));
    }

    @Override
    public void close() {
        try { closeSession(); } finally { output.shutdownNow(); }
    }

    public static void main(String[] args) {
        try (QoderClient client = QoderClient.builder().auth(Auth.accessTokenEnv()).build();
             MultiTurnConversation app = new MultiTurnConversation(client,
                     Paths.get(args.length == 0 ? "." : args[0]).toAbsolutePath().normalize())) {
            BufferedReader terminal = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
            app.open(false);
            System.out.println("Commands: /status /wait /interrupt /close /resume /exit. Other input sends a turn.");
            String line;
            while ((line = terminal.readLine()) != null) {
                String input = line.trim();
                if (input.isEmpty()) continue;
                if ("/exit".equals(input)) return;
                if ("/wait".equals(input)) app.awaitTurn();
                else if ("/interrupt".equals(input)) app.interrupt();
                else if ("/close".equals(input)) app.closeSession();
                else if ("/resume".equals(input)) app.open(true);
                else if ("/status".equals(input)) System.out.println("[state] "
                        + (app.session == null ? "closed" : app.turn != null && !app.turn.isDone() ? "generating" : "idle"));
                else if (input.startsWith("/")) System.out.println("Unknown application command.");
                else app.send(input);
            }
            app.awaitTurn();
        } catch (Exception failure) {
            System.err.println("Conversation failed (" + failure.getClass().getSimpleName() + ").");
            System.exit(1);
        }
    }
}
