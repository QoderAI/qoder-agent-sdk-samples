import { constants } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { AppError } from "../errors/app-error.js";

function filesystemCode(error: unknown): string | undefined {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }
  return undefined;
}

export async function validateWorkspacePath(input: string): Promise<string> {
  if (!isAbsolute(input)) {
    throw new AppError({
      code: "WORKSPACE_PATH_NOT_ABSOLUTE",
      message: "Enter an absolute project path.",
      status: 400,
      retryable: true,
    });
  }

  let canonicalPath: string;
  try {
    canonicalPath = await realpath(input);
  } catch (error) {
    throw new AppError(
      {
        code:
          filesystemCode(error) === "ENOENT"
            ? "WORKSPACE_PATH_MISSING"
            : "WORKSPACE_PATH_UNREADABLE",
        message:
          filesystemCode(error) === "ENOENT"
            ? "The selected path does not exist."
            : "The selected path cannot be read.",
        status: filesystemCode(error) === "ENOENT" ? 404 : 403,
        retryable: true,
      },
      { cause: error },
    );
  }

  let metadata;
  try {
    metadata = await stat(canonicalPath);
  } catch (error) {
    throw new AppError(
      {
        code: "WORKSPACE_PATH_UNREADABLE",
        message: "The selected path cannot be read.",
        status: 403,
        retryable: true,
      },
      { cause: error },
    );
  }
  if (!metadata.isDirectory()) {
    throw new AppError({
      code: "WORKSPACE_PATH_NOT_DIRECTORY",
      message: "Select a project directory, not a file.",
      status: 400,
      retryable: true,
    });
  }
  try {
    await access(canonicalPath, constants.R_OK);
  } catch (error) {
    throw new AppError(
      {
        code: "WORKSPACE_PATH_UNREADABLE",
        message: "The selected directory cannot be read.",
        status: 403,
        retryable: true,
      },
      { cause: error },
    );
  }
  return canonicalPath;
}
