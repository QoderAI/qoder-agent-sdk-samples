import { describe, expect, it } from "vitest";
import {
  createNativeDirectoryPicker,
  type CommandExecutor,
} from "../../../../src/server/platform/native-directory-picker.js";

class RecordingExecutor implements CommandExecutor {
  readonly calls: Array<{ file: string; args: readonly string[] }> = [];

  constructor(
    private readonly result:
      | { code: number; stdout: string; stderr: string }
      | Error,
  ) {}

  async run(
    file: string,
    args: readonly string[],
  ): Promise<{ code: number; stdout: string; stderr: string }> {
    this.calls.push({ file, args });
    if (this.result instanceof Error) {
      throw this.result;
    }
    return this.result;
  }
}

describe("native directory picker", () => {
  it.each([
    {
      platform: "darwin" as const,
      file: "osascript",
      args: [
        "-e",
        'POSIX path of (choose folder with prompt "Select a Qoder Workspace")',
      ],
    },
    {
      platform: "win32" as const,
      file: "powershell.exe",
      args: [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        'Add-Type -AssemblyName System.Windows.Forms; $dialog = New-Object System.Windows.Forms.FolderBrowserDialog; $dialog.Description = "Select a Qoder Workspace"; if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($dialog.SelectedPath) } else { exit 1 }',
      ],
    },
    {
      platform: "linux" as const,
      file: "zenity",
      args: [
        "--file-selection",
        "--directory",
        "--title=Select a Qoder Workspace",
      ],
    },
  ])("uses the fixed $platform command without shell input", async (example) => {
    const executor = new RecordingExecutor({
      code: 0,
      stdout: "/selected/project\n",
      stderr: "",
    });
    const picker = createNativeDirectoryPicker({
      platform: example.platform,
      executor,
    });

    expect(await picker.pick()).toBe("/selected/project");
    expect(executor.calls).toEqual([
      { file: example.file, args: example.args },
    ]);
  });

  it("treats an empty exit-one result as user cancellation", async () => {
    const picker = createNativeDirectoryPicker({
      platform: "linux",
      executor: new RecordingExecutor({ code: 1, stdout: "", stderr: "" }),
    });

    expect(await picker.pick()).toBeNull();
  });

  it("maps a missing picker executable to a stable application error", async () => {
    const missing = Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" });
    const picker = createNativeDirectoryPicker({
      platform: "linux",
      executor: new RecordingExecutor(missing),
    });

    await expect(picker.pick()).rejects.toMatchObject({
      code: "PICKER_UNAVAILABLE",
    });
  });
});
