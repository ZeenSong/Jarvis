import test from "node:test";
import assert from "node:assert/strict";
import { MediaStore } from "../apps/server/src/media.js";
import { buildApp } from "../apps/server/src/app.js";
import { createPairingCode, pair } from "../apps/server/src/auth.js";
import { randomUUID } from "node:crypto";
import { assistantContentParts } from "../apps/web/src/assistant-ui-adapter.js";
import { createHermesContextToken } from "../packages/hermes-bridge/src/index.js";

test("assistant media markers become authenticated image parts", () => {
  const legacy = assistantContentParts("看这张图 MEDIA:/opt/data/media/tmp/photo.png");
  assert.equal(legacy[0].type, "text");
  assert.equal(legacy[1].type, "file");
  assert.equal((legacy[1] as any).data, "/api/media/file?path=%2Fopt%2Fdata%2Fmedia%2Ftmp%2Fphoto.png");
  assert.equal((legacy[1] as any).sourceType, "url");

  const published = assistantContentParts("MEDIA:/api/media/media-token/thumbnail");
  assert.equal(published.length, 1);
  assert.equal(published[0].type, "file");
  assert.equal((published[0] as any).data, "/api/media/media-token/thumbnail");

  const resource = assistantContentParts("我从相册里选了这张：MEDIA_RESOURCE:10000000-0000-4000-8000-000000000003");
  assert.equal(resource[0].type, "text");
  assert.equal(resource[1].type, "file");
  assert.equal((resource[1] as any).data, "/api/media/10000000-0000-4000-8000-000000000003/content");
  assert.doesNotMatch(JSON.stringify(resource), /\/opt\/data/);
});

test("persistent media resources are conversation-scoped and serve authenticated content", {skip:!process.env.TEST_DATABASE_URL},async()=>{
  const priorBridgeKey=process.env.HERMES_BRIDGE_KEY;
  process.env.HERMES_BRIDGE_KEY="media-bridge-test-key";
  let ctx: Awaited<ReturnType<typeof buildApp>> | undefined;
  try {
    ctx=await buildApp({databaseUrl:process.env.TEST_DATABASE_URL!});
    const owner=await pair(ctx.db,randomUUID(),await createPairingCode(ctx.db));
    const other=await pair(ctx.db,randomUUID(),await createPairingCode(ctx.db));
    const conversationId=randomUUID();
    await ctx.db.query("INSERT INTO conversations(id,title,owner_device_id) VALUES($1,'媒体测试',$2)",[conversationId,owner.device_id]);
    const resource=await ctx.mediaResources.publish(owner.device_id,conversationId,{data:Buffer.from([137,80,78,71,13,10,26,10]),contentType:"image/png",source:"immich",filename:"猫咪.png",metadata:{asset_id:"asset-1"}});
    assert.match(resource.thumbnail_url,new RegExp(`/api/media/${resource.id}/thumbnail`));
    assert.equal(resource.mime_type,"image/png");assert.equal(resource.source,"immich");
    assert.equal(await ctx.mediaResources.read(resource.id,other.device_id),undefined);
    assert.equal((await ctx.app.inject({url:resource.content_url})).statusCode,401);
    assert.equal((await ctx.app.inject({url:resource.content_url,headers:{authorization:`Bearer ${other.token}`}})).statusCode,404);
    const result=await ctx.app.inject({url:resource.content_url,headers:{authorization:`Bearer ${owner.token}`}});
    assert.equal(result.statusCode,200);assert.equal(result.headers["content-type"],"image/png");
    assert.equal(result.headers["cache-control"],"private, no-store");assert.equal(result.rawPayload[0],137);
    assert.equal((await ctx.app.inject({url:resource.thumbnail_url,headers:{authorization:`Bearer ${owner.token}`} })).statusCode,200);
    const bridgeResponse=await ctx.app.inject({method:"POST",url:"/internal/hermes/media",headers:{"x-jarvis-bridge-key":"media-bridge-test-key"},payload:{
      context_token:createHermesContextToken("media-bridge-test-key",owner.device_id,conversationId),
      content_type:"image/png",source:"homeassistant",data:Buffer.from([137,80,78,71,13,10,26,10]).toString("base64"),
    }});
    assert.equal(bridgeResponse.statusCode,200);assert.match(bridgeResponse.json().id,/^[0-9a-f-]{36}$/);assert.equal(bridgeResponse.json().source,"homeassistant");
  } finally {
    if(ctx) await ctx.app.close();
    if(priorBridgeKey===undefined) delete process.env.HERMES_BRIDGE_KEY; else process.env.HERMES_BRIDGE_KEY=priorBridgeKey;
  }
});

test("media grants isolate devices, expire and do not retain caller buffers",()=>{
  let now=0;const store=new MediaStore(()=>now);
  const data=Buffer.from([137,80,78,71,13,10,26,10]);
  const path=store.publish("owner",{data,contentType:"image/png"});const id=path.split("/")[3];
  data.fill(0);
  assert.equal(store.read(id,"owner")!.data[0],137);
  assert.equal(store.read(id,"other"),undefined);
  now=300000;assert.equal(store.read(id,"owner"),undefined);
  assert.throws(()=>store.publish("owner",{data:Buffer.from("<svg/>"),contentType:"image/png"}));
});
test("media HTTP route requires authentication and the owning device", {skip:!process.env.TEST_DATABASE_URL},async()=>{
  const ctx=await buildApp({databaseUrl:process.env.TEST_DATABASE_URL!});
  try {
    const owner=await pair(ctx.db,randomUUID(),await createPairingCode(ctx.db));
    const other=await pair(ctx.db,randomUUID(),await createPairingCode(ctx.db));
    const path=ctx.media.publish(owner.device_id,{data:Buffer.from([137,80,78,71,13,10,26,10]),contentType:"image/png"});
    assert.equal((await ctx.app.inject({url:path})).statusCode,401);
    assert.equal((await ctx.app.inject({url:path,headers:{authorization:`Bearer ${other.token}`}})).statusCode,404);
    const result=await ctx.app.inject({url:path,headers:{authorization:`Bearer ${owner.token}`}});
    assert.equal(result.statusCode,200);assert.equal(result.headers["content-type"],"image/png");
    assert.equal(result.headers["cache-control"],"private, no-store");assert.equal(result.rawPayload[0],137);
  } finally {await ctx.app.close();}
});
