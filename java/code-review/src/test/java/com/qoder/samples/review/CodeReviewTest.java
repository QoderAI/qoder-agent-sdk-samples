package com.qoder.samples.review;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.TimeUnit;
import static org.junit.Assert.*;

public class CodeReviewTest {
    @Rule public TemporaryFolder temp = new TemporaryFolder();
    @Test public void enforcesByteLimitIncludingMultibyteText() throws Exception {
        assertEquals(CodeReview.MAX_DIFF_BYTES, CodeReview.readBounded(
                new ByteArrayInputStream(new byte[CodeReview.MAX_DIFF_BYTES])).length);
        assertThrows(IOException.class, () -> CodeReview.readBounded(
                new ByteArrayInputStream(new byte[CodeReview.MAX_DIFF_BYTES + 1])));
        byte[] unicode = String.join("", Collections.nCopies(40_000, "书")).getBytes(StandardCharsets.UTF_8);
        assertThrows(IOException.class, () -> CodeReview.readBounded(new ByteArrayInputStream(unicode)));
    }
    @Test public void rejectsOptionsAndShellSyntaxInRevisions() {
        for (String ref : new String[]{"--output=x", "-R", "HEAD;echo hi", "HEAD\n", "$(echo hi)", ""}) {
            assertThrows(IllegalArgumentException.class, () -> CodeReview.revision(ref));
        }
        assertEquals("origin/main", CodeReview.revision("origin/main"));
        assertEquals("HEAD~1", CodeReview.revision("HEAD~1"));
    }
    @Test public void readsTrackedWorkingTreeDiffAndBranchDiff() throws Exception {
        Path repo = repository();
        write(repo, "item.txt", "old\n");
        git(repo, "add", "item.txt");
        git(repo, "commit", "-qm", "base");
        write(repo, "item.txt", "new\n");
        write(repo, "untracked.txt", "not in diff\n");
        String working = CodeReview.readDiff(repo, null, "HEAD");
        assertTrue(working.contains("-old"));
        assertTrue(working.contains("+new"));
        assertFalse(working.contains("untracked.txt"));
        git(repo, "commit", "-qam", "change");
        String branch = CodeReview.readDiff(repo, "HEAD~1", "HEAD");
        assertTrue(branch.contains("+new"));
        assertThrows(IllegalArgumentException.class, () -> CodeReview.readDiff(repo, null, "HEAD"));
    }
    @Test public void keepsGitWarningsOutOfTheDiff() throws Exception {
        Path repo = repository();
        write(repo, "item.txt", "old\n");
        git(repo, "add", "item.txt");
        git(repo, "commit", "-qm", "base");
        // A tag and a branch with the same name make Git warn on stderr while still exiting 0.
        git(repo, "tag", "v1");
        git(repo, "branch", "v1");
        write(repo, "item.txt", "new\n");
        String diff = CodeReview.readDiff(repo, null, "v1");
        assertTrue(diff.contains("+new"));
        assertFalse(diff, diff.contains("warning:"));
        assertFalse(diff, diff.contains("ambiguous"));
    }
    @Test public void rejectsFailedGitInsteadOfSendingItsErrorAsDiff() throws Exception {
        Path repo = repository();
        assertThrows(IOException.class, () -> CodeReview.readDiff(repo, null, "missing-ref"));
        Path nonRepo = temp.newFolder("not-a-repo").toPath();
        assertThrows(IOException.class, () -> CodeReview.readDiff(nonRepo, null, "HEAD"));
    }
    private Path repository() throws Exception {
        Path repo = temp.newFolder().toPath();
        git(repo, "init", "-q");
        return repo;
    }
    private static void write(Path repo, String file, String text) throws IOException {
        Files.write(repo.resolve(file), text.getBytes(StandardCharsets.UTF_8));
    }
    private void git(Path repo, String... args) throws Exception {
        List<String> command = new ArrayList<String>(Arrays.asList("git", "-c", "user.name=Sample",
                "-c", "user.email=sample@example.invalid", "-c", "commit.gpgSign=false",
                "-c", "core.hooksPath=" + temp.getRoot().getAbsolutePath()));
        command.addAll(Arrays.asList(args));
        File log = temp.newFile();
        Process process = new ProcessBuilder(command).directory(repo.toFile()).redirectErrorStream(true)
                .redirectOutput(log).start();
        try {
            assertTrue("Git fixture timed out", process.waitFor(10, TimeUnit.SECONDS));
            assertEquals(new String(Files.readAllBytes(log.toPath()), StandardCharsets.UTF_8), 0, process.exitValue());
        } finally {
            if (process.isAlive()) process.destroyForcibly();
        }
    }
}
