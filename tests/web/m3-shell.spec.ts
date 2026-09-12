import { test, expect } from "@playwright/test";
import { fork, type ChildProcess } from "node:child_process";
let child: ChildProcess;
let base: string;
let codes: string[];
test.beforeAll(async () => {
  child = fork("tests/web-server.ts", [], { execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "pipe", "ipc"] });
  const data: any = await new Promise((resolve, reject) => {
    child.once("message", resolve); child.once("exit", (c) => reject(Error(`Server exited ${c}`)));
    child.stderr?.on("data", (d) => process.stderr.write(d));
  });
  base = data.base; codes = data.codes;
});
test.afterAll(async () => { if(child?.connected) { child.send("stop"); await new Promise((r) => child.once("exit", r)); } });
test("personal cloud home, navigation, command handoff and semantic workspace", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(base);
  await page.getByLabel("配对码").fill(codes.shift()!);
  await page.getByRole("button", { name: "配对并连接" }).click();
  await expect(page.getByRole("heading", { name: "让科技，回归生活。" })).toBeVisible();
  for (const name of ["首页", "空间", "应用", "任务", "Jarvis", "系统"]) await expect(page.locator("nav").getByRole("button", { name, exact: true })).toBeVisible();
  await expect(page.locator(".metric-tile").first().locator("strong")).toContainText("%");
  for (const name of ["alpine-dusk", "files", "knowledge", "family", "media", "development"]) {
    const response = await page.request.get(`${base}/artwork/${name}-v1.png`);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("image/png");
  }
  await page.evaluate(async () => {
    await Promise.all([...document.querySelectorAll(".home-hero,.space-card")].map(async (element) => {
      const url = getComputedStyle(element).backgroundImage.match(/url\("?([^"\)]+)"?\)/)?.[1];
      if (!url) throw Error("Missing decorative cover");
      const img = new Image(); img.src = url; await img.decode();
    }));
  });
  if (process.env.M3_LIVE_CASAOS === "1") {
    for (const name of ["Home Assistant", "Immich"]) {
      const card = page.locator(".application-card").filter({ has: page.getByRole("heading", { name, exact: true }) });
      await expect(card).toBeVisible();
      await expect(card.locator(".application-status")).toHaveText("运行中");
      await expect(card.locator("img.application-icon")).toBeVisible();
      await expect.poll(() => card.locator("img.application-icon").evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    }
    await page.locator("nav").getByRole("button", { name: "应用", exact: true }).click();
    await expect(page.locator(".application-card")).toHaveCount(2);
    await page.getByRole("button", { name: "查看 Immich 详情", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("dialog")).toContainText("运行中");
    await expect(page.getByRole("dialog")).toContainText("服务数量");
    await page.screenshot({ path: ".local/evidence/m3-web-live-app-detail.png", fullPage: true });
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await expect(page.getByRole("button", { name: "查看 Immich 详情", exact: true })).toBeFocused();
    await page.reload();
    await expect(page.locator(".application-card")).toHaveCount(2);
    await page.screenshot({ path: ".local/evidence/m3-web-live-applications.png", fullPage: true });
    await page.locator("nav").getByRole("button", { name: "首页", exact: true }).click();
    await expect(page.locator(".application-card")).toHaveCount(2);
  }
  await expect(page.locator(".metric-tile").first().locator("strong")).toContainText("%");
  await expect(page.locator('nav button[aria-current="page"]')).toHaveText("首页");
  await page.screenshot({ path: ".local/evidence/m3-web-home.png", fullPage: true });
  await page.getByRole("button", { name: "切换浅色主题" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator(".metric-tile").first().locator("strong")).toContainText("%");
  await page.screenshot({ path: ".local/evidence/m3-web-home-light.png", fullPage: true });
  await page.getByRole("button", { name: "切换深色主题" }).click();
  await page.locator(".space-photos").click();
  await expect(page.getByRole("dialog")).toContainText("不是你的照片");
  await page.keyboard.press("Escape");
  await expect(page.locator(".space-photos")).toBeFocused();
  await page.locator(".space-family").click();
  await expect(page.getByRole("dialog")).toContainText("Home Assistant");
  await page.getByRole("button", { name: "查看已安装应用" }).click();
  await expect(page.locator('nav button[aria-current="page"]')).toHaveText("应用");
  await page.locator("nav").getByRole("button", { name: "首页", exact: true }).click();
  await page.getByLabel("问 Jarvis", { exact: true }).fill("CPU 现在多少？");
  await page.getByRole("button", { name: "发送给 Jarvis", exact: true }).click();
  await expect(page.getByLabel("消息", { exact: true })).toHaveValue("CPU 现在多少？");
  await page.getByRole("button", { name: "发送 ↑" }).click();
  await expect(page.locator(".message.jarvis")).toContainText("当前 CPU 使用率");
  await page.locator("nav").getByRole("button", { name: "系统", exact: true }).click();
  await expect(page.locator(".semantic-workspace")).toBeVisible();
  await expect(page.locator('[data-component="gauge"]').first()).toBeVisible();
  await expect(page).toHaveURL(/\/system$/);
  await page.reload();
  await expect(page.locator(".semantic-workspace")).toBeVisible();
  await page.screenshot({ path: ".local/evidence/m3-web-workspace.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("nav").getByRole("button", { name: "首页", exact: true }).click();
  await expect(page.getByLabel("问 Jarvis", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
});
