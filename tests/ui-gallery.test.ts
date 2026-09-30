import test from "node:test";
import assert from "node:assert/strict";
import { galleryDataSchema, mediaPathSchema } from "../packages/ui-protocol-v2/src/gallery.js";
import { semanticView } from "../packages/ui-presets/src/v2.js";
import { preset } from "../packages/ui-presets/src/index.js";
test("gallery accepts gateway media only, rejecting URL credentials and traversal",()=>{
  assert.equal(mediaPathSchema.safeParse("/api/media/photo-1/thumbnail").success,true);
  for(const path of ["https://example.com/a.jpg","//example.com/a","/api/media/../thumbnail","/api/media/id/thumbnail?token=secret","data:image/svg+xml,abc"]) assert.equal(mediaPathSchema.safeParse(path).success,false);
  assert.equal(galleryDataSchema.safeParse({items:[{id:"one",title:"照片",resource_id:"10000000-0000-4000-8000-000000000003"}]}).success,true);
  assert.equal(galleryDataSchema.safeParse({items:[{id:"one",title:"无资源",description:"没有图片"}]}).success,false);
  assert.equal(galleryDataSchema.safeParse({items:[{id:"one",title:"照片",thumbnail:"/api/media/one/thumbnail"},{id:"one",title:"重复",thumbnail:"/api/media/one/thumbnail"}]}).success,false);
});

test("usage workspace leads with the real highest-token conversation", () => {
  const usage = { version: 1 as const, resource: "llm/usage/today", revision: 7, data: {
    top_conversations: [{ title: "家庭相册整理", tokens: 8040000, input_tokens: 6000000, output_tokens: 2040000, requests: 32, share_percent: 44.6 }],
  } };
  const view = semanticView("usage_analysis", preset({ type: "view.show", intent: "usage_analysis", resources: ["llm/usage/today"] }), new Map([[usage.resource, usage]]));
  assert.equal(view.sections[0].title, "最高消耗会话 · 家庭相册整理");
  assert.equal(view.sections[0].data, "8,040,000 Token");
  assert.deepEqual(view.sections[1].data, { "占比": "44.6%", "请求数": 32 });
});
