package com.qoder.samples.subagents;

import com.qoder.sdk.InvalidOptionsException;
import com.qoder.sdk.MessageCursor;
import com.qoder.sdk.SessionOptions;
import com.qoder.sdk.agent.AgentDefinition;
import com.qoder.sdk.message.AssistantMessage;
import com.qoder.sdk.message.ResultMessage;
import com.qoder.sdk.message.SdkMessage;
import com.qoder.sdk.message.TextBlock;
import org.junit.Test;

import java.io.ByteArrayOutputStream;
import java.io.PrintStream;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Iterator;
import java.util.Map;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

public class SubagentsTest {
    private static PrintStream sink() {
        return new PrintStream(new ByteArrayOutputStream());
    }

    @Test
    public void declaresTwoReadOnlyAgentsThatInheritTheSessionModel() {
        Map<String, AgentDefinition> agents = Subagents.agents();
        assertEquals(Arrays.asList("architecture-explorer", "test-strategist"), new ArrayList<String>(agents.keySet()));
        for (AgentDefinition agent : agents.values()) {
            assertFalse(agent.description().isEmpty());
            assertTrue(agent.prompt().contains("Do not modify files."));
            assertEquals(Arrays.asList("Read", "Glob", "Grep"), agent.tools());
            assertEquals(Integer.valueOf(5), agent.maxTurns().get());
            assertFalse(agent.model().isPresent());
            assertFalse(agent.permissionMode().isPresent());
            assertFalse(agent.background());
        }
    }

    @Test
    public void exposesDelegationAndEveryToolTheAgentsDeclare() {
        SessionOptions options = Subagents.request(Paths.get(".")).options();
        assertEquals(Arrays.asList("Agent", "Read", "Glob", "Grep"), options.tools());
        assertEquals(options.tools(), options.allowedTools());
        for (AgentDefinition agent : Subagents.agents().values()) {
            assertTrue(agent.tools() + " must be exposed by the session", options.tools().containsAll(agent.tools()));
        }
        assertEquals(Subagents.agents(), options.agents());
        assertTrue(Subagents.PROMPT.contains("Do not inspect the repository yourself"));
        assertEquals(Integer.valueOf(8), options.maxTurns().get());
        assertEquals(Paths.get(".").toAbsolutePath().normalize().toString(),
                Paths.get(options.workingDirectory().get().toString()).toAbsolutePath().normalize().toString());
    }

    @Test
    public void rejectsAMissingWorkspace() {
        assertThrows(IllegalArgumentException.class,
                () -> Subagents.request(Paths.get("does-not-exist-" + System.nanoTime())));
    }

    @Test
    public void theSdkRequiresADescriptionAndAPrompt() {
        assertThrows(InvalidOptionsException.class, () -> AgentDefinition.builder().prompt("p").build());
        assertThrows(InvalidOptionsException.class, () -> AgentDefinition.builder().description("d").build());
    }

    @Test
    public void printsAssistantTextAndClosesTheCursor() throws Exception {
        Cursor cursor = new Cursor(new AssistantMessage(null, null, null, Arrays.asList(new TextBlock("Plan"))),
                ResultMessage.builder().wireSubtype("success").result("Plan").build());
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        Subagents.consume(cursor, new PrintStream(bytes, true, "UTF-8"));
        assertEquals("Plan" + System.lineSeparator(), bytes.toString("UTF-8"));
        assertTrue(cursor.closed);
    }

    @Test
    public void failsOnErrorResultsAndMissingResults() {
        Cursor error = new Cursor(ResultMessage.builder().wireSubtype("error").wireIsError(true).build());
        assertThrows(Subagents.SampleFailure.class, () -> Subagents.consume(error, sink()));
        assertTrue(error.closed);
        Cursor empty = new Cursor();
        assertThrows(Subagents.SampleFailure.class, () -> Subagents.consume(empty, sink()));
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
