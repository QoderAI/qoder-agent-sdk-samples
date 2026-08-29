import { spawn } from "node:child_process";
import { AppError } from "../errors/app-error.js";
import type { DirectoryPicker } from "./directory-picker.js";

export interface CommandExecutor {
  run(
    file: string,
    args: readonly string[],
  ): Promise<{ code: number; stdout: string; stderr: string }>;
}

const pickerCommands = {
  darwin: {
    file: "osascript",
    args: [
      "-e",
      'POSIX path of (choose folder with prompt "Select a Qoder Workspace")',
    ],
  },
  win32: {
    file: "powershell.exe",
    args: [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      'Add-Type -AssemblyName System.Windows.Forms; $dialog = New-Object System.Windows.Forms.FolderBrowserDialog; $dialog.Description = "Select a Qoder Workspace"; if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($dialog.SelectedPath) } else { exit 1 }',
    ],
  },
  linux: {
    file: "zenity",
    args: [
      "--file-selection",
      "--directory",
      "--title=Select a Qoder Workspace",
    ],
  },
} as const;

function isMissingExecutable(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

export function createSpawnCommandExecutor(): CommandExecutor {
  return {
    run: (file, args) =>
      new Promise((resolve, reject) => {
        const child = spawn(file, [...args], {
          shell: false,
          stdio: ["ignore", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => {
          stdout += chunk;
        });
        child.stderr.on("data", (chunk: string) => {
          stderr += chunk;
        });
        child.once("error", reject);
        child.once("close", (code) => {
          resolve({ code: code ?? 1, stdout, stderr });
        });
      }),
  };
}

export function createNativeDirectoryPicker(options: {
  platform: NodeJS.Platform;
  executor: CommandExecutor;
}): DirectoryPicker {
  return {
    async pick(): Promise<string | null> {
      const command =
        options.platform === "darwin" ||
        options.platform === "win32" ||
        options.platform === "linux"
          ? pickerCommands[options.platform]
          : undefined;
      if (command === undefined) {
        throw new AppError({
          code: "PICKER_UNAVAILABLE",
          message: "No native directory picker is available on this platform.",
          status: 501,
          retryable: false,
        });
      }

      let result: { code: number; stdout: string; stderr: string };
      try {
        result = await options.executor.run(command.file, command.args);
      } catch (error) {
        if (isMissingExecutable(error)) {
          throw new AppError(
            {
              code: "PICKER_UNAVAILABLE",
              message: "The native directory picker is not installed.",
              status: 501,
              retryable: false,
            },
            { cause: error },
          );
        }
        throw error;
      }

      const selectedPath = result.stdout.trim();
      if (result.code === 1 && selectedPath.length === 0) {
        return null;
      }
      if (result.code !== 0 || selectedPath.length === 0) {
        throw new AppError({
          code: "PICKER_FAILED",
          message: "The native directory picker could not select a project.",
          status: 500,
          retryable: true,
        });
      }
      return selectedPath;
    },
  };
}
