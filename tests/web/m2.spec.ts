import { test, expect } from "@playwright/test";
import { fork, type ChildProcess } from "node:child_process";
let child: ChildProcess;
let base: string;
let codes: string[];
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
  codes = result.codes;
  runs = result.runs;
});
test.afterAll(async () => {
  if (child?.connected) {
    child.send("stop");
    await new Promise((resolve) => child.once("exit", resolve));
  }
});
test("Web pairing, deterministic conversation, shared history, refresh and reconnect", async ({
  page,
  browser,
}) => {
  // Reproduce HTTP Tailnet browsers, where randomUUID is unavailable.
  await page.context().addInitScript(() => {
    Object.defineProperty(crypto, "randomUUID", { value: undefined });
  });
  await page.goto(base);
  await page.getByLabel("配对码").fill(codes.shift()!);
  await page.getByRole("button", { name: "配对并连接" }).click();
  await expect(page.getByText("已连接", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Jarvis", exact: true }).click();
  await page.getByLabel("消息", { exact: true }).fill("CPU 现在多少？");
  await page.getByRole("button", { name: "发送 ↑" }).click();
  await expect(page.locator(".message.jarvis")).toContainText(
    "当前 CPU 使用率",
  );
  await page.reload();
  await expect(page.getByText("已连接", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Jarvis", exact: true }).click();
  await page
    .locator(".conversation-list")
    .getByRole("button", { name: "CPU 现在多少？" })
    .first()
    .click();
  await expect(page.locator(".message.jarvis")).toContainText(
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
  await second.getByLabel("配对码").fill(codes.shift()!);
  await second.getByRole("button", { name: "配对并连接" }).click();
  await expect(second.getByText("已连接", { exact: true })).toBeVisible();
  await second.getByRole("button", { name: "Jarvis", exact: true }).click();
  await second
    .locator(".conversation-list")
    .getByRole("button", { name: "CPU 现在多少？" })
    .first()
    .click();
  await expect(second.locator(".message.jarvis")).toContainText(
    "当前 CPU 使用率",
  );
  await second.screenshot({
    path: ".local/evidence/m2-web-conversation.png",
    fullPage: true,
  });
  await other.close();
  await page.getByRole("button", { name: "服务器", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "CPU / GPU 历史" }),
  ).toBeVisible();
  await page.screenshot({
    path: ".local/evidence/m2-web-home.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "智能体", exact: true }).click();
  await page.getByTestId("run-" + runs.input).click();
  await expect(
    page.getByRole("heading", { name: "任务状态" }).locator(".."),
  ).toContainText("等待输入");
  await page.getByLabel("补充任务输入").fill("跨端控制验证");
  await page.getByRole("button", { name: "发送输入", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "任务状态" }).locator(".."),
  ).toContainText("已完成");
  await expect(
    page.getByText("输入已收到：跨端控制验证", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText("输入已收到：跨端控制验证", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "智能体", exact: true }).click();
  await page.getByTestId("run-" + runs.cancel).click();
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
