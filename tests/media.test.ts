import test from "node:test";
import assert from "node:assert/strict";
import { MediaStore } from "../apps/server/src/media.js";
import { buildApp } from "../apps/server/src/app.js";
import { createPairingCode, pair } from "../apps/server/src/auth.js";
import { randomUUID } from "node:crypto";
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
