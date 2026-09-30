import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { preset } from "../../packages/ui-presets/src/index.js";
import { semanticView } from "../../packages/ui-presets/src/v2.js";

const base = process.env.M33_WEB_URL ?? "http://127.0.0.1:5173";
const conversationId = "10000000-0000-4000-8000-000000000001";
const turnId = "10000000-0000-4000-8000-000000000002";

test("turn execution streams without polling, survives reload and fits mobile", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const calls: string[] = [];
  let messageRequest: any, messageAdmissions = 0;
  const snapshot: any = {
    conversation: { id: conversationId, title: "今日 Token 使用分析" },
    messages: [
      { id: "user-1", turn_id: turnId, role: "user", content: "帮我看看今天最消耗 Token 的会话是哪一个？" },
      { id: "reply-1", turn_id: turnId, role: "jarvis", content: "今天消耗最高的是 **产品设计方案讨论**。\n\n详细数据已整理，可以继续查看使用趋势。", status: "completed" },
    ],
    activities: [{ id: "tool-1", turn_id: turnId, capability: "llm_usage_read", status: "completed" }],
    events: [
      { id: "reasoning-1", turn_id: turnId, sequence: 1, revision: 2, kind: "reasoning", title: "思考过程", content: "测试夹具返回的推理片段：按会话聚合今天的用量。", status: "completed", started_at: "2026-09-29T08:51:00+08:00", completed_at: "2026-09-29T08:51:01+08:00" },
      { id: "tool-1", turn_id: turnId, activity_id: "tool-1", sequence: 2, revision: 2, kind: "tool", title: "读取模型用量", content: "", status: "completed", started_at: "2026-09-29T08:51:01+08:00", completed_at: "2026-09-29T08:51:03+08:00" },
      { id: "processing-1", turn_id: turnId, sequence: 3, revision: 2, kind: "processing", title: "计算会话排名", content: "", status: "completed", started_at: "2026-09-29T08:51:03+08:00", completed_at: "2026-09-29T08:51:04+08:00" },
      { id: "render-1", turn_id: turnId, sequence: 4, revision: 2, kind: "render", title: "生成分析结果界面", content: "", status: "completed", started_at: "2026-09-29T08:51:04+08:00", completed_at: "2026-09-29T08:51:05+08:00" },
    ], questions: [], approvals: [],
  };
  await page.route("**/api/**", (route) => route.fulfill({ json: { user: { username: "测试用户" }, open: false } }));
  await page.addInitScript(({ conversationId }) => sessionStorage.setItem("jarvis-navigation", JSON.stringify({ page: "jarvis", selected: conversationId })), { conversationId });
  await page.routeWebSocket("**/ws", (ws) => {
    const emit = (topic: string, payload: any) => ws.send(JSON.stringify({ topic, payload }));
    ws.onMessage((data) => {
      const request = JSON.parse(String(data)); calls.push(request.topic);
      let payload: any = [];
      if (request.topic === "conversation.list") payload = [snapshot.conversation];
      if (request.topic === "conversation.get") payload = snapshot;
      if (request.topic === "agent.definition.list") payload = { agents: [], runs: [] };
      if (request.topic === "conversation.composer.options") payload = { reasoning_efforts: ["low", "medium", "high"], skills: [
        { name: "家庭助手", description: "查看家庭状态" }, { name: "照片管理", description: "筛选和整理家庭照片" },
      ] };
      if (request.topic === "conversation.message") { payload = { reply_id: "reply-2", turn_id: "turn-2" }; messageRequest = request.payload; messageAdmissions++; }
      ws.send(JSON.stringify({ reply_to: request.id, topic: request.topic, type: "response", payload }));
      if (request.topic === "conversation.message") {
        const stages = [
          { id: "reasoning-2", sequence: 5, kind: "reasoning", title: "继续分析趋势", content: "先读取今天的 Token 用量。", status: "running" },
          { id: "tool-2", sequence: 6, kind: "tool", title: "读取小时趋势", content: "", status: "running" },
          { id: "processing-2", sequence: 7, kind: "processing", title: "对齐小时数据", content: "", status: "queued" },
          { id: "render-2", sequence: 8, kind: "render", title: "更新分析界面", content: "", status: "queued" },
        ].map((stage) => ({ ...stage, conversation_id: conversationId, turn_id: "turn-2", revision: 1, started_at: "2026-09-29T08:52:00+08:00" }));
        for (const stage of stages) emit("conversation.execution.updated", stage);
        setTimeout(() => emit("conversation.execution.updated", { ...stages[0], revision: 2, content: "正在核对小时趋势。" }), 500);
        setTimeout(() => {
          const completed = stages.map((stage, index) => ({ ...stage, ...(stage.id === "reasoning-2" ? { revision: 3, content: "测试提供方正在核对小时趋势。" } : { revision: 2 }), status: "completed", completed_at: new Date(Date.parse("2026-09-29T08:52:00+08:00") + (index + 1) * 500).toISOString() }));
          for (const event of completed) emit("conversation.execution.updated", event);
          emit("conversation.message.delta", { conversation_id: conversationId, message_id: "reply-2", content: "已核对小时趋势。", revision: 1 });
          emit("conversation.status", { conversation_id: conversationId, message_id: "reply-2", status: "completed" });
          snapshot.messages.push({ id: "user-2", turn_id: "turn-2", role: "user", content: "再看看小时趋势" }, { id: "reply-2", turn_id: "turn-2", role: "jarvis", content: "已核对小时趋势。", status: "completed" });
          snapshot.events.push(...completed);
        }, 1000);
      }
    });
  });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(`${base}/jarvis`);
  await expect(page.getByRole("heading", { name: "今日 Token 使用分析" })).toBeVisible();
  await expect(page.getByLabel("推理强度")).toBeVisible();
  await expect(page.getByText("Skills · Auto")).toBeVisible();
  await expect(page.getByLabel("执行过程")).toHaveCount(1);
  await expect(page.locator(".execution-stream li")).toHaveCount(4);
  await page.locator(".execution-stream summary").first().click();
  await expect(page.getByText("测试夹具返回的推理片段：按会话聚合今天的用量。")).toBeVisible();
  await page.screenshot({ path: ".local/evidence/m33-conversation-desktop.png", fullPage: true });
  const reads = calls.filter((topic) => topic === "conversation.get").length;
  await page.getByLabel("推理强度").selectOption("high");
  await page.getByText("Skills · Auto").click();
  await page.locator(".skill-option").filter({ hasText: "照片管理" }).locator("input").check();
  await page.getByLabel("消息内容").fill("再看看小时趋势");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  const secondTurn = page.locator(".jarvis-turn").last();
  await expect(secondTurn.locator(".execution-stream li")).toHaveCount(4);
  await expect(secondTurn.locator('.execution-stream li[data-status="running"]')).toHaveCount(2);
  await expect(page.getByText("先读取今天的 Token 用量。")).toBeVisible();
  await expect(page.getByText("正在核对小时趋势。", { exact: true })).toBeVisible();
  const streamedReasoning = secondTurn.locator(".execution-stream li").first();
  await expect(streamedReasoning).toHaveAttribute("data-status", "completed");
  await streamedReasoning.locator("summary").click();
  await expect(page.getByText("测试提供方正在核对小时趋势。")).toBeVisible();
  await expect(page.getByText("已核对小时趋势。")).toBeVisible();
  expect(messageRequest.reasoning_effort).toBe("high");
  expect(messageRequest.skills).toEqual(["照片管理"]);
  await expect(page.getByText("Skills · Auto")).toBeVisible();
  expect(calls.filter((topic) => topic === "conversation.get")).toHaveLength(reads);
  await page.reload();
  await expect(page.getByText("已核对小时趋势。")).toBeVisible();
  const restoredTurn = page.locator(".jarvis-turn").nth(1);
  await expect(restoredTurn.locator(".execution-stream li")).toHaveCount(4);
  await expect(restoredTurn.locator(".execution-stream li .execution-body summary span")).toHaveText(["继续分析趋势", "读取小时趋势", "对齐小时数据", "更新分析界面"]);
  expect(messageAdmissions).toBe(1);
  expect(calls.filter((topic) => topic === "conversation.get")).toHaveLength(reads + 1);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel("消息内容")).toBeVisible();
  await expect(page.getByRole("button", { name: "发送消息", exact: true })).toBeInViewport();
  const mobileNavigation = page.locator(".page-jarvis nav button");
  await expect(mobileNavigation).toHaveCount(6);
  for (const item of await mobileNavigation.all()) await expect(item).toBeInViewport();
  const utilityHeader = await page.locator(".page-jarvis main>header").boundingBox();
  const conversationHeader = await page.locator(".conversation-header").boundingBox();
  expect(utilityHeader).not.toBeNull(); expect(conversationHeader).not.toBeNull();
  expect(utilityHeader!.y + utilityHeader!.height).toBeLessThanOrEqual(conversationHeader!.y);
  expect((await page.locator(".chat").boundingBox())!.width).toBeGreaterThan(340);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.screenshot({ path: ".local/evidence/m33-conversation-mobile.png", fullPage: true });
  expect(errors).toEqual([]);
});

test("a transient recovery read failure reconnects the live turn without resubmitting it", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  const calls: string[] = [];
  let sockets = 0, messageAdmissions = 0, recoveryReads = 0, recoveryFailures = 0, terminalSent = false;
  const event = { id: "recovery-stage", conversation_id: conversationId, turn_id: "turn-recovery", sequence: 1, revision: 1, kind: "processing", title: "读取用量数据", content: "", status: "running", started_at: "2026-09-29T09:00:00+08:00" };
  const snapshot = (content: string, status: string, revision: number) => ({
    conversation: { id: conversationId, title: "恢复连接测试" },
    messages: [
      { id: "user-recovery", turn_id: "turn-recovery", role: "user", content: "继续读取用量" },
      { id: "reply-recovery", turn_id: "turn-recovery", role: "jarvis", content, status, revision },
    ],
    events: [{ ...event, revision: status === "completed" ? 2 : 1, status: status === "completed" ? "completed" : "running", ...(status === "completed" ? { completed_at: "2026-09-29T09:00:02+08:00" } : {}) }],
    activities: [], results: [], questions: [], approvals: [],
  });
  await page.route("**/api/**", (route) => route.fulfill({ json: { user: { username: "测试用户" }, open: false } }));
  await page.addInitScript(() => sessionStorage.setItem("jarvis-navigation", JSON.stringify({ page: "jarvis" })));
  await page.routeWebSocket("**/ws", (ws) => {
    sockets++;
    const emit = (topic: string, payload: any) => ws.send(JSON.stringify({ topic, payload }));
    ws.onMessage((data) => {
      const request = JSON.parse(String(data)); calls.push(request.topic);
      if (request.topic === "conversation.get" && messageAdmissions > 0) {
        recoveryReads++;
        if (recoveryReads === 1) {
          recoveryFailures++;
          ws.send(JSON.stringify({ reply_to: request.id, topic: request.topic, type: "error", payload: { error: "request_failed" } }));
          return;
        }
        const value = recoveryReads > 1 && terminalSent ? snapshot("重连后完整恢复。", "completed", 2) : snapshot("断线前：已读取用量", "streaming", 1);
        ws.send(JSON.stringify({ reply_to: request.id, topic: request.topic, type: "response", payload: value }));
        if (recoveryReads === 2 && !terminalSent) {
          terminalSent = true;
          setTimeout(() => {
            emit("conversation.execution.updated", { ...event, revision: 2, status: "completed", completed_at: "2026-09-29T09:00:02+08:00" });
            emit("conversation.message.delta", { conversation_id: conversationId, message_id: "reply-recovery", content: "重连后完整恢复。", revision: 2 });
            emit("conversation.status", { conversation_id: conversationId, message_id: "reply-recovery", status: "completed" });
          }, 60);
        }
        return;
      }

      let payload: any = [];
      if (request.topic === "conversation.create") payload = { id: conversationId };
      if (request.topic === "conversation.list") payload = [];
      if (request.topic === "conversation.get") payload = snapshot("", "streaming", 0);
      if (request.topic === "agent.definition.list") payload = { agents: [], runs: [] };
      if (request.topic === "conversation.composer.options") payload = { reasoning_efforts: [], skills: [] };
      if (request.topic === "conversation.message") { messageAdmissions++; payload = { reply_id: "reply-recovery", turn_id: "turn-recovery" }; }
      ws.send(JSON.stringify({ reply_to: request.id, topic: request.topic, type: "response", payload }));
      if (request.topic === "conversation.message") {
        emit("conversation.execution.updated", event);
        emit("conversation.message.delta", { conversation_id: conversationId, message_id: "reply-recovery", content: "断线前：已读取用量", revision: 1 });
        setTimeout(() => { void ws.close({ code: 1001, reason: "模拟短暂断线" }); }, 100);
      }
    });
  });
  await page.goto(`${base}/jarvis`);
  await page.getByLabel("消息内容").fill("继续读取用量");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect(page.getByText("断线前：已读取用量", { exact: true })).toBeVisible();
  await expect.poll(() => sockets).toBe(2);
  await expect(page.getByText("重连后完整恢复。", { exact: true })).toBeVisible();
  await expect(page.getByText("读取用量数据", { exact: true }).locator("..") ).toContainText("已完成");
  expect(recoveryFailures).toBe(1);
  expect(recoveryReads).toBeGreaterThanOrEqual(2);
  expect(messageAdmissions).toBe(1);
  expect(calls.filter((topic) => topic === "conversation.message")).toHaveLength(1);
  await expect(page.locator(".message.user")).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("a structured answer streams its server-queued follow-up and restores without resubmitting", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  const calls: string[] = [];
  let answerAdmissions = 0;
  const snapshot: any = {
    conversation: { id: conversationId, title: "规划家庭周末" },
    messages: [
      { id: "question-user", turn_id: turnId, sequence: 1, role: "user", content: "帮我安排一个周末活动", status: "completed", revision: 0 },
      { id: "question-reply", turn_id: turnId, sequence: 2, role: "jarvis", content: "你更想去户外吗？", status: "completed", revision: 0 },
    ],
    questions: [{ id: "question-1", conversation_id: conversationId, turn_id: turnId, kind: "boolean", prompt: "你更想去户外吗？", status: "pending", options: [] }],
    activities: [], events: [], approvals: [], results: [],
  };
  await page.route("**/api/**", (route) => route.fulfill({ json: { user: { username: "测试用户" }, open: false } }));
  await page.addInitScript(({ conversationId }) => sessionStorage.setItem("jarvis-navigation", JSON.stringify({ page: "jarvis", selected: conversationId })), { conversationId });
  await page.routeWebSocket("**/ws", (ws) => {
    const emit = (topic: string, payload: any) => ws.send(JSON.stringify({ topic, payload }));
    ws.onMessage((data) => {
      const request = JSON.parse(String(data)); calls.push(request.topic);
      let payload: any = [];
      if (request.topic === "conversation.list") payload = [snapshot.conversation];
      if (request.topic === "conversation.get") payload = snapshot;
      if (request.topic === "agent.definition.list") payload = { agents: [], runs: [] };
      if (request.topic === "conversation.composer.options") payload = { reasoning_efforts: [], skills: [] };
      if (request.topic === "conversation.question.answer") { payload = { id: "question-1", status: "answered", answer: true }; answerAdmissions++; }
      ws.send(JSON.stringify({ reply_to: request.id, topic: request.topic, type: "response", payload }));
      if (request.topic !== "conversation.question.answer") return;
      snapshot.questions[0] = { ...snapshot.questions[0], status: "answered", answer: true };
      const continuation = [
        { id: "question-answer-user", turn_id: turnId, sequence: 3, role: "user", content: "用户已回答问题：你更想去户外吗？\n回答：是\n请根据此回答继续原任务。", status: "completed", revision: 0 },
        { id: "question-follow-up", turn_id: turnId, sequence: 4, role: "jarvis", content: "", status: "queued", revision: 0 },
      ];
      snapshot.messages.push(...continuation);
      emit("conversation.question.answered", snapshot.questions[0]);
      emit("conversation.updated", { conversation_id: conversationId, messages: snapshot.messages });
      emit("conversation.status", { conversation_id: conversationId, message_id: "question-follow-up", status: "streaming" });
      setTimeout(() => {
        emit("conversation.message.delta", { conversation_id: conversationId, message_id: "question-follow-up", content: "我会优先安排户外活动", delta: "我会优先安排户外活动", revision: 1 });
        setTimeout(() => {
          const final = "我会优先安排户外活动，并为你整理两种适合家庭的周末方案。";
          emit("conversation.message.delta", { conversation_id: conversationId, message_id: "question-follow-up", content: final, delta: "，并为你整理两种适合家庭的周末方案。", revision: 2 });
          emit("conversation.status", { conversation_id: conversationId, message_id: "question-follow-up", status: "completed" });
          snapshot.messages = snapshot.messages.map((message: any) => message.id === "question-follow-up" ? { ...message, content: final, status: "completed", revision: 2 } : message);
        }, 900);
      }, 500);
    });
  });
  await page.goto(`${base}/jarvis`);
  await expect(page.getByText("你更想去户外吗？").first()).toBeVisible();
  const reads = calls.filter((topic) => topic === "conversation.get").length;
  await page.getByRole("button", { name: "是", exact: true }).click();
  await expect(page.getByRole("button", { name: "是", exact: true })).toHaveCount(0);
  const visibleAnswer = page.locator(".message.user").last();
  await expect(visibleAnswer).toContainText("对「你更想去户外吗？」的回答");
  await expect(visibleAnswer).toContainText("是");
  await expect(visibleAnswer).not.toContainText("请根据此回答继续原任务");
  await expect(page.locator(".jarvis-turn").last().getByRole("status")).toContainText("正在处理");
  await expect(page.getByRole("button", { name: "停止任务" })).toBeVisible();
  await expect(page.getByText("我会优先安排户外活动", { exact: true })).toBeVisible();
  await page.screenshot({ path: ".local/evidence/m33-question-continuation.png", fullPage: true });
  expect(calls.filter((topic) => topic === "conversation.get")).toHaveLength(reads);
  await expect(page.getByText("我会优先安排户外活动，并为你整理两种适合家庭的周末方案。", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "停止任务" })).toHaveCount(0);
  expect(answerAdmissions).toBe(1);
  expect(calls.filter((topic) => topic === "conversation.message")).toHaveLength(0);
  expect(calls.filter((topic) => topic === "conversation.question.answer")).toHaveLength(1);
  await page.reload();
  await expect(page.getByText("我会优先安排户外活动，并为你整理两种适合家庭的周末方案。", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "是", exact: true })).toHaveCount(0);
  expect(answerAdmissions).toBe(1);
  expect(calls.filter((topic) => topic === "conversation.get")).toHaveLength(reads + 1);
  expect(errors).toEqual([]);
});

test("UI Protocol V2 gallery stays inline and a streaming workspace expands and closes", async ({ page }) => {
  await page.setViewportSize({ width: 1680, height: 1000 });
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  const chartModuleRequests: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (/(?:^|\/)chart(?:-[^/]+)?\.(?:js|tsx)$/.test(path)) chartModuleRequests.push(path);
  });
  await page.route("**/api/**", async (route) => {
    if (route.request().url().includes("/api/media/")) return route.fulfill({ contentType: "image/png", body: await readFile("apps/web/public/artwork/family-v1.png") });
    return route.fulfill({ json: { user: { username: "测试用户" }, open: false } });
  });
  await page.addInitScript(({ conversationId }) => sessionStorage.setItem("jarvis-navigation", JSON.stringify({ page: "jarvis", selected: conversationId })), { conversationId });
  let turn = 0;
  let publishHourlyResource: (() => void) | undefined;
  const invoked: any[] = [];
  const workspaceId = "10000000-0000-4000-8000-000000000009";
  let artifact: any;
  const usageResources: any[] = [
    { version: 1, resource: "llm/usage/today", revision: 1, data: {
      total: { input_tokens: 10000000, output_tokens: 7329948, cached_input_tokens: 0, requests: 14 },
      providers: [{ provider: "openai", input_tokens: 9000000, output_tokens: 3000000 }],
      top_conversations: [{ title: "产品设计讨论", tokens: 8040000, input_tokens: 6000000, output_tokens: 2040000, requests: 32, share_percent: 46.4 }],
    } },
    { version: 1, resource: "llm/usage/agents", revision: 1, data: { groups: [{ agent_id: "jarvis-core", input_tokens: 10000000, output_tokens: 7329948 }] } },
    { version: 1, resource: "llm/usage/hourly", revision: 1, data: { series: [{ label: "08:00", value: 1200000 }, { label: "12:00", value: 2400000 }, { label: "16:00", value: 5000000 }] } },
  ];
  const usageView = { ...semanticView("usage_analysis", preset({ type: "view.show", intent: "usage_analysis", resources: ["llm/usage/today"] }), new Map(usageResources.map((resource) => [resource.resource, resource]))), title: "今日 Token 使用分析" };
  const streamingUsageView = { ...usageView, id: "usage-streaming", sections: usageView.sections.map((section) => section.title === "每小时 Token" ? { ...section, data: null, source_revision: 0 } : section) };
  await page.routeWebSocket("**/ws", (ws) => {
    const emit = (topic: string, payload: any) => ws.send(JSON.stringify({ topic, payload }));
    ws.onMessage((data) => {
      const request = JSON.parse(String(data));
      let payload: any = [];
      if (request.topic === "conversation.list") payload = [{ id: conversationId, title: "家庭日常" }];
      if (request.topic === "conversation.get") payload = { conversation: { id: conversationId, title: "家庭日常" }, messages: [] };
      if (request.topic === "agent.definition.list") payload = { agents: [], runs: [] };
      if (request.topic === "resource.get") {
        if (request.payload.resource === "llm/usage/hourly") return; // the live revision is emitted after the loading view
        payload = usageResources.find((resource) => resource.resource === request.payload.resource) ?? { version: 1, resource: request.payload.resource, revision: 0, data: {} };
      }
      if (request.topic === "workspace.get") payload = { workspace: { id: workspaceId, title: "今日 Token 使用分析" }, artifacts: artifact ? [artifact] : [], bindings: [] };
      if (request.topic === "ui.action.invoke") { invoked.push(request.payload); payload = { link: { primary: "http://immich.example/photos/test" } }; }
      if (request.topic === "conversation.message") { turn++; payload = { reply_id: `reply-${turn}`, turn_id: `turn-${turn}` }; }
      ws.send(JSON.stringify({ reply_to: request.id, topic: request.topic, type: "response", payload }));
      if (request.topic !== "conversation.message") return;
      const current = turn;
      if (current === 2) {
        const startedAt = Date.now();
        const phases = [
          { id: "usage-reasoning-1", kind: "reasoning", title: "分析用量问题", content: "我先汇总今天各会话的输入、输出与缓存 Token。" },
          { id: "usage-tool", kind: "tool", title: "读取模型用量", content: "" },
          { id: "usage-reasoning-2", kind: "reasoning", title: "核对会话用量", content: "正在按会话聚合用量并核对统计范围。" },
          { id: "usage-rank", kind: "processing", title: "计算会话排名", content: "" },
          { id: "usage-reasoning-3", kind: "reasoning", title: "整理分析结论", content: "已找到最高消耗会话，继续组织趋势和模型分布。" },
          { id: "usage-render", kind: "render", title: "生成分析视图", content: "" },
        ].map((phase, index) => ({ ...phase, conversation_id: conversationId, turn_id: `turn-${current}`, sequence: index + 1, revision: 1, status: "running", started_at: new Date(startedAt + index * 180).toISOString() }));
        const emitPhase = (phase: any) => emit("conversation.execution.updated", phase);
        emitPhase(phases[0]);
        for (let index = 0; index < phases.length - 1; index++) {
          setTimeout(() => {
            emitPhase({ ...phases[index], revision: 2, status: "completed", completed_at: new Date(startedAt + (index + 1) * 180).toISOString() });
            emitPhase(phases[index + 1]);
          }, (index + 1) * 180);
        }
        setTimeout(() => emitPhase({ ...phases.at(-1), revision: 2, status: "completed", completed_at: new Date(startedAt + phases.length * 180).toISOString() }), phases.length * 180 + 50);
      }
      const common = { id: `result-${current}`, conversation_id: conversationId, turn_id: `turn-${current}`, revision: 1, status: "loading", title: current === 1 ? "照片精选" : "今日 Token 使用分析", target: current === 1 ? "inline" : "workspace", workspace_id: current === 1 ? null : workspaceId };
      emit("conversation.result.updated", common);
      setTimeout(() => {
        const view = current === 1 ? { ui_protocol: "2.0", id: `view-${current}`, revision: 1, intent: "search", title: common.title, layout: { type: "workspace" }, fallback: "正在整理结果", sections: [
          { id: "photos", role: "primary", component: "photo_grid", title: "照片精选", data: { items: ["头像首选", "生活感最好", "氛围最好"].map((title, i) => ({ id: `photo-${i}`, title, resource_id: `10000000-0000-4000-8000-00000000000${i + 1}`, immich_asset_id: `20000000-0000-4000-8000-00000000000${i + 1}` })) }, fallback: "照片暂不可用" },
        ] } : streamingUsageView;
        artifact = current === 1 ? undefined : { id: "artifact", revision: 1, type: "native", source: JSON.stringify(view) };
        if (artifact) emit("workspace.artifact.updated", { workspace_id: workspaceId, artifact_id: "artifact", revision: 1 });
        emit("conversation.result.updated", { ...common, revision: 2, status: "ready", view });
        emit("conversation.message.delta", { conversation_id: conversationId, message_id: `reply-${current}`, revision: 1, content: current === 1 ? "为你挑选了这三张照片。" : "产品设计讨论是今天消耗最高的会话，共 8,040,000 Token，占今日 46.4%。详细趋势与排行已整理在右侧工作区。" });
        emit("conversation.status", { conversation_id: conversationId, message_id: `reply-${current}`, status: "completed" });
        if (current === 2) publishHourlyResource = () => emit("resource.updated", { version: 1, resource: "llm/usage/hourly", revision: 2, data: { series: [{ label: "08:00", value: 1200000 }, { label: "12:00", value: 2400000 }, { label: "16:00", value: 5000000 }, { label: "20:00", value: 1800000 }] } });
      }, current === 1 ? 700 : 1250);
    });
  });
  await page.goto(`${base}/jarvis`);
  await page.getByLabel("消息内容").fill("看看三张猫咪照片");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect(page.locator(".gallery-grid button")).toHaveCount(3);
  await expect(page.locator(".workspace-side")).toHaveCount(0);
  await page.getByRole("button", { name: "收藏这三张" }).click();
  await expect(page.getByLabel("消息内容")).toHaveValue(/Immich 中收藏以下照片/);
  await page.getByLabel("消息内容").fill("");
  const photos = await page.locator(".gallery-grid button").all();
  const bounds = await Promise.all(photos.map((photo) => photo.boundingBox()));
  expect(bounds[0]!.y).toBe(bounds[1]!.y); expect(bounds[1]!.y).toBe(bounds[2]!.y);
  await photos[0].click(); await expect(page.getByRole("dialog", { name: "照片详情" })).toBeVisible();
  await page.getByRole("button", { name: "在 Immich 打开" }).click();
  await expect.poll(() => invoked.length).toBe(1);
  expect(invoked[0]).toEqual({ type: "app.open", target: "immich", kind: "photo", resource_id: "20000000-0000-4000-8000-000000000001", platform: "web" });
  await page.keyboard.press("Escape"); await expect(photos[0]).toBeFocused();
  await page.screenshot({ path: ".local/evidence/m33-inline-gallery.png", fullPage: true });
  await page.getByLabel("消息内容").fill("分析今天的 Token 使用量");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  const workspace = page.locator(".workspace-side");
  await expect(workspace).toBeVisible();
  await expect(workspace.getByRole("status", { name: "正在生成分析界面" })).toBeVisible();
  await page.screenshot({ path: ".local/evidence/m33-workspace-streaming.png", fullPage: true });
  await expect(workspace.getByText("8,040,000 Token")).toBeVisible();
  await expect(workspace.getByRole("heading", { name: "最高消耗会话 · 产品设计讨论" })).toBeVisible();
  await expect(workspace.getByRole("heading", { name: "会话消耗排行 · Top 10" })).toBeVisible();
  const tokenTurn = page.locator(".jarvis-turn").last();
  await expect(tokenTurn.locator(".execution-stream li")).toHaveCount(6);
  await expect(tokenTurn.locator(".execution-stream li .execution-body summary span")).toHaveText([
    "分析用量问题", "读取模型用量", "核对会话用量", "计算会话排名", "整理分析结论", "生成分析视图",
  ]);
  await expect(tokenTurn.locator('.execution-stream li[data-status="running"]')).toHaveCount(0);
  await tokenTurn.locator(".execution-stream li").first().locator("summary").click();
  await expect(page.getByText("我先汇总今天各会话的输入、输出与缓存 Token。", { exact: true })).toBeVisible();
  await expect(workspace.locator('.section-skeleton[aria-label="正在加载每小时 Token"]')).toBeVisible();
  const hourlySkeleton = workspace.locator('.section-skeleton[aria-label="正在加载每小时 Token"]');
  await hourlySkeleton.scrollIntoViewIfNeeded();
  await expect(hourlySkeleton).toBeInViewport();
  await page.screenshot({ path: ".local/evidence/m33-workspace-data-stream.png", fullPage: true });
  await expect(workspace.locator(".semantic-section[data-component='line_chart'] .chart canvas")).toHaveCount(0);
  expect(publishHourlyResource).toBeTruthy();
  publishHourlyResource?.();
  await expect(workspace.locator(".semantic-section[data-component='line_chart'] .chart canvas")).toBeVisible();
  await expect(workspace.locator('.section-skeleton[aria-label="正在加载每小时 Token"]')).toHaveCount(0);
  await expect(workspace.locator(".chart canvas").first()).toBeVisible();
  expect(chartModuleRequests.length).toBeGreaterThan(0);
  await expect(page.locator(".workspace-source")).toHaveCount(0);
  await page.setViewportSize({ width: 900, height: 960 });
  await expect.poll(() => workspace.evaluate((element) => getComputedStyle(element).position)).toBe("fixed");
  const tabletWorkspace = await workspace.boundingBox();
  expect(tabletWorkspace).not.toBeNull();
  expect(tabletWorkspace!.x).toBeGreaterThanOrEqual(260);
  expect(tabletWorkspace!.x + tabletWorkspace!.width).toBeLessThanOrEqual(900);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => workspace.evaluate((element) => getComputedStyle(element).position)).toBe("fixed");
  const mobileWorkspace = await workspace.boundingBox();
  expect(mobileWorkspace).not.toBeNull();
  expect(mobileWorkspace!.x).toBeGreaterThanOrEqual(0);
  expect(mobileWorkspace!.x + mobileWorkspace!.width).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.setViewportSize({ width: 1680, height: 1000 });
  await expect.poll(() => workspace.evaluate((element) => getComputedStyle(element).position)).toBe("static");
  await page.screenshot({ path: ".local/evidence/m33-workspace-split.png", fullPage: true });
  const before = (await page.locator(".chat").boundingBox())!.width;
  await page.getByRole("button", { name: "关闭工作区" }).click();
  await expect(page.locator(".workspace-side")).toHaveCount(0);
  expect((await page.locator(".chat").boundingBox())!.width).toBeGreaterThan(before);
  expect(errors).toEqual([]);
});

test("today's cat activity keeps real service calls separate from timeline processing", async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 960 });
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/**", (route) => route.fulfill({ json: { user: { username: "测试用户" }, open: false } }));
  await page.addInitScript(({ conversationId }) => sessionStorage.setItem("jarvis-navigation", JSON.stringify({ page: "jarvis", selected: conversationId })), { conversationId });
  const workspaceId = "10000000-0000-4000-8000-000000000019";
  const workspaceView = {
    ui_protocol: "2.0", id: "cat-activity", revision: 1, intent: "overview", title: "今天的猫咪活动", layout: { type: "workspace" }, fallback: "活动分析暂不可用",
    sections: [
      { id: "summary", role: "summary", component: "metric_group", title: "今日活动概览", data: { 地点数: 3, 进食次数: 2, 总进食量: "86 g", 最长停留: "窗边 · 2 小时 18 分" }, fallback: "暂无活动统计" },
      { id: "areas", role: "primary", component: "data_table", title: "区域访问排行", data: [
        { 区域: "客厅窗边", 停留时长: "2 小时 18 分", 占比: "32.4%" },
        { 区域: "阳台", 停留时长: "1 小时 24 分", 占比: "19.7%" },
        { 区域: "卧室", 停留时长: "58 分", 占比: "13.6%" },
      ], fallback: "暂无区域记录" },
      { id: "feedings", role: "primary", component: "list", title: "进食记录", data: { items: [
        { title: "07:42 早餐", description: "Home Assistant 喂食器 · 干粮", status: "18 g" },
        { title: "12:36 午间进食", description: "Home Assistant 喂食器 · 主食罐头", status: "42 g" },
        { title: "18:04 晚间进食", description: "Home Assistant 喂食器 · 干粮", status: "26 g" },
      ] }, fallback: "暂无喂食记录" },
      { id: "timeline", role: "primary", component: "timeline", title: "活动时间线", data: [
        { timestamp: "2026-09-29T08:12:00+08:00", payload: { status: "completed", title: "窗边活动", description: "Frigate 检测到猫咪在客厅窗边活动。" } },
        { timestamp: "2026-09-29T12:36:00+08:00", payload: { status: "completed", title: "午间进食 · 42 g", description: "Home Assistant 喂食器记录。" } },
        { timestamp: "2026-09-29T18:04:00+08:00", payload: { status: "completed", title: "晚间进食 · 44 g", description: "Home Assistant 喂食器记录。" } },
      ], fallback: "今天还没有采集到活动记录" },
      { id: "dwell-share", role: "primary", component: "donut", title: "区域停留占比", data: [
        { label: "客厅窗边", value: 32.4 }, { label: "阳台", value: 19.7 }, { label: "卧室", value: 13.6 }, { label: "其他区域", value: 34.3 },
      ], fallback: "暂无停留时长统计" },
      { id: "important-events", role: "primary", component: "list", title: "重要事件", data: { items: [
        { title: "07:42 早餐", description: "摄像头识别到进食，喂食器记录 18 g。", status: "已核对" },
        { title: "12:36 午间进食", description: "Home Assistant 记录 42 g。", status: "已核对" },
        { title: "20:15 窗边休息", description: "当日最长连续停留区域。", status: "2 小时 18 分" },
      ] }, fallback: "暂无重要事件" },
    ],
  };
  const artifact = { id: "cat-activity-artifact", revision: 1, type: "native", source: JSON.stringify(workspaceView) };
  await page.routeWebSocket("**/ws", (ws) => {
    const emit = (topic: string, payload: any) => ws.send(JSON.stringify({ topic, payload }));
    ws.onMessage((data) => {
      const request = JSON.parse(String(data));
      let payload: any = [];
      if (request.topic === "conversation.list") payload = [{ id: conversationId, title: "家庭日常" }];
      if (request.topic === "conversation.get") payload = { conversation: { id: conversationId, title: "家庭日常" }, messages: [] };
      if (request.topic === "agent.definition.list") payload = { agents: [], runs: [] };
      if (request.topic === "workspace.list") payload = [{ id: workspaceId, title: "今天的猫咪活动" }];
      if (request.topic === "workspace.get") payload = { workspace: { id: workspaceId, title: "今天的猫咪活动" }, artifacts: [artifact], bindings: [] };
      if (request.topic === "conversation.message") payload = { reply_id: "cat-reply", turn_id: "cat-turn" };
      ws.send(JSON.stringify({ reply_to: request.id, topic: request.topic, type: "response", payload }));
      if (request.topic !== "conversation.message") return;
      const started = "2026-09-29T08:00:00+08:00";
      const events = [
        ["cat-r1", "reasoning", "分析位置与进食", "先按时间整理猫咪出现的位置和喂食记录。"],
        ["cat-frigate", "tool", "Frigate", ""],
        ["cat-r2", "reasoning", "核对进食", "摄像头事件无法说明进食量，需要对照家庭设备记录。"],
        ["cat-ha", "tool", "Home Assistant", ""],
        ["cat-merge", "processing", "整理活动时间线", ""],
        ["cat-render", "render", "生成活动工作区", ""],
      ].map(([id, kind, title, content], index) => ({ id, conversation_id: conversationId, turn_id: "cat-turn", sequence: index + 1, revision: 1, kind, title, content, status: "completed", started_at: started }));
      for (const event of events) emit("conversation.execution.updated", event);
      emit("conversation.result.updated", { id: "cat-result", conversation_id: conversationId, turn_id: "cat-turn", revision: 1, status: "ready", title: "今天的猫咪活动", target: "workspace", workspace_id: workspaceId, view: workspaceView });
      emit("conversation.message.delta", { conversation_id: conversationId, message_id: "cat-reply", revision: 1, content: "今天记录到 3 个活动地点和 2 次进食，共 86 g；窗边停留时间最长。详细时间线已放入工作区。" });
      emit("conversation.status", { conversation_id: conversationId, message_id: "cat-reply", status: "completed" });
    });
  });
  await page.goto(`${base}/jarvis`);
  await page.getByLabel("消息内容").fill("今天我家的猫咪都去过哪些地方，几点吃的东西，吃了多少？");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect(page.getByText("Frigate", { exact: true })).toBeVisible();
  await expect(page.getByText("Home Assistant", { exact: true })).toBeVisible();
  await expect(page.getByText("整理活动时间线")).toBeVisible();
  const labels = await page.locator(".execution-stream li .execution-body summary span").allTextContents();
  expect(labels).toEqual(["分析位置与进食", "Frigate", "核对进食", "Home Assistant", "整理活动时间线", "生成活动工作区"]);
  await expect(page.locator(".workspace-side")).toBeVisible();
  const workspace = page.locator(".workspace-side");
  await expect(workspace.getByText("窗边 · 2 小时 18 分")).toBeVisible();
  await expect(workspace.getByRole("heading", { name: "区域访问排行" })).toBeVisible();
  await expect(workspace.getByText("客厅窗边", { exact: true })).toBeVisible();
  await expect(workspace.getByRole("heading", { name: "进食记录" })).toBeVisible();
  await expect(workspace.getByRole("region", { name: "进食记录" }).getByText("07:42 早餐", { exact: true })).toBeVisible();
  await expect(workspace.getByRole("heading", { name: "活动时间线" })).toBeVisible();
  await expect(workspace.getByText("午间进食 · 42 g")).toBeVisible();
  await expect(workspace.getByText("晚间进食 · 44 g")).toBeVisible();
  await expect(workspace.getByRole("heading", { name: "区域停留占比" })).toBeVisible();
  await expect(workspace.locator(".semantic-section[data-component='donut'] .chart canvas")).toBeVisible();
  await expect(workspace.getByRole("heading", { name: "重要事件" })).toBeVisible();
  const steps = page.locator(".execution-stream").last().locator(".execution-steps");
  const desktopScroll = await steps.evaluate((element) => ({ width: element.clientWidth, scroll: element.scrollWidth }));
  expect(desktopScroll.scroll).toBeLessThanOrEqual(desktopScroll.width + 2);
  await page.screenshot({ path: ".local/evidence/m33-cat-activity-workspace.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByText("左右滑动查看更多 →")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  expect(errors).toEqual([]);
});

test("admin Developer Mode reconciles raw activity evidence on real-time transitions", async ({ browser }) => {
  const page = await browser.newPage();
  const requests: any[] = [];
  const id = "10000000-0000-4000-8000-000000000031";
  const turn = "10000000-0000-4000-8000-000000000032";
  let activity: any;
  await page.route("**/api/**", (route) => route.fulfill({ json: { user: { username: "管理员" }, open: false } }));
  await page.addInitScript(({ conversationId }) => sessionStorage.setItem("jarvis-navigation", JSON.stringify({ page: "jarvis", selected: conversationId })), { conversationId: id });
  await page.routeWebSocket("**/ws", (ws) => {
    const emit = (topic: string, payload: any) => ws.send(JSON.stringify({ topic, payload }));
    ws.onMessage((data) => {
      const request = JSON.parse(String(data));
      requests.push(request);
      let payload: any = [];
      if (request.topic === "conversation.list") payload = [{ id, title: "Developer 实时证据" }];
      if (request.topic === "conversation.get") payload = { conversation: { id, title: "Developer 实时证据" }, messages: [], events: [], activities: activity ? [activity] : [], questions: [], approvals: [], results: [] };
      if (request.topic === "agent.definition.list") payload = { agents: [], runs: [] };
      if (request.topic === "conversation.message") {
        payload = { reply_id: "developer-reply", turn_id: turn };
        activity = { id: "developer-activity", turn_id: turn, capability: "mcp__immich.search", status: "running", input: { query: "orange cat", limit: 3 }, started_at: "2026-09-29T08:00:00Z" };
      }
      ws.send(JSON.stringify({ reply_to: request.id, topic: request.topic, type: "response", payload }));
      if (request.topic === "conversation.message") {
        emit("conversation.activity.started", { conversation_id: id, turn_id: turn, activity_id: "developer-activity", capability: "mcp__immich.search", status: "running" });
        setTimeout(() => {
          activity = { ...activity, status: "completed", output: { assets_found: 3, result: "search completed" }, completed_at: "2026-09-29T08:00:01Z" };
          emit("conversation.activity.completed", { conversation_id: id, turn_id: turn, activity_id: "developer-activity", capability: "mcp__immich.search", status: "completed" });
        }, 150);
      }
    });
  });
  await page.goto(`${base}/jarvis?developer=1`);
  await page.getByLabel("消息内容").fill("列出三张候选照片");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect.poll(() => requests.filter((request) => request.topic === "conversation.get").length).toBe(2);
  const refresh = requests.filter((request) => request.topic === "conversation.get").at(-1);
  expect(refresh.payload).toEqual({ conversation_id: id, developer: true });
  await expect(page.locator(".execution-stream pre")).toContainText('"query": "orange cat"');
  await expect.poll(() => requests.filter((request) => request.topic === "conversation.get").length).toBe(3);
  await expect(page.locator(".execution-stream pre")).toContainText('"assets_found": 3');
  await page.close();
});
