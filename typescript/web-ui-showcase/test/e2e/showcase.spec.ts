import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";
import { appSnapshotSchema } from "../../src/shared/snapshots.js";

test.describe.configure({ mode: "serial" });

const selectedSession = (page: Page): Locator =>
  page.getByRole("button", { name: /^选择 Session：/ }).first();

async function snapshot(request: APIRequestContext) {
  const response = await request.get("/api/snapshot");
  expect(response.ok()).toBe(true);
  return appSnapshotSchema.parse(await response.json());
}

async function resetFixture(request: APIRequestContext): Promise<void> {
  const current = await snapshot(request);
  await Promise.all(
    current.sessions.map(async (session) => {
      const response = await request.delete(`/api/sessions/${session.id}`);
      expect(response.status()).toBe(202);
    }),
  );
  await expect.poll(async () => (await snapshot(request)).sessions).toEqual([]);
  await Promise.all(
    current.workspaces.map(async (workspace) => {
      const response = await request.delete(`/api/workspaces/${workspace.id}`);
      expect(response.status()).toBe(202);
    }),
  );
  await expect.poll(async () => (await snapshot(request)).workspaces).toEqual([]);
}

async function startSessionFromHero(
  page: Page,
  text: string,
): Promise<Locator> {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "探索未至之境" })).toBeVisible();
  const composer = page.getByRole("textbox", { name: "消息" });
  await composer.fill(text);
  await composer.press("Enter");
  await expect(composer).toBeEnabled();
  await expect(page.getByRole("article", { name: "用户消息" })).toContainText(text);
  return composer;
}

async function createFixtureSession(
  request: APIRequestContext,
  workspaceId: string,
  index: number,
): Promise<void> {
  const before = (await snapshot(request)).sessions.length;
  const response = await request.post("/api/sessions/start", {
    data: {
      workspaceId,
      text: `创建菜单填充 Session ${index}`,
    },
  });
  expect(response.status()).toBe(201);
  await expect
    .poll(async () => (await snapshot(request)).sessions.length)
    .toBe(before + 1);
}

test.beforeEach(async ({ request }) => {
  await resetFixture(request);
});

async function completeFixtureTurn(page: Page): Promise<void> {
  const finalReplies = page
    .getByLabel("assistant 消息")
    .filter({ hasText: "项目检查已完成。" });
  const previousFinalReplyCount = await finalReplies.count();
  await expect(page.getByLabel(/等待审批/)).toBeVisible();
  await page.getByRole("button", { name: "允许一次" }).click();
  await expect(page.getByLabel("Agent 提问")).toBeVisible();
  await page.getByLabel("Focused").check();
  await page.getByRole("button", { name: "提交回答" }).click();
  const elicitation = page.getByLabel(/MCP 请求/);
  await expect(elicitation).toBeVisible();
  await elicitation.getByLabel("确认只读访问").selectOption("true");
  await elicitation.getByRole("button", { name: "接受" }).click();
  await expect(finalReplies).toHaveCount(previousFinalReplyCount + 1);
  const timeline = await page
    .getByTestId("conversation-scroll")
    .locator(":scope > article")
    .evaluateAll((articles) =>
      articles.map((article) => {
        const label = article.getAttribute("aria-label");
        if (label === "用户消息") return "user";
        if (label === "assistant 消息") {
          return `assistant:${article.querySelector("p")?.textContent ?? ""}`;
        }
        const tool = article.querySelector<HTMLButtonElement>(".tool-row");
        return tool === null
          ? "other"
          : `tool:${tool.querySelector("strong")?.textContent ?? ""}`;
      }),
    );
  expect(timeline.slice(-5)).toEqual([
    "user",
    "assistant:正在检查项目…",
    "tool:Write",
    "tool:Agent",
    "assistant:项目检查已完成。",
  ]);
  await expect(page.getByText("<task-notification>", { exact: false }))
    .toHaveCount(0);
  await expect(page.getByLabel(/Task Index fixture project/)).toHaveCount(0);
}

test("starts from the hero and preserves the first draft through Workspace picking", async ({
  page,
}) => {
  const composer = await startSessionFromHero(page, "检查这个项目");

  await expect(selectedSession(page)).toContainText("新建 Session");
  await expect(
    page.getByRole("article", { name: "用户消息" }),
  ).toContainText("检查这个项目");
  await expect(composer).toHaveValue("");
  await expect(page.getByText(/恢复请求已接受|可恢复|已关闭/)).toHaveCount(0);
});

test("uses the DSH desktop geometry and only scrolls declared regions", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 820 });
  await startSessionFromHero(page, "检查桌面布局");

  const geometry = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const shell = document.querySelector<HTMLElement>(".app-shell");
    const sidebar = document.querySelector<HTMLElement>(".workspace-region");
    const composer = document.querySelector<HTMLElement>(".prompt-composer");
    const transcript = document.querySelector<HTMLElement>(".message-list");
    return {
      colorScheme: root.colorScheme,
      base: root.getPropertyValue("--bg-base").trim(),
      sidebarToken: root.getPropertyValue("--sidebar-default").trim(),
      detailsToken: root.getPropertyValue("--details-default").trim(),
      sidebarWidth: sidebar?.getBoundingClientRect().width ?? 0,
      shellHeight: shell?.getBoundingClientRect().height ?? 0,
      composerWidth: composer?.getBoundingClientRect().width ?? 0,
      transcriptWidth: transcript?.getBoundingClientRect().width ?? 0,
      documentOverflow: document.documentElement.scrollHeight > innerHeight,
      horizontalOverflow:
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    };
  });
  expect(geometry).toMatchObject({
    colorScheme: "light",
    base: "#ffffff",
    sidebarToken: "280px",
    detailsToken: "360px",
    sidebarWidth: 280,
    shellHeight: 820,
    documentOverflow: false,
    horizontalOverflow: false,
  });
  expect(geometry.composerWidth).toBeLessThanOrEqual(780);
  expect(geometry.transcriptWidth).toBeGreaterThanOrEqual(
    geometry.composerWidth,
  );

  const sidebarResize = page.getByRole("separator", {
    name: "调整 Session 侧栏宽度",
  });
  const resizeBox = await sidebarResize.boundingBox();
  expect(resizeBox).not.toBeNull();
  await page.mouse.move(resizeBox?.x ?? 0, resizeBox?.y ?? 0);
  await page.mouse.down();
  await page.mouse.move(1200, 400);
  await page.mouse.up();
  await expect
    .poll(() =>
      page.locator(".workspace-region").evaluate(
        (element) => element.getBoundingClientRect().width,
      ),
    )
    .toBe(420);

  await page.setViewportSize({ width: 800, height: 820 });
  await expect
    .poll(() =>
      page.locator(".workspace-region").evaluate(
        (element) => element.getBoundingClientRect().width,
      ),
    )
    .toBe(56);
  await page.getByRole("button", { name: "展开 Session 侧栏" }).click();
  const compactProject = page.getByRole("dialog", { name: "项目" });
  await expect(compactProject).toBeVisible();
  await expect(
    compactProject.getByRole("button", { name: "新建 Session", exact: true }),
  ).toBeVisible();
  await compactProject.getByRole("button", { name: "关闭 项目" }).click();
});

test("completes commands, semantic streaming, interactions, product details, and recovery", async ({
  page,
  request,
}) => {
  const composer = await startSessionFromHero(page, "初始化完整 journey");
  await completeFixtureTurn(page);
  for (const suggestion of [
    "查看 MCP 配置示例",
    "运行登录测试",
    "检查项目目录",
  ]) {
    await expect(page.getByRole("button", { name: suggestion })).toBeVisible();
  }
  await page.getByRole("button", { name: "查看 MCP 配置示例" }).click();
  await expect(composer).toHaveValue("查看 MCP 配置示例");
  await composer.fill("");
  await expect(
    page.getByRole("article", { name: "用户消息" }).filter({
      hasText: "Find fixture MCP configuration examples",
    }),
  ).toHaveCount(0);
  const agent = page.getByRole("button", { name: /Agent.*已完成/ }).first();
  await agent.click();
  const subagent = page.getByRole("complementary", { name: "Subagent 详情" });
  await expect(subagent.getByText("任务指令")).toBeVisible();
  await expect(subagent.getByText("Find fixture MCP configuration examples"))
    .toBeVisible();
  await expect(subagent.getByText("Fixture Subagent finished."))
    .toBeVisible();
  const childTool = subagent.getByRole("button", { name: /Glob.*已完成/ });
  await childTool.click();
  await expect(subagent.getByText(/\*\*\/\*\.json/)).toBeVisible();
  await subagent.getByRole("button", { name: "关闭 Subagent 详情" }).click();
  const [session] = (await snapshot(request)).sessions;
  expect(session).toBeDefined();
  const elicitationResponse = await request.get(
    `/__test/elicitation/${session?.id ?? "missing"}`,
  );
  expect(elicitationResponse.ok()).toBe(true);
  expect(await elicitationResponse.json()).toEqual({
    content: { confirmed: true },
  });

  await composer.fill("/");
  const commands = page.getByRole("listbox", { name: "命令建议" });
  await expect(commands).toContainText("/model");
  await expect(commands).toContainText("/fixture-inspect");
  await expect(commands).not.toContainText("/help");
  for (let index = 0; index < 12; index += 1) {
    await composer.press("ArrowDown");
  }
  const activeCommand = commands.getByRole("option", { selected: true });
  await expect(activeCommand).toBeVisible();
  expect(
    await activeCommand.evaluate((element) => {
      const option = element.getBoundingClientRect();
      const list = element.parentElement?.getBoundingClientRect();
      return list !== undefined && option.top >= list.top && option.bottom <= list.bottom;
    }),
  ).toBe(true);
  await composer.press("Escape");

  await composer.fill("/mo");
  await composer.press("Enter");
  const model = page.getByLabel("Model");
  await expect(model).toBeFocused();
  await model.selectOption({ label: "Fixture model" });
  await expect(page.getByRole("dialog", { name: "常规设置" })).toHaveCount(0);
  await expect(page.getByText("SDK_RESULT_ERROR", { exact: false })).toHaveCount(0);

  await composer.fill("/sample-ar");
  await composer.press("Enter");
  await expect(composer).toHaveValue("/sample-architecture");
  await composer.press("Enter");
  await completeFixtureTurn(page);
  await expect(
    page.getByRole("article", { name: "用户消息" }).filter({
      hasText: "/sample-architecture",
    }),
  ).toBeVisible();
  await composer.fill("@READ");
  const files = page.getByRole("listbox", { name: "文件建议" });
  await expect(files).toContainText("@README.md");
  await composer.press("Enter");
  await expect(composer).toHaveValue("@README.md ");
  await composer.fill("");

  await expect(page.getByLabel("assistant 消息")).toHaveCount(4);
  await expect(page.getByText("Fixture analysis complete.")).toHaveCount(0);

  const tool = page.getByRole("button", { name: /Write.*已完成/ }).last();
  await expect(tool).toHaveAttribute("aria-expanded", "false");
  await tool.click();
  await expect(tool).toHaveAttribute("aria-expanded", "true");
  const toolDetails = page.getByRole("region", { name: "Write Tool 详情" }).last();
  await expect(toolDetails).toContainText("Synthetic change");
  await expect(toolDetails).toContainText("Fixture write approved");
  await tool.click();
  await expect(toolDetails).toHaveCount(0);

  await page.getByRole("button", { name: "SDK 控制台" }).click();
  const sdkConsole = page.getByRole("dialog", { name: "SDK 控制台" });
  await expect(sdkConsole.getByRole("heading", { name: "Hooks" })).toBeVisible();
  await expect(sdkConsole.getByRole("heading", { name: "Raw Events" })).toBeVisible();
  await expect(sdkConsole.getByText(/FixtureSessionStart/).first()).toBeVisible();
  await expect(
    sdkConsole.getByText("result.success", { exact: true }).last(),
  ).toBeVisible();
  await sdkConsole.getByRole("button", { name: "关闭 SDK 控制台" }).click();

  await page.getByRole("button", { name: "设置" }).click();
  await page.getByRole("dialog", { name: "常规设置" }).getByRole("button", { name: "Account" }).click();
  const account = page.getByRole("dialog", { name: "Account" });
  await expect(account).toContainText("Fixture developer");
  await expect(account).toContainText("42");
  await account.getByRole("button", { name: "关闭 Account" }).click();

  const userTurn = page.getByRole("article", { name: "用户消息" }).last();
  await expect(userTurn.getByLabel("Checkpoint 范围")).toHaveCount(0);
  await expect(userTurn.getByRole("button", { name: "回到这里" })).toHaveCount(0);

  await page.setViewportSize({ width: 1280, height: 500 });
  const transcript = page.getByTestId("conversation-scroll");
  await expect
    .poll(() =>
      transcript.evaluate((element) => element.scrollHeight > element.clientHeight),
    )
    .toBe(true);
  const composerBottom = await page.locator(".composer-wrap").evaluate(
    (element) => element.getBoundingClientRect().bottom,
  );
  await transcript.evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event("scroll"));
  });
  await transcript.hover();
  await page.mouse.wheel(0, 400);
  await expect
    .poll(() => transcript.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
  expect(
    await page.locator(".composer-wrap").evaluate(
      (element) => element.getBoundingClientRect().bottom,
    ),
  ).toBe(composerBottom);
  expect(await page.evaluate(() => document.scrollingElement?.scrollTop ?? -1)).toBe(0);

  await page.reload();
  await selectedSession(page).click();
  await expect(page.getByRole("textbox", { name: "消息" })).toBeEnabled();
  await expect(page.getByRole("article", { name: "用户消息" }).first()).toBeVisible();
  await expect(page.getByText(/Session 恢复请求已接受/)).toHaveCount(0);
});

test("keeps the bottom Session menu visible and applies rename and delete", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 1280, height: 520 });
  await startSessionFromHero(page, "创建菜单目标 Session");
  const isolated = await snapshot(request);
  const target = isolated.sessions[0];
  const workspace = isolated.workspaces[0];
  if (target === undefined || workspace === undefined) {
    throw new Error("The isolated menu journey must own one Session and Workspace.");
  }
  const uniqueTitle = "菜单目标 Session";
  const renameTarget = await request.patch(`/api/sessions/${target.id}/title`, {
    data: { title: uniqueTitle },
  });
  expect(renameTarget.status()).toBe(202);
  await expect
    .poll(async () => (await snapshot(request)).sessions[0]?.title)
    .toBe(uniqueTitle);
  for (let index = 0; index < 12; index += 1) {
    await createFixtureSession(request, workspace.id, index + 1);
  }
  await expect(page.locator(".session-row")).toHaveCount(13);

  const row = page.locator(".session-row").last();
  await expect(row).toContainText(uniqueTitle);
  await row.scrollIntoViewIfNeeded();
  await row.hover();
  const trigger = row.getByRole("button", {
    name: `打开 ${uniqueTitle} 的 Session 操作`,
  });
  await trigger.click();
  const menu = page.getByRole("menu", { name: uniqueTitle });
  await expect(menu).toBeVisible();
  await expect(menu).toBeInViewport();
  const triggerBox = await trigger.boundingBox();
  const menuBox = await menu.boundingBox();
  expect(triggerBox).not.toBeNull();
  expect(menuBox).not.toBeNull();
  expect(menuBox?.y ?? 520).toBeLessThan(triggerBox?.y ?? 0);
  expect((menuBox?.y ?? 0) + (menuBox?.height ?? 0)).toBeLessThanOrEqual(520);
  expect(
    await menu.evaluate((element) => element.parentElement === document.body),
  ).toBe(true);

  await menu.getByRole("menuitem", { name: "重命名" }).click();
  const rename = page.getByRole("dialog", { name: "重命名 Session" });
  await rename.getByLabel("Session 名称").fill("已重命名 Session");
  await rename.getByRole("button", { name: "重命名" }).click();
  await expect(page.getByRole("button", { name: /^选择 Session：已重命名 Session/ })).toBeVisible();

  await page.getByRole("button", { name: /打开 已重命名 Session 的 Session 操作/ }).click();
  await page.getByRole("menuitem", { name: "删除记录" }).click();
  const remove = page.getByRole("dialog", { name: "删除 Session 记录" });
  await expect(remove).toContainText("项目文件会保留");
  await remove.getByRole("button", { name: "删除记录" }).click();
  await expect(page.getByRole("button", { name: /^选择 Session：已重命名 Session/ })).toHaveCount(0);
});

test("uses accessible sidebar and SDK Console overlays at 390 by 844", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "探索未至之境" })).toBeVisible();
  await page.getByRole("button", { name: "项目", exact: true }).click();
  const projectDrawer = page.getByRole("dialog", { name: "项目" });
  await expect(projectDrawer).toBeVisible();
  await expect(projectDrawer.getByRole("button", { name: "关闭 项目" })).toBeFocused();
  await projectDrawer.getByRole("button", { name: "关闭 项目" }).click();
  await expect(projectDrawer).toHaveCount(0);

  const composer = await startSessionFromHero(page, "移动端检查");
  await completeFixtureTurn(page);
  await page.getByRole("button", { name: "项目", exact: true }).click();
  const sessionRow = page.locator(".project-drawer-content .session-row").first();
  const sessionMenuTrigger = sessionRow.locator(".session-row-action-trigger");
  await sessionMenuTrigger.click();
  const sessionMenu = page.getByRole("menu");
  await expect(sessionMenu).toBeVisible();
  expect(await sessionMenu.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const topmost = document.elementFromPoint(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
    );
    return topmost !== null && element.contains(topmost);
  })).toBe(true);
  await sessionMenu.getByRole("menuitem", { name: "重命名" }).click({ force: true });
  const sessionDialog = page.getByRole("dialog", { name: "重命名 Session" });
  await expect(sessionDialog).toBeVisible();
  expect(await sessionDialog.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const topmost = document.elementFromPoint(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
    );
    return topmost !== null && element.contains(topmost);
  })).toBe(true);
  await sessionDialog.getByRole("button", { name: "取消" }).click({ force: true });
  await projectDrawer.getByRole("button", { name: "关闭 项目" }).click();
  const mobileTool = page.getByRole("button", { name: /Write.*已完成/ });
  await mobileTool.click();
  const mobileDetails = page.getByRole("region", { name: "Write Tool 详情" });
  await expect(mobileDetails).toBeVisible();
  await mobileTool.click();
  await expect(mobileDetails).toHaveCount(0);

  const result = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    scrollHeight: document.documentElement.scrollHeight,
    viewportHeight: innerHeight,
  }));
  expect(result).toEqual({
    width: 390,
    scrollWidth: 390,
    scrollHeight: 844,
    viewportHeight: 844,
  });

  await page.getByRole("button", { name: "SDK 控制台" }).click();
  const sdkConsole = page.getByRole("dialog", { name: "SDK 控制台" });
  await expect(sdkConsole.getByRole("button", { name: "关闭 SDK 控制台" })).toBeFocused();
  await sdkConsole.getByRole("button", { name: "关闭 SDK 控制台" }).click();
  await expect(sdkConsole).toHaveCount(0);
});
