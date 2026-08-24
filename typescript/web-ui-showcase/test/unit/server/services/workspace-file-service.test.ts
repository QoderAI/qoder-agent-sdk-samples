import {
  mkdir,
  mkdtemp,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import type { Dirent } from "node:fs";
import type { PathLike } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  StoredWorkspace,
  WorkspaceRepository,
} from "../../../../src/server/persistence/workspace-repository.js";
import { EventJournal } from "../../../../src/server/realtime/event-journal.js";
import { WorkspaceFileService } from "../../../../src/server/services/workspace-file-service.js";
import { WorkspaceService } from "../../../../src/server/services/workspace-service.js";

const workspaceId = "00000000-0000-4000-8000-000000000d11";
const temporaryDirectories: string[] = [];

const scanControl = vi.hoisted(() => ({
  afterRead: null as null | ((path: string) => Promise<void>),
  overrideRead: null as null | (
    (path: string) => Promise<Dirent[] | undefined>
  ),
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    readdir: async (path: PathLike, options: { withFileTypes: true }) => {
      const pathText = String(path);
      const overridden = await scanControl.overrideRead?.(pathText);
      const entries = overridden ?? await actual.readdir(path, options);
      await scanControl.afterRead?.(pathText);
      return entries;
    },
  };
});

class MemoryWorkspaceRepository implements WorkspaceRepository {
  constructor(readonly workspace: StoredWorkspace) {}

  async list(): Promise<StoredWorkspace[]> {
    return [this.workspace];
  }

  async registerOrGetByPath(): Promise<StoredWorkspace> {
    return this.workspace;
  }

  async upsert(): Promise<void> {}

  async remove(): Promise<void> {}
}

afterEach(async () => {
  scanControl.afterRead = null;
  scanControl.overrideRead = null;
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  );
});

async function temporaryDirectory(prefix: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), prefix));
  const canonical = await realpath(path);
  temporaryDirectories.push(canonical);
  return canonical;
}

type SearchLimits = {
  maxEntries: number;
  maxDepth: number;
  maxResults: number;
};

async function createService(
  root: string,
  limits?: SearchLimits,
  allowedDirectories: string[] = [],
): Promise<WorkspaceFileService> {
  const timestamp = "2026-08-14T08:00:00.000Z";
  const workspaces = new WorkspaceService({
    repository: new MemoryWorkspaceRepository({
      id: workspaceId,
      displayName: "fixture",
      path: root,
      createdAt: timestamp,
      updatedAt: timestamp,
    }),
    picker: { pick: async () => null },
    journal: new EventJournal({ epoch: "workspace-files", capacity: 10 }),
  });
  const options = {
    workspaces,
    resolveSession: async (sessionId: string) => {
      if (sessionId !== "00000000-0000-4000-8000-000000000d21") {
        throw new Error("Unknown Session fixture");
      }
      return { workspaceId, allowedDirectories };
    },
    ...(limits === undefined ? {} : { limits }),
  };
  return new WorkspaceFileService(options);
}

describe("WorkspaceFileService", () => {
  it("searches relative files without ignored directories or symlinks", async () => {
    const root = await temporaryDirectory("qoder-file-search-");
    const outside = await temporaryDirectory("qoder-file-outside-");
    await Promise.all([
      mkdir(join(root, "src/components"), { recursive: true }),
      mkdir(join(root, "docs"), { recursive: true }),
      mkdir(join(root, "node_modules/package"), { recursive: true }),
      mkdir(join(root, "dist"), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(join(root, "app.config.ts"), "export {};\n", "utf8"),
      writeFile(join(root, "src/app.ts"), "export {};\n", "utf8"),
      writeFile(join(root, "src/components/panel.tsx"), "export {};\n", "utf8"),
      writeFile(join(root, "docs/my guide.md"), "# Guide\n", "utf8"),
      writeFile(join(root, "node_modules/package/index.js"), "module.exports = {};\n", "utf8"),
      writeFile(join(root, "dist/bundle.js"), "bundle\n", "utf8"),
      writeFile(join(outside, "secret.txt"), "secret\n", "utf8"),
    ]);
    await symlink(outside, join(root, "outside-link"));
    const service = await createService(root);

    await expect(service.search("00000000-0000-4000-8000-000000000d21", "src/")).resolves.toEqual({
      items: [
        { path: "src/app.ts", mention: "src/app.ts", rootLabel: "fixture", source: "workspace" },
        { path: "src/components/panel.tsx", mention: "src/components/panel.tsx", rootLabel: "fixture", source: "workspace" },
      ],
      truncated: false,
    });
    await expect(service.search("00000000-0000-4000-8000-000000000d21", "app")).resolves.toEqual({
      items: [
        { path: "app.config.ts", mention: "app.config.ts", rootLabel: "fixture", source: "workspace" },
        { path: "src/app.ts", mention: "src/app.ts", rootLabel: "fixture", source: "workspace" },
      ],
      truncated: false,
    });
    const allPaths = (await service.search("00000000-0000-4000-8000-000000000d21", "")).items.map(
      (item) => item.path,
    );
    expect(allPaths).toContain("docs/my guide.md");
    expect(allPaths).not.toContain("node_modules/package/index.js");
    expect(allPaths).not.toContain("dist/bundle.js");
    expect(allPaths).not.toContain("outside-link/secret.txt");
  });

  it("bounds scanned entries, depth, and returned results", async () => {
    const root = await temporaryDirectory("qoder-file-limits-");
    await mkdir(join(root, "nested/deeper"), { recursive: true });
    await Promise.all([
      writeFile(join(root, "alpha.ts"), "a\n", "utf8"),
      writeFile(join(root, "beta.ts"), "b\n", "utf8"),
      writeFile(join(root, "gamma.ts"), "c\n", "utf8"),
      writeFile(join(root, "nested/inside.ts"), "d\n", "utf8"),
      writeFile(join(root, "nested/deeper/hidden.ts"), "e\n", "utf8"),
    ]);

    const resultLimited = await createService(root, {
      maxEntries: 100,
      maxDepth: 20,
      maxResults: 2,
    });
    await expect(resultLimited.search("00000000-0000-4000-8000-000000000d21", "")).resolves.toEqual({
      items: [
        { path: "alpha.ts", mention: "alpha.ts", rootLabel: "fixture", source: "workspace" },
        { path: "beta.ts", mention: "beta.ts", rootLabel: "fixture", source: "workspace" },
      ],
      truncated: true,
    });

    const depthLimited = await createService(root, {
      maxEntries: 100,
      maxDepth: 0,
      maxResults: 40,
    });
    const depthResult = await depthLimited.search("00000000-0000-4000-8000-000000000d21", "");
    expect(depthResult.items.map((item) => item.path)).toEqual([
      "alpha.ts",
      "beta.ts",
      "gamma.ts",
    ]);
    expect(depthResult.truncated).toBe(true);

    const entryLimited = await createService(root, {
      maxEntries: 1,
      maxDepth: 20,
      maxResults: 40,
    });
    const entryResult = await entryLimited.search("00000000-0000-4000-8000-000000000d21", "");
    expect(entryResult.items.length).toBeLessThanOrEqual(1);
    expect(entryResult.truncated).toBe(true);
  });

  it("shares one scan budget and gives the Workspace root priority", async () => {
    const root = await temporaryDirectory("qoder-file-workspace-");
    const allowed = await temporaryDirectory("qoder-file-allowed-");
    await Promise.all([
      writeFile(join(root, "workspace.ts"), "export {};\n", "utf8"),
      writeFile(join(root, "second.ts"), "export {};\n", "utf8"),
      writeFile(join(allowed, "allowed.ts"), "export {};\n", "utf8"),
      writeFile(join(allowed, "other.ts"), "export {};\n", "utf8"),
    ]);
    const service = await createService(root, {
      maxEntries: 1,
      maxDepth: 20,
      maxResults: 4,
    }, [allowed]);

    const result = await service.search(
      "00000000-0000-4000-8000-000000000d21",
      ".ts",
    );

    expect(result.items).toEqual([
      {
        path: "second.ts",
        mention: "second.ts",
        rootLabel: "fixture",
        source: "workspace",
      },
    ]);
    expect(result.truncated).toBe(true);
  });

  it("stops an in-flight scan when its request is aborted", async () => {
    const root = await temporaryDirectory("qoder-file-abort-");
    await writeFile(join(root, "match.ts"), "export {};\n", "utf8");
    const service = await createService(root);
    let enterScan: (() => void) | undefined;
    let releaseScan: (() => void) | undefined;
    const entered = new Promise<void>((resolve) => {
      enterScan = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      releaseScan = resolve;
    });
    scanControl.afterRead = async () => {
      enterScan?.();
      await blocked;
    };
    const controller = new AbortController();

    const search = service.search(
      "00000000-0000-4000-8000-000000000d21",
      "match",
      controller.signal,
    );
    await entered;
    controller.abort();
    releaseScan?.();

    await expect(search).rejects.toMatchObject({ name: "AbortError" });
  });

  it("skips an authorized root replaced by a symlink before scanning", async () => {
    const root = await temporaryDirectory("qoder-file-root-race-");
    const outside = await temporaryDirectory("qoder-file-root-outside-");
    const canonicalRoot = await realpath(root);
    await writeFile(join(outside, "outside-secret.txt"), "secret\n", "utf8");
    const service = await createService(canonicalRoot);
    await rm(canonicalRoot, { recursive: true });
    await symlink(outside, canonicalRoot, "dir");

    const result = await service.search(
      "00000000-0000-4000-8000-000000000d21",
      "outside-secret",
    );

    expect(result.items).toEqual([]);
  });

  it("skips a queued child replaced by a symlink outside its authorized root", async () => {
    const root = await temporaryDirectory("qoder-file-child-race-");
    const outside = await temporaryDirectory("qoder-file-child-outside-");
    const canonicalRoot = await realpath(root);
    const child = join(canonicalRoot, "child");
    await mkdir(child);
    await writeFile(join(outside, "outside-secret.txt"), "secret\n", "utf8");
    const service = await createService(canonicalRoot);
    scanControl.afterRead = async (path) => {
      if (path !== canonicalRoot) return;
      scanControl.afterRead = null;
      await rm(child, { recursive: true });
      await symlink(outside, child, "dir");
    };

    const result = await service.search(
      "00000000-0000-4000-8000-000000000d21",
      "outside-secret",
    );

    expect(result.items).toEqual([]);
  });

  it("uses the canonical filesystem root as a non-empty allowed-root label", async () => {
    const workspace = await temporaryDirectory("qoder-file-root-label-workspace-");
    const fixture = await temporaryDirectory("qoder-file-root-label-entry-");
    await writeFile(join(fixture, "root-file.ts"), "export {};\n", "utf8");
    const fixtureEntries = await readdir(fixture, { withFileTypes: true });
    scanControl.overrideRead = async (path) =>
      path === "/" ? fixtureEntries : undefined;
    const service = await createService(workspace, undefined, ["/"]);

    const result = await service.search(
      "00000000-0000-4000-8000-000000000d21",
      "root-file",
    );

    expect(result.items).toEqual([
      {
        path: "root-file.ts",
        mention: "/root-file.ts",
        rootLabel: "/",
        source: "allowed",
      },
    ]);
  });
});
