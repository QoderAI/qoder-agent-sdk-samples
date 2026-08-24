import { readdir, realpath } from "node:fs/promises";
import { basename, isAbsolute, join, relative, sep } from "node:path";
import type {
  WorkspaceFileItem,
  WorkspaceFileSearchResult,
} from "../../shared/workspace-files.js";
import type { WorkspaceService } from "./workspace-service.js";

const IGNORED_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
]);

type SearchLimits = {
  maxEntries: number;
  maxDepth: number;
  maxResults: number;
};

const DEFAULT_LIMITS: SearchLimits = {
  maxEntries: 10_000,
  maxDepth: 20,
  maxResults: 40,
};

type SessionFileRoots = {
  workspaceId: string;
  allowedDirectories: string[];
};

type FileRoot = {
  absolute: string;
  rootLabel: string;
  source: WorkspaceFileItem["source"];
};

type RootSearch = {
  items: WorkspaceFileItem[];
  truncated: boolean;
};

type ScanBudget = {
  scannedEntries: number;
};

function isWithinRoot(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return pathFromRoot === "" || (
    pathFromRoot !== ".." &&
    !pathFromRoot.startsWith(`..${sep}`) &&
    !isAbsolute(pathFromRoot)
  );
}

/** Lists browser-safe paths under a Session's server-resolved file roots. */
export class WorkspaceFileService {
  readonly #workspaces: WorkspaceService;
  readonly #resolveSession: (
    sessionId: string,
  ) => Promise<SessionFileRoots>;
  readonly #limits: SearchLimits;

  constructor(options: {
    workspaces: WorkspaceService;
    resolveSession: (sessionId: string) => Promise<SessionFileRoots>;
    limits?: SearchLimits;
  }) {
    this.#workspaces = options.workspaces;
    this.#resolveSession = options.resolveSession;
    this.#limits = options.limits ?? DEFAULT_LIMITS;
  }

  async search(
    sessionId: string,
    query: string,
    signal?: AbortSignal,
  ): Promise<WorkspaceFileSearchResult> {
    signal?.throwIfAborted();
    const resolved = await this.#resolveSession(sessionId);
    signal?.throwIfAborted();
    const workspace = await this.#workspaces.require(resolved.workspaceId);
    signal?.throwIfAborted();
    const roots: FileRoot[] = [
      {
        absolute: workspace.path,
        rootLabel: workspace.displayName,
        source: "workspace",
      },
      ...[...new Set(resolved.allowedDirectories)]
        .filter((path) => path !== workspace.path)
        .sort((left, right) => left.localeCompare(right))
        .map((path) => ({
          absolute: path,
          rootLabel: basename(path) || path,
          source: "allowed" as const,
        })),
    ];
    const budget: ScanBudget = { scannedEntries: 0 };
    const searched: RootSearch[] = [];
    for (const root of roots) {
      signal?.throwIfAborted();
      if (budget.scannedEntries >= this.#limits.maxEntries) {
        searched.push({ items: [], truncated: true });
        break;
      }
      searched.push(await this.#searchRoot(root, query, budget, signal));
    }
    const normalizedQuery = query.toLocaleLowerCase();
    const items = searched.flatMap((result) => result.items);
    items.sort((left, right) => {
      const leftPrefix = left.path
        .toLocaleLowerCase()
        .startsWith(normalizedQuery);
      const rightPrefix = right.path
        .toLocaleLowerCase()
        .startsWith(normalizedQuery);
      if (leftPrefix !== rightPrefix) return leftPrefix ? -1 : 1;
      const pathOrder = left.path.localeCompare(right.path);
      if (pathOrder !== 0) return pathOrder;
      if (left.source !== right.source) {
        return left.source === "workspace" ? -1 : 1;
      }
      return left.rootLabel.localeCompare(right.rootLabel);
    });
    return {
      items: items.slice(0, this.#limits.maxResults),
      truncated:
        searched.some((result) => result.truncated) ||
        items.length > this.#limits.maxResults,
    };
  }

  async #searchRoot(
    root: FileRoot,
    query: string,
    budget: ScanBudget,
    signal?: AbortSignal,
  ): Promise<RootSearch> {
    const directories = [
      { absolute: root.absolute, relative: "", depth: 0 },
    ];
    const matches: string[] = [];
    const normalizedQuery = query.toLocaleLowerCase();
    let truncated = false;
    let scanLimitReached = false;

    while (directories.length > 0 && !scanLimitReached) {
      signal?.throwIfAborted();
      const directory = directories.shift();
      if (directory === undefined) break;
      let canonicalDirectory: string;
      let entries;
      try {
        canonicalDirectory = await realpath(directory.absolute);
        signal?.throwIfAborted();
        if (!isWithinRoot(root.absolute, canonicalDirectory)) continue;
        entries = await readdir(canonicalDirectory, { withFileTypes: true });
      } catch {
        signal?.throwIfAborted();
        continue;
      }
      signal?.throwIfAborted();
      entries.sort((left, right) => left.name.localeCompare(right.name));
      for (const entry of entries) {
        signal?.throwIfAborted();
        if (budget.scannedEntries >= this.#limits.maxEntries) {
          truncated = true;
          scanLimitReached = true;
          break;
        }
        budget.scannedEntries += 1;
        if (entry.isSymbolicLink()) continue;
        const relative =
          directory.relative.length === 0
            ? entry.name
            : `${directory.relative}/${entry.name}`;
        if (entry.isDirectory()) {
          if (IGNORED_DIRECTORIES.has(entry.name)) continue;
          if (directory.depth >= this.#limits.maxDepth) {
            truncated = true;
            continue;
          }
          directories.push({
            absolute: join(canonicalDirectory, entry.name),
            relative,
            depth: directory.depth + 1,
          });
          continue;
        }
        if (
          entry.isFile() &&
          relative.toLocaleLowerCase().includes(normalizedQuery)
        ) {
          matches.push(relative);
        }
      }
    }

    matches.sort((left, right) => {
      const leftPrefix = left.toLocaleLowerCase().startsWith(normalizedQuery);
      const rightPrefix = right.toLocaleLowerCase().startsWith(normalizedQuery);
      if (leftPrefix !== rightPrefix) return leftPrefix ? -1 : 1;
      return left.localeCompare(right);
    });
    if (matches.length > this.#limits.maxResults) truncated = true;
    return {
      items: matches
        .slice(0, this.#limits.maxResults)
        .map((path) => ({
          path,
          mention: root.source === "workspace" ? path : join(root.absolute, path),
          rootLabel: root.rootLabel,
          source: root.source,
        })),
      truncated,
    };
  }
}
