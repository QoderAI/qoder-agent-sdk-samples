package com.qoder.samples.questions;

import com.qoder.sdk.MessageCursor;
import com.qoder.sdk.SessionOptions;
import com.qoder.sdk.json.JsonObject;
import com.qoder.sdk.json.JsonString;
import com.qoder.sdk.json.JsonValue;
import com.qoder.sdk.message.ResultMessage;
import com.qoder.sdk.message.SdkMessage;
import com.qoder.sdk.permission.CancellationToken;
import com.qoder.sdk.permission.PermissionMode;
import com.qoder.sdk.permission.PermissionResult;
import com.qoder.sdk.permission.ToolPermissionRequest;
import org.junit.Test;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.PrintStream;
import java.io.StringReader;
import java.util.Arrays;
import java.util.Collections;
import java.util.Iterator;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

public class AskUserQuestionTest {
    private static final String INPUT = "{\"questions\":["
            + "{\"question\":\"Which deployment environment should we use?\",\"header\":\"Environment\","
            + "\"options\":[{\"label\":\"Staging\",\"description\":\"Pre-release\"},{\"label\":\"Production\"}],"
            + "\"multiSelect\":false},"
            + "{\"question\":\"Which validation checks should run?\",\"options\":[{\"label\":\"Unit tests\"},"
            + "{\"label\":\"Integration tests\"},{\"label\":\"Security scan\"}],\"multiSelect\":true}],"
            + "\"metadata\":{\"source\":\"test\"}}";

    private static CancellationToken token(final boolean cancelled) {
        return new CancellationToken() {
            public boolean isCancelled() { return cancelled; }
            public void onCancel(Runnable listener) { if (cancelled) listener.run(); }
        };
    }

    private static ToolPermissionRequest request(String tool, JsonValue input) {
        return ToolPermissionRequest.of(tool, input, Collections.<JsonValue>emptyList());
    }

    private static BufferedReader terminal(String text) {
        return new BufferedReader(new StringReader(text));
    }

    private static PrintStream sink() {
        return new PrintStream(new ByteArrayOutputStream());
    }

    private static AskUserQuestion.Question question(boolean multiSelect) {
        return AskUserQuestion.parseQuestions(JsonValue.parse(INPUT)).get(multiSelect ? 1 : 0);
    }

    @Test
    public void parsesHeadersOptionsAndSelectionMode() {
        List<AskUserQuestion.Question> questions = AskUserQuestion.parseQuestions(JsonValue.parse(INPUT));
        assertEquals(2, questions.size());
        assertEquals("Environment", questions.get(0).header);
        assertEquals("Pre-release", questions.get(0).options.get(0).description);
        assertNull(questions.get(0).options.get(1).description);
        assertFalse(questions.get(0).multiSelect);
        assertEquals("Question 2", questions.get(1).header);
        assertEquals(3, questions.get(1).options.size());
        assertTrue(questions.get(1).multiSelect);
    }

    @Test
    public void rejectsMalformedQuestions() {
        for (String input : new String[]{"\"text\"", "{}", "{\"questions\":[]}", "{\"questions\":[1]}",
                "{\"questions\":[{\"question\":\" \",\"options\":[{\"label\":\"A\"},{\"label\":\"B\"}]}]}",
                "{\"questions\":[{\"question\":\"Q\",\"options\":[{\"label\":\"A\"}]}]}",
                "{\"questions\":[{\"question\":\"Q\",\"options\":[{\"label\":\"A\"},\"B\"]}]}",
                "{\"questions\":[{\"question\":\"Q\",\"options\":[{\"label\":\"A\"},{\"label\":\"\"}]}]}"}) {
            assertThrows(input, IllegalArgumentException.class,
                    () -> AskUserQuestion.parseQuestions(JsonValue.parse(input)));
        }
    }

    @Test
    public void mapsNumbersDefaultsPrefixesAndCustomText() {
        assertEquals("Staging", AskUserQuestion.answer(question(false), "  "));
        assertEquals("Production", AskUserQuestion.answer(question(false), "2"));
        assertEquals("Production", AskUserQuestion.answer(question(false), "prod"));
        assertEquals("Canary first", AskUserQuestion.answer(question(false), " Canary first "));
        assertEquals("Unit tests, Security scan", AskUserQuestion.answer(question(true), "1, 3"));
        assertEquals("Security scan", AskUserQuestion.answer(question(true), "SEC"));
        // A prefix shared by two options does not identify one, so it is returned as a custom answer.
        AskUserQuestion.Question shared = AskUserQuestion.parseQuestions(JsonValue.parse("{\"questions\":["
                + "{\"question\":\"Q\",\"options\":[{\"label\":\"Unit tests\"},{\"label\":\"Unit benchmarks\"}]}]}"))
                .get(0);
        assertEquals("unit", AskUserQuestion.answer(shared, "unit"));
    }

    @Test
    public void rejectsInvalidNumericSelections() {
        assertNull(AskUserQuestion.answer(question(false), "0"));
        assertNull(AskUserQuestion.answer(question(false), "3"));
        assertNull(AskUserQuestion.answer(question(false), "1,2"));
        assertNull(AskUserQuestion.answer(question(true), "1,4"));
        assertNull(AskUserQuestion.answer(question(true), "99999999999999999999"));
    }

    @Test
    public void answersEveryQuestionAndKeepsOriginalInput() throws Exception {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        AtomicInteger answered = new AtomicInteger();
        JsonObject input = JsonValue.parse(INPUT).asObject();
        PermissionResult result = AskUserQuestion.respond(request("AskUserQuestion", input), token(false),
                terminal("9\n2\n1,3\n"), new PrintStream(bytes, true, "UTF-8"), answered);

        assertTrue(result.isAllowed());
        assertEquals(2, answered.get());
        JsonObject updated = result.updatedInput().get().asObject();
        assertEquals(input.get("questions"), updated.get("questions"));
        assertEquals(input.get("metadata"), updated.get("metadata"));
        assertEquals(JsonObject.builder()
                .put("Which deployment environment should we use?", JsonString.of("Production"))
                .put("Which validation checks should run?", JsonString.of("Unit tests, Security scan"))
                .build(), updated.get("answers"));
        String printed = bytes.toString("UTF-8");
        assertTrue(printed.contains("[Environment] Which deployment environment should we use?"));
        assertTrue(printed.contains("  1. Staging - Pre-release"));
        assertTrue(printed.contains("Invalid selection; try again."));
    }

    @Test
    public void acceptsTheLegacyToolNameAndDeniesOtherTools() {
        AtomicInteger answered = new AtomicInteger();
        assertTrue(AskUserQuestion.respond(request("ask_user", JsonValue.parse(INPUT)), token(false),
                terminal("\n\n"), sink(), answered).isAllowed());
        PermissionResult denied = AskUserQuestion.respond(request("Bash", JsonValue.parse(INPUT)), token(false),
                terminal("1\n1\n"), sink(), answered);
        assertFalse(denied.isAllowed());
        assertEquals("This sample handles only AskUserQuestion, not Bash.", denied.denyReason().get());
        assertEquals(2, answered.get());
    }

    @Test
    public void deniesMalformedInputCancellationAndEndOfInput() {
        AtomicInteger answered = new AtomicInteger();
        PermissionResult malformed = AskUserQuestion.respond(request("AskUserQuestion", JsonObject.empty()),
                token(false), terminal("1\n"), sink(), answered);
        assertFalse(malformed.isAllowed());
        assertEquals("AskUserQuestion input must contain a non-empty questions array.",
                malformed.denyReason().get());
        assertFalse(AskUserQuestion.respond(request("AskUserQuestion", JsonValue.parse(INPUT)), token(true),
                terminal("1\n1\n"), sink(), answered).isAllowed());
        assertEquals(0, answered.get());
        // The first question is answered, then input ends before the second. The request is denied
        // as a whole, so the answer that was typed is not delivered and must not be counted.
        assertFalse(AskUserQuestion.respond(request("AskUserQuestion", JsonValue.parse(INPUT)), token(false),
                terminal("1\n"), sink(), answered).isAllowed());
        assertEquals(0, answered.get());
    }

    @Test
    public void exposesOnlyTheQuestionToolAndWaitsLongerThanTheDefaultTimeout() {
        SessionOptions options = AskUserQuestion.options((request, cancellation) ->
                CompletableFuture.completedFuture(PermissionResult.deny("unused")));
        assertEquals(Collections.singletonList("AskUserQuestion"), options.tools());
        assertTrue(options.allowedTools().isEmpty());
        assertEquals(PermissionMode.DEFAULT, options.permissionMode().get());
        assertTrue(options.canUseTool().isPresent());
        assertTrue(options.controlRequestTimeoutMs() > SessionOptions.Builder.DEFAULT_CONTROL_REQUEST_TIMEOUT_MS);
        assertEquals(Integer.valueOf(3), options.maxTurns().get());
    }

    @Test
    public void printsTheResultOnceAndClosesTheCursor() throws Exception {
        Cursor cursor = new Cursor(ResultMessage.builder().wireSubtype("success").result("Use staging.").build());
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        AskUserQuestion.consume(cursor, new PrintStream(bytes, true, "UTF-8"));
        assertEquals(System.lineSeparator() + "assistant> Use staging." + System.lineSeparator(),
                bytes.toString("UTF-8"));
        assertTrue(cursor.closed);
    }

    @Test
    public void failsOnErrorResultsAndMissingResults() {
        Cursor error = new Cursor(ResultMessage.builder().wireSubtype("error").wireIsError(true).build());
        assertThrows(AskUserQuestion.SampleFailure.class, () -> AskUserQuestion.consume(error, sink()));
        assertTrue(error.closed);
        Cursor empty = new Cursor();
        assertThrows(AskUserQuestion.SampleFailure.class, () -> AskUserQuestion.consume(empty, sink()));
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
