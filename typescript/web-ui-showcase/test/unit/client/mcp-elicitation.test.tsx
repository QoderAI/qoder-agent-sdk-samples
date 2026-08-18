// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InteractionCard } from "../../../src/client/features/interactions/interaction-card.js";
import { AppStore } from "../../../src/client/store/app-store.js";
import { StoreProvider } from "../../../src/client/store/store-context.js";
import { snapshotMcpElicitationSchema } from "../../../src/shared/mcp-elicitation-schema.js";
import type { InteractionView } from "../../../src/shared/model.js";

const sessionId = "00000000-0000-4000-8000-000000000e01";
const interactionId = "00000000-0000-4000-8000-000000000e02";

afterEach(cleanup);

function renderElicitation(requestedSchema: unknown) {
  const schemaSnapshot = snapshotMcpElicitationSchema(requestedSchema);
  const interaction: InteractionView = {
    id: interactionId,
    sessionId,
    kind: "mcp-elicitation",
    serverName: "showcase",
    mode: "form",
    prompt: "配置只读检查",
    requestedSchema: JSON.parse(
      JSON.stringify(schemaSnapshot.schema),
    ) as unknown,
    openedAt: "2026-08-16T08:00:00.000Z",
    status: "pending",
  };
  const respond = vi.fn(async () => ({
    commandId: "00000000-0000-4000-8000-000000000e03",
  }));
  render(
    <StoreProvider store={new AppStore()}>
      <InteractionCard interaction={interaction} respond={respond} />
    </StoreProvider>,
  );
  return { respond };
}

describe("MCP form elicitation", () => {
  it("validates required fields and submits typed safe-schema content", async () => {
    const user = userEvent.setup();
    const { respond } = renderElicitation({
      type: "object",
      title: "只读检查配置",
      description: "这些值将发送给 MCP Server。",
      required: ["confirmed", "count", "strategy"],
      properties: {
        confirmed: {
          type: "boolean",
          title: "确认只读访问",
          description: "允许 MCP 读取项目目录。",
        },
        count: { type: "integer", title: "检查次数" },
        threshold: { type: "number", title: "阈值" },
        strategy: {
          type: "string",
          title: "检查策略",
          enum: ["focused", "broad"],
        },
        note: { type: "string", title: "备注" },
      },
    });
    const card = screen.getByRole("article", { name: /showcase MCP 请求/ });
    const accept = within(card).getByRole("button", { name: "接受" });

    expect(within(card).getByText("只读检查配置")).toBeVisible();
    expect(within(card).getByText("这些值将发送给 MCP Server。")).toBeVisible();
    expect(accept).toBeDisabled();
    expect(within(card).getByText("请填写：确认只读访问、检查次数、检查策略")).toBeVisible();
    await user.selectOptions(within(card).getByLabelText("确认只读访问"), "true");
    await user.type(within(card).getByLabelText("检查次数"), "2");
    await user.type(within(card).getByLabelText("阈值"), "0.75");
    await user.selectOptions(within(card).getByLabelText("检查策略"), "focused");
    await user.type(within(card).getByLabelText("备注"), "只读");
    expect(accept).toBeEnabled();
    await user.click(accept);

    expect(respond).toHaveBeenCalledWith(interactionId, {
      kind: "elicit",
      action: "accept",
      content: {
        confirmed: true,
        count: 2,
        threshold: 0.75,
        strategy: "focused",
        note: "只读",
      },
    });
  });

  it("rejects invalid integer input without discarding optional controls", async () => {
    const user = userEvent.setup();
    renderElicitation({
      type: "object",
      properties: {
        count: { type: "integer", title: "检查次数" },
        enabled: { type: "boolean", title: "启用" },
      },
    });
    const card = screen.getByRole("article", { name: /showcase MCP 请求/ });
    const accept = within(card).getByRole("button", { name: "接受" });

    expect(accept).toBeEnabled();
    await user.type(within(card).getByLabelText("检查次数"), "1.5");
    expect(accept).toBeDisabled();
    expect(within(card).getByText("检查次数必须是整数。")).toBeVisible();
    await user.clear(within(card).getByLabelText("检查次数"));
    expect(accept).toBeEnabled();
  });

  it("keeps decline and cancel available for unsupported nested schemas", async () => {
    const user = userEvent.setup();
    const { respond } = renderElicitation({
      type: "object",
      properties: {
        nested: {
          type: "object",
          properties: { value: { type: "string" } },
        },
      },
    });
    const card = screen.getByRole("article", { name: /showcase MCP 请求/ });

    expect(within(card).getByRole("button", { name: "接受" })).toBeDisabled();
    expect(within(card).getByText("MCP 表单 schema 不受支持。")).toBeVisible();
    await user.click(within(card).getByRole("button", { name: "拒绝" }));
    expect(respond).toHaveBeenCalledWith(interactionId, {
      kind: "elicit",
      action: "decline",
    });
  });

  it("does not render behavioral schema keywords as an accepted form", () => {
    renderElicitation({
      type: "object",
      properties: {
        value: { type: "string", title: "值", pattern: "^safe$" },
      },
    });
    const card = screen.getByRole("article", { name: /showcase MCP 请求/ });

    expect(within(card).getByRole("button", { name: "接受" })).toBeDisabled();
    expect(within(card).getByText("MCP 表单 schema 不受支持。")).toBeVisible();
    expect(within(card).queryByLabelText("值")).not.toBeInTheDocument();
  });

  it("renders a fixed unsupported form without source schema values", () => {
    renderElicitation({
      type: "object",
      properties: {
        password: {
          type: "string",
          title: "SECRET_MARKER",
          default: { apiKey: "NESTED_SECRET" },
        },
      },
    });
    const card = screen.getByRole("article", { name: /showcase MCP 请求/ });

    expect(within(card).getByRole("alert")).toHaveTextContent(
      "MCP 表单 schema 不受支持。",
    );
    expect(within(card).getByRole("button", { name: "接受" })).toBeDisabled();
    expect(within(card).getByRole("button", { name: "拒绝" })).toBeEnabled();
    expect(within(card).getByRole("button", { name: "取消" })).toBeEnabled();
    expect(card).not.toHaveTextContent("SECRET_MARKER");
    expect(card).not.toHaveTextContent("NESTED_SECRET");
  });

  it("submits MCP Cancel without requiring supported schema content", async () => {
    const user = userEvent.setup();
    const { respond } = renderElicitation({
      type: "object",
      properties: {
        nested: { type: "array", items: { type: "string" } },
      },
    });
    const card = screen.getByRole("article", { name: /showcase MCP 请求/ });

    await user.click(within(card).getByRole("button", { name: "取消" }));
    expect(respond).toHaveBeenCalledWith(interactionId, {
      kind: "elicit",
      action: "cancel",
    });
  });
});
