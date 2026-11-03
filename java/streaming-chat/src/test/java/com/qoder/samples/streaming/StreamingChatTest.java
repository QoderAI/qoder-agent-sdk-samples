package com.qoder.samples.streaming;

import com.qoder.sdk.MessageCursor;
import com.qoder.sdk.message.AssistantMessage;
import com.qoder.sdk.message.PartialMessage;
import com.qoder.sdk.message.ResultMessage;
import com.qoder.sdk.message.SdkMessage;
import com.qoder.sdk.message.TextBlock;
import org.junit.Test;

import java.io.ByteArrayOutputStream;
import java.io.PrintStream;
import java.util.Arrays;
import java.util.Iterator;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertThrows;

public class StreamingChatTest {
    @Test
    public void deltasReplaceFullMessageButNotLaterFullOnlyMessages() throws Exception {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        Cursor cursor = new Cursor(delta("Hello"), delta(" world"), assistant("Hello world"),
                assistant("!"), success());
        assertEquals(2, StreamingChat.readTurn(cursor, new PrintStream(bytes, true, "UTF-8")));
        assertEquals("Hello world!" + System.lineSeparator(), bytes.toString("UTF-8"));
        assertFalse(cursor.closed);
    }

    @Test
    public void ignoresNonTextDeltasAndSupportsFullMessageFallback() throws Exception {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        Cursor cursor = new Cursor(new PartialMessage(null, null,
                "{\"event\":{\"delta\":{\"type\":\"thinking_delta\",\"text\":\"private reasoning\"}}}"),
                new PartialMessage(null, null, "{}"), assistant("answer"), success());
        assertEquals(0, StreamingChat.readTurn(cursor, new PrintStream(bytes, true, "UTF-8")));
        assertEquals("answer" + System.lineSeparator(), bytes.toString("UTF-8"));
    }

    @Test
    public void newMessageAndNewTurnResetFallbackState() throws Exception {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        Cursor cursor = new Cursor(delta("one"), new PartialMessage(null, null,
                "{\"event\":{\"type\":\"message_start\"}}"), assistant("two"), success(), assistant("three"), success());
        PrintStream out = new PrintStream(bytes, true, "UTF-8");
        assertEquals(1, StreamingChat.readTurn(cursor, out));
        assertEquals(0, StreamingChat.readTurn(cursor, out));
        assertEquals("onetwo" + System.lineSeparator() + "three" + System.lineSeparator(), bytes.toString("UTF-8"));
        assertFalse(cursor.closed);
    }

    @Test
    public void rejectsErrorUnknownAndMissingResult() {
        assertThrows(IllegalStateException.class, () -> StreamingChat.readTurn(new Cursor(), sink()));
        assertThrows(IllegalStateException.class, () -> StreamingChat.readTurn(new Cursor(
                ResultMessage.builder().wireSubtype("success").wireIsError(true).build()), sink()));
        assertThrows(IllegalStateException.class, () -> StreamingChat.readTurn(new Cursor(
                ResultMessage.builder().wireSubtype("future").build()), sink()));
    }

    private static PartialMessage delta(String text) {
        return new PartialMessage(null, null, "{\"event\":{\"type\":\"content_block_delta\",\"delta\":"
                + "{\"type\":\"text_delta\",\"text\":\"" + text + "\"}}}");
    }

    private static final class Cursor implements MessageCursor {
        final Iterator<SdkMessage> messages;
        boolean closed;
        Cursor(SdkMessage... messages) { this.messages = Arrays.asList(messages).iterator(); }
        public boolean hasNext() { return messages.hasNext(); }
        public SdkMessage next() { return messages.next(); }
        public void close() { closed = true; }
    }

    private static PrintStream sink() { return new PrintStream(new ByteArrayOutputStream()); }

    private static AssistantMessage assistant(String text) {
        return new AssistantMessage(null, null, null, Arrays.asList(new TextBlock(text)));
    }

    private static ResultMessage success() { return ResultMessage.builder().wireSubtype("success").build(); }
}
