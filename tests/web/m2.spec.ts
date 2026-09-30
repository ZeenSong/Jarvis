import { test, expect } from "@playwright/test";
import { fork, type ChildProcess } from "node:child_process";
let child: ChildProcess;
let base: string;
let logins: { username: string; password: string }[];
let runs: { input: string; cancel: string };
test.beforeAll(async () => {
  child = fork("tests/web-server.ts", [], {
    execArgv: ["--import", "tsx"],
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  const result: any = await new Promise((resolve, reject) => {
    child.once("message", resolve);
    child.once("exit", (code) => reject(Error("test_server_exit_" + code)));
    child.stderr?.on("data", (b) => process.stderr.write(b));
  });
  base = result.base;
  logins = result.logins;
  runs = result.runs;
});
test.afterAll(async () => {
  if (child?.connected) {
    child.send("stop");
    await new Promise((resolve) => child.once("exit", resolve));
  }
});
test("Web login, deterministic conversation, isolated history, refresh and reconnect", async ({
  page,
  browser,
}) => {
  // Reproduce HTTP Tailnet browsers, where randomUUID is unavailable.
  await page.context().addInitScript(() => {
    Object.defineProperty(crypto, "randomUUID", { value: undefined });
  });
  await page.goto(base);
  await page.getByLabel("用户名", { exact: true }).fill(logins[0].username);
  await page.getByLabel("密码", { exact: true }).fill(logins[0].password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByText("已连接", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Jarvis", exact: true }).click();
  await page.getByLabel("消息内容", { exact: true }).fill("CPU 现在多少？");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect(page.locator(".jarvis-turn")).toContainText(
    "当前 CPU 使用率",
  );
  await expect(page.locator(".conversation-list").getByRole("button", { name: "CPU 使用率查询", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("已连接", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Jarvis", exact: true }).click();
  await page
    .locator(".conversation-list")
    .getByRole("button", { name: "CPU 使用率查询", exact: true })
    .first()
    .click();
  await expect(page.locator(".jarvis-turn")).toContainText(
    "当前 CPU 使用率",
  );
  await page.context().setOffline(true);
  await page.waitForTimeout(500);
  await page.context().setOffline(false);
  await page.reload();
  await expect(page.getByText("已连接", { exact: true })).toBeVisible();
  const other = await browser.newContext();
  const second = await other.newPage();
  await second.goto(base);
  await second.getByLabel("用户名", { exact: true }).fill(logins[1].username);
  await second.getByLabel("密码", { exact: true }).fill(logins[1].password);
  await second.getByRole("button", { name: "登录", exact: true }).click();
  await expect(second.getByText("已连接", { exact: true })).toBeVisible();
  await second.getByRole("button", { name: "Jarvis", exact: true }).click();
  await expect(second.locator(".conversation-list").getByRole("button", { name: "CPU 使用率查询", exact: true })).toHaveCount(0);
  await expect(second.locator(".jarvis-turn")).toHaveCount(0);
  await second.screenshot({
    path: ".local/evidence/m2-web-conversation.png",
    fullPage: true,
  });
  await other.close();
  await expect(page.locator("nav").getByRole("button", { name: "系统", exact: true })).toHaveCount(0);
  await expect(page.locator("nav").getByRole("button", { name: "Hermes", exact: true })).toHaveCount(0);
  await page.screenshot({
    path: ".local/evidence/m2-web-home.png",
    fullPage: true,
  });
  await page.locator("nav").getByRole("button", { name: "任务", exact: true }).click();
  await page.getByLabel("搜索任务").fill("输入验收");
  await expect(page.getByTestId("run-" + runs.input)).toBeVisible();
  await expect(page.getByTestId("run-" + runs.cancel)).not.toBeVisible();
  await page.getByLabel("搜索任务").fill("");
  await page.screenshot({ path: ".local/evidence/m3-web-tasks.png", fullPage: true });
  await page.getByRole("button").filter({ hasText: "输入验收任务" }).click();
  const log = page.getByRole("region", { name: "任务事件日志", exact: true });
  await expect(log).toBeVisible();
  await expect(log.locator(".log-lines")).toContainText("agent.run.created");
  await expect(log.locator(".log-lines")).toContainText(/\d{4}-\d{2}-\d{2}T/);
  await expect(page.locator(".semantic-inspector")).not.toContainText("last_event_sequence");
  await log.getByRole("searchbox").fill("no-such-event");
  await expect(log).toContainText("没有匹配的日志");
  await log.getByRole("searchbox").fill("");
  await expect(
    page.getByRole("heading", { name: "任务状态" }).locator(".."),
  ).toContainText("等待输入");
  await page.getByLabel("补充任务输入").fill("跨端控制验证");
  await page.getByRole("button", { name: "发送输入", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "任务状态" }).locator(".."),
  ).toContainText("已完成");
  await expect(log.locator(".log-lines")).toContainText("agent.run.completed");
  await expect(page.getByRole("button", { name: "取消任务", exact: true })).toHaveCount(0);
  await expect(page.getByLabel("补充任务输入")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "代码变更", exact: true })).toHaveCount(0);
  const artifacts = page.getByRole("region", { name: "测试与产物", exact: true });
  await expect(artifacts.getByRole("listitem").filter({ hasText: "result.json" })).toBeVisible();
  await expect(artifacts).toContainText("application/json");
  await expect(artifacts.locator("table")).toHaveCount(0);
  const taskCard = page.locator('[data-component="task"]');
  await page.getByRole("button", { name: "执行过程", exact: true }).click();
  await expect(page.locator(".semantic-activity")).toBeHidden();
  await page.getByRole("button", { name: "资源与操作", exact: true }).click();
  await expect(page.locator(".semantic-inspector")).toBeHidden();
  await page.getByRole("button", { name: "重置布局", exact: true }).click();
  await expect(page.locator(".semantic-activity")).toBeVisible();
  await expect(artifacts).toBeVisible();
  await expect(taskCard).toContainText("输入验收任务");
  const slider = page.getByRole("slider", { name: "工作区侧栏宽度" });
  const previousWidth = (await page.locator(".semantic-inspector").boundingBox())!.width;
  await slider.focus();
  await slider.press("ArrowRight");
  await expect(slider).toHaveValue("26");
  expect((await page.locator(".semantic-inspector").boundingBox())!.width).toBeGreaterThan(previousWidth);
  await page.reload();
  await expect(slider).toHaveValue("26");
  await page.getByRole("button", { name: "重置布局", exact: true }).click();
  await expect(slider).toHaveValue("25");
  const divider = page.getByRole("separator", { name: "调整执行过程分栏" });
  await divider.focus();
  await divider.press("Home");
  await expect(slider).toHaveValue("18");
  const dividerBox = (await divider.boundingBox())!;
  await page.mouse.move(dividerBox.x + dividerBox.width / 2, dividerBox.y + 40);
  await page.mouse.down();
  await page.mouse.move(dividerBox.x + 65, dividerBox.y + 40, { steps: 5 });
  await page.mouse.up();
  expect(Number(await slider.inputValue())).toBeGreaterThan(18);
  await page.setViewportSize({ width: 900, height: 900 });
  await expect(divider).toBeHidden();
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByRole("button", { name: "重置布局", exact: true }).click();
  const cardWidth = (await taskCard.boundingBox())!.width;
  const summaryWidth = (await page.locator(".semantic-summary").boundingBox())!.width;
  expect(Math.abs(cardWidth - summaryWidth)).toBeLessThan(2);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: ".local/evidence/m3-web-task-workspace.png", fullPage: true });
  await expect(
    page.getByText("输入已收到：跨端控制验证", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText("输入已收到：跨端控制验证", { exact: true }),
  ).toBeVisible();
  await page.locator("nav").getByRole("button", { name: "任务", exact: true }).click();
  await page.getByRole("button").filter({ hasText: "取消验收任务" }).click();
  await expect(
    page.getByRole("heading", { name: "任务状态" }).locator(".."),
  ).toContainText("等待输入");
  await page.getByRole("button", { name: "取消任务", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "任务状态" }).locator(".."),
  ).toContainText("已取消");
  await expect(page.getByText("+取消前的工作", { exact: true })).toBeVisible();
  await page.screenshot({
    path: ".local/evidence/m2-web-run-control.png",
    fullPage: true,
  });
});
