import { test, expect } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";
let server: ViteDevServer;
let base: string;
test.beforeAll(async () => {
  server = await createServer({ root: "apps/web", server: { host: "127.0.0.1", port: 0 }, logLevel: "error", plugins: [{name:"renderer-test",configureServer(dev) {
  dev.middlewares.use("/__renderer_test", async (_req, res) => {
    res.setHeader("Content-Type", "text/html");
    res.end(await dev.transformIndexHtml('/__renderer_test', `<div id="root"></div><script type="module">
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {DynamicView} from '/src/dynamic-v2.tsx';
      import '/src/product.css';
      const root=createRoot(document.getElementById('root'));
      window.sent=[];
      window.renderView=(value)=>root.render(React.createElement(DynamicView,{value,action:(a)=>window.sent.push(a)}));
    </script>`));
  });
  }}] });
  await server.listen();
  base = `http://127.0.0.1:${(server.httpServer!.address() as {port:number}).port}`;
});
test.afterAll(async () => { await server?.close(); });
test("all grouped actions preserve identity and unsupported versions are inert", async ({ page }) => {
  await page.goto(`${base}/__renderer_test`);
  await page.waitForFunction(() => typeof (window as any).renderView === "function");
  const view = { ui_protocol: "2.0", id: "actions", revision: 1, intent: "review_task", title: "操作工作区", layout: {type:"workspace"}, fallback:"无法显示", sections: [{id:"controls",role:"actions",component:"action",component_version:2,title:"可用操作",fallback:"请更新客户端",actions:[
    {id:"open",label:"打开关联任务",capability:"run.open",resource_id:"run-a",risk:"read",input:{}},
    {id:"reject",label:"拒绝此申请",capability:"approval.response",resource_id:"approval-b",risk:"write",input:{approved:false}},
  ]}] };
  await page.evaluate((v) => (window as any).renderView(v), view);
  await page.getByRole("button", { name:"打开关联任务", exact:true }).click();
  await page.getByRole("button", { name:"拒绝此申请", exact:true }).click();
  expect(await page.evaluate(() => (window as any).sent)).toEqual([{type:"run.open",target:"run-a"},{type:"approval.response",target:"approval-b",approved:false}]);
  view.sections[0].actions[0].risk = "dangerous";
  await page.evaluate((v) => (window as any).renderView(v), view);
  await page.getByRole("button", { name:"打开关联任务", exact:true }).click();
  await expect(page.getByRole("dialog", { name:"确认高风险操作" })).toBeVisible();
  expect(await page.evaluate(() => (window as any).sent.length)).toBe(2);
  await page.getByRole("button", { name:"返回检查", exact:true }).click();
  expect(await page.evaluate(() => (window as any).sent.length)).toBe(2);
  await page.getByRole("button", { name:"打开关联任务", exact:true }).click();
  await page.getByRole("button", { name:"确认执行", exact:true }).click();
  expect(await page.evaluate(() => (window as any).sent.at(-1))).toEqual({type:"run.open",target:"run-a"});
  expect(await page.evaluate(() => (window as any).sent.length)).toBe(3);
  view.sections[0].component_version = 3;
  await page.evaluate((v) => (window as any).renderView(v), view);
  await expect(page.getByText("请更新客户端")).toBeVisible();
  await expect(page.getByRole("button", { name:"打开关联任务", exact:true })).toHaveCount(0);
});

test("malformed component is isolated and recovers with a new revision", async ({ page }) => {
  await page.goto(`${base}/__renderer_test`);
  await page.waitForFunction(() => typeof (window as any).renderView === "function");
  const view = {ui_protocol:"2.0",id:"recovery",revision:1,intent:"overview",title:"工作区",layout:{type:"workspace"},fallback:"不可用",sections:[
    {id:"bad",role:"primary",component:"timeline",component_version:2,title:"执行过程",data:[null],fallback:"事件暂不可用"},
    {id:"good",role:"primary",component:"markdown",component_version:2,title:"仍可查看",data:"其他面板正常",fallback:"不可用"},
  ]};
  await page.evaluate((v) => (window as any).renderView(v),view);
  await expect(page.getByText("其他面板正常")).toBeVisible();
  await expect(page.getByText("事件暂不可用")).toBeVisible();
  view.revision=2;
  (view.sections[0] as any).data=[{id:1,timestamp:"2026-09-11T00:00:00Z",payload:{title:"恢复成功"}}];
  await page.evaluate((v) => (window as any).renderView(v),view);
  await expect(page.getByText("恢复成功", {exact:true})).toBeVisible();
  await expect(page.getByText("事件暂不可用")).toHaveCount(0);
});

test("long timeline bounds history and keeps the latest event accessible", async ({ page }) => {
  await page.goto(`${base}/__renderer_test`);
  await page.waitForFunction(() => typeof (window as any).renderView === "function");
  await page.evaluate(() => (window as any).renderView({ui_protocol:"2.0",id:"history",revision:1,intent:"review_task",title:"长任务",layout:{type:"workspace"},fallback:"不可用",sections:[
    {id:"events",role:"activity",component:"timeline",component_version:2,title:"执行过程",fallback:"不可用",data:Array.from({length:250},(_,i)=>({id:i,timestamp:"2026-09-11T00:00:00Z",payload:{title:`事件 ${i}`,description:i===249?"最后一项说明":"",password:"hidden-credential"}}))},
  ]}));
  await expect(page.getByText("显示最近 200 条事件")).toBeVisible();
  await expect(page.getByRole("listitem")).toHaveCount(200);
  expect(await page.locator(".event-timeline ol").evaluate((el) => el.scrollHeight > el.clientHeight && el.clientHeight <= 560)).toBeTruthy();
  await expect(page.getByText("事件 0",{exact:true})).toHaveCount(0);
  await expect(page.getByText("hidden-credential")).toHaveCount(0);
  await page.getByText("事件 249",{exact:true}).scrollIntoViewIfNeeded();
  await expect(page.getByText("事件 249",{exact:true})).toBeVisible();
  await page.getByText("查看说明",{exact:true}).click();
  await expect(page.getByText("最后一项说明",{exact:true})).toBeVisible();
});

test("gallery opens native detail and handles failed thumbnails",async({page})=>{
  await page.route("**/api/media/photo-1/thumbnail",route=>route.fulfill({status:404}));
  await page.goto(`${base}/__renderer_test`);
  await page.waitForFunction(()=>typeof (window as any).renderView==="function");
  await page.evaluate(()=>(window as any).renderView({ui_protocol:"2.0",id:"gallery",revision:1,intent:"search",title:"照片",layout:{type:"page"},fallback:"不可用",sections:[{id:"photos",role:"primary",component:"gallery",component_version:2,title:"搜索结果",fallback:"不可用",data:{items:[{id:"photo-1",title:"测试照片",description:"仅供渲染测试",thumbnail:"/api/media/photo-1/thumbnail"}]}}]}));
  await expect(page.getByText("图片暂不可用")).toBeVisible();
  await page.getByRole("button",{name:"查看照片：测试照片"}).click();
  await expect(page.getByRole("dialog",{name:"照片详情"})).toContainText("仅供渲染测试");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByRole("button",{name:"查看照片：测试照片"})).toBeFocused();
});
