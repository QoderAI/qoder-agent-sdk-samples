package com.qoder.samples.quickstart;

import com.qoder.sdk.MessageCursor;
import com.qoder.sdk.SessionOptions;
import com.qoder.sdk.message.AssistantMessage;
import com.qoder.sdk.message.ResultMessage;
import com.qoder.sdk.message.SdkMessage;
import com.qoder.sdk.message.TextBlock;
import org.junit.Test;

import java.io.ByteArrayOutputStream;
import java.io.PrintStream;
import java.nio.file.Paths;
import java.util.Arrays;
import java.util.Iterator;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertSame;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

public class QuickstartTest {
    @Test
    public void printsAssistantTextWithoutDuplicatingResultAndClosesCursor() throws Exception {
        StubCursor cursor = new StubCursor(
                new AssistantMessage(null, null, null, Arrays.asList(new TextBlock("Hello"))),
                ResultMessage.builder().wireSubtype("success").result("Hello").build());
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        Quickstart.consume(cursor, new PrintStream(bytes, true, "UTF-8"));
        assertEquals("Hello" + System.lineSeparator(), bytes.toString("UTF-8"));
        assertTrue(cursor.closed);
    }

    @Test
    public void rejectsErrorEvenWhenSubtypeSaysSuccess() {
        StubCursor cursor = new StubCursor(ResultMessage.builder()
                .wireSubtype("success").wireIsError(true).build());
        assertThrows(IllegalStateException.class, () -> Quickstart.consume(cursor, sink()));
        assertTrue(cursor.closed);
    }

    @Test
    public void rejectsUnknownResult() {
        StubCursor cursor = new StubCursor(ResultMessage.builder().wireSubtype("future-result").build());
        assertThrows(IllegalStateException.class, () -> Quickstart.consume(cursor, sink()));
        assertTrue(cursor.closed);
    }

    @Test
    public void rejectsEndOfStreamWithoutResult() {
        StubCursor cursor = new StubCursor();
        assertThrows(IllegalStateException.class, () -> Quickstart.consume(cursor, sink()));
        assertTrue(cursor.closed);
    }

    @Test
    public void propagatesFailureAfterSuccessAndClosesCursor() {
        StubCursor cursor = new StubCursor(ResultMessage.builder().wireSubtype("success").build());
        cursor.endFailure = new IllegalStateException("stream failed");
        assertSame(cursor.endFailure,
                assertThrows(IllegalStateException.class, () -> Quickstart.consume(cursor, sink())));
        assertTrue(cursor.closed);
    }

    @Test
    public void limitsVisibleAndPreapprovedToolsToRepositoryReads() {
        SessionOptions options = Quickstart.request(Paths.get("."), "Describe this repository").options();
        assertEquals(Arrays.asList("Read", "Glob", "Grep"), options.tools());
        assertEquals(Arrays.asList("Read", "Glob", "Grep"), options.allowedTools());
        assertEquals(Integer.valueOf(4), options.maxTurns().get());
    }

    private static PrintStream sink() {
        return new PrintStream(new ByteArrayOutputStream());
    }

    // Only the public cursor contract is stubbed; no CLI, credentials, or SDK internals.
    private static final class StubCursor implements MessageCursor {
        private final Iterator<SdkMessage> messages;
        private RuntimeException endFailure;
        private boolean closed;

        StubCursor(SdkMessage... messages) {
            this.messages = Arrays.asList(messages).iterator();
        }

        @Override
        public boolean hasNext() {
            if (!messages.hasNext() && endFailure != null) {
                throw endFailure;
            }
            return messages.hasNext();
        }

        @Override
        public SdkMessage next() {
            return messages.next();
        }

        @Override
        public void close() {
            closed = true;
        }
    }
}
