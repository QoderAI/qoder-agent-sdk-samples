package com.qoder.samples.conversation;
import com.qoder.sdk.*;
import com.qoder.sdk.message.*;
import org.junit.Test;
import java.io.*;
import java.nio.file.Paths;
import static org.junit.Assert.*;

public class MultiTurnConversationTest {
    @Test public void readsExactlyOneResultAndReusesCursorForNextTurn() throws Exception {
        ResultMessage first = success(), second = success();
        Cursor cursor = new Cursor(assistant("one"), first, assistant("two"), second);
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        PrintStream out = new PrintStream(bytes, true, "UTF-8");
        assertSame(first, MultiTurnConversation.readTurn(cursor, out));
        assertTrue(cursor.hasNext());
        assertSame(second, MultiTurnConversation.readTurn(cursor, out));
        assertEquals("one" + System.lineSeparator() + "two" + System.lineSeparator(), bytes.toString("UTF-8"));
        assertFalse(cursor.closed);
    }
    @Test public void eofWithoutResultIsFailure() {
        assertThrows(IllegalStateException.class, () -> MultiTurnConversation.readTurn(new Cursor(), sink()));
    }
    @Test public void errorNeedsAcknowledgedInterruptAndUnknownAlwaysFails() {
        ResultMessage error = ResultMessage.builder().wireSubtype("error").wireIsError(true).build();
        assertThrows(IllegalStateException.class, () -> MultiTurnConversation.requireTurn(error, false));
        MultiTurnConversation.requireTurn(error, true);
        MultiTurnConversation.requireTurn(success(), false);
        ResultMessage unknown = ResultMessage.builder().wireSubtype("future").build();
        assertThrows(IllegalStateException.class, () -> MultiTurnConversation.requireTurn(unknown, true));
    }
    @Test public void resumeUsesCliLocalStorageAndSameWorkspace() {
        SessionOptions options = MultiTurnConversation.options(Paths.get("."), "previous-session");
        assertEquals("previous-session", options.resumeSessionId().get());
        assertEquals(SessionStorage.cliLocal().mode(), options.sessionStorage().mode());
        assertEquals(Paths.get("."), options.workingDirectory().get());
        assertFalse(MultiTurnConversation.options(Paths.get("."), null).resumeSessionId().isPresent());
        assertEquals(options.tools(), options.allowedTools());
        assertFalse(options.tools().contains("Bash"));
    }

    private static final class Cursor implements MessageCursor {
        final java.util.Iterator<SdkMessage> messages;
        boolean closed;
        Cursor(SdkMessage... messages) { this.messages = java.util.Arrays.asList(messages).iterator(); }
        public boolean hasNext() { return messages.hasNext(); }
        public SdkMessage next() { return messages.next(); }
        public void close() { closed = true; }
    }
    private static PrintStream sink() { return new PrintStream(new ByteArrayOutputStream()); }
    private static AssistantMessage assistant(String text) {
        return new AssistantMessage(null, null, null, java.util.Arrays.asList(new TextBlock(text)));
    }
    private static ResultMessage success() { return ResultMessage.builder().wireSubtype("success").build(); }

}
