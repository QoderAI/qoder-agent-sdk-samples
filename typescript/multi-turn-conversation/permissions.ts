import type { CanUseTool, PermissionResult } from "@qoder-ai/qoder-agent-sdk";
import { preview, type ToolObserver } from "./tool-observer.js";

export const READ_TOOLS = ["Read", "Glob", "Grep"];
export const CODE_MODE_TOOLS = ["CodeMode", "CodeModeWait"];

/** 并行权限请求共用命令输入循环，各自按实际 toolUseID 结算。 */
export class Permissions {
  private readonly pending = new Map<
    string,
    (allow: boolean, reason?: string) => void
  >();

  constructor(
    private readonly tools: ToolObserver,
    private readonly write: (line: string) => void,
  ) {}

  readonly canUseTool: CanUseTool = async (name, input, options) => {
    if (CODE_MODE_TOOLS.includes(name))
      return { behavior: "allow", updatedInput: input };
    if (!READ_TOOLS.includes(name))
      return {
        behavior: "deny",
        message: `Tool ${name} is not permitted by this read-only sample.`,
      };
    if (options.signal.aborted)
      return { behavior: "deny", message: "Permission request cancelled." };
    return new Promise<PermissionResult>((resolve) => {
      const id = options.toolUseID;
      const finish = (allow: boolean, reason = "Denied by the user.") => {
        options.signal.removeEventListener("abort", abort);
        this.pending.delete(id);
        this.tools.permission(id, false);
        resolve(
          allow
            ? { behavior: "allow", updatedInput: input }
            : { behavior: "deny", message: reason },
        );
      };
      const abort = () => finish(false, "Permission request cancelled.");
      this.pending.set(id, finish);
      this.tools.permission(id, true);
      options.signal.addEventListener("abort", abort, { once: true });
      this.write(
        `[permission ${id}] ${name} ${preview(input)}\n  /allow ${id}  or  /deny ${id}`,
      );
    });
  };

  answer(id: string, allow: boolean): void {
    const finish = this.pending.get(id);
    if (!finish) {
      this.write(`[permission] No pending request for ${id}.`);
      return;
    }
    finish(allow);
    this.write(`[permission ${id}] ${allow ? "allowed" : "denied"}`);
  }

  cancel(): void {
    for (const finish of [...this.pending.values()])
      finish(false, "Query closed.");
  }
}
