import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import WebSocket from 'ws';
import { buildApp } from '../apps/server/src/app.js';
import { pair, createPairingCode } from '../apps/server/src/auth.js';
import { M2 } from '../apps/server/src/m2.js';
import { createHermesContextToken } from '../packages/hermes-bridge/src/index.js';
const databaseUrl = process.env.TEST_DATABASE_URL;
test('M3.11 owner isolation, bound single-use approvals and durable native views', {skip: !databaseUrl, timeout: 20000}, async () => {
  process.env.HERMES_BRIDGE_KEY = 'isolated-regression-bridge-key';
  const ctx = await buildApp({databaseUrl: databaseUrl!});
  const sockets: WebSocket[] = [];
  try {
    await ctx.app.listen({host:'127.0.0.1',port:0});
    const base = `ws://127.0.0.1:${(ctx.app.server.address() as any).port}/ws`;
    const owners = [];
    for (let i=0;i<3;i++) {
      const owner = await pair(ctx.db,randomUUID(),await createPairingCode(ctx.db));
      if(i<2) { const user = randomUUID(); await ctx.db.query("INSERT INTO users(id,username,role) VALUES($1,$2,'member')",[user,user]); await ctx.db.query('UPDATE devices SET user_id=$1 WHERE id=$2',[user,owner.device_id]); }
      owners.push(owner);
    }
    const [a,b,c] = owners;
    const events: any[][] = [[],[],[]];
    for(const [i,owner] of owners.entries()) {
      const ws = new WebSocket(base,{headers:{authorization:`Bearer ${owner.token}`}}); sockets.push(ws);
      ws.on('message',raw=>events[i].push(JSON.parse(raw.toString()))); await once(ws,'open');
    }
    const conv:any = await ctx.m2.handle('conversation.create',{title:'private A'},a.device_id);
    const schedule:any = await ctx.m2.handle('schedule.create',{prompt:'private A prompt',cadence:'once',next_run_at:new Date(Date.now()+86400000).toISOString()},a.device_id);
    const workspace:any = await ctx.m2.handle('workspace.create',{conversation_id:conv.id,title:'private A workspace'},a.device_id);
    await assert.rejects(ctx.m2.handle('conversation.get',{conversation_id:conv.id},b.device_id),/not_found/);
    await assert.rejects(ctx.m2.handle('workspace.get',{workspace_id:workspace.id},c.device_id),/not_found/);
    assert.equal((await ctx.m2.handle('schedule.list',{},c.device_id) as any[]).some(x=>x.id===schedule.id),false);
    const call = (tool:string,args:any) => ctx.app.inject({method:'POST',url:'/internal/hermes/capability',headers:{'x-jarvis-bridge-key':process.env.HERMES_BRIDGE_KEY},payload:{tool,arguments:args,context_token:createHermesContextToken(process.env.HERMES_BRIDGE_KEY!,a.device_id,conv.id)}});
    assert.equal((await call('ui_view_show',{intent:'nonsense',resources:[]})).statusCode,400);
    const valid = await call('ui_view_show',{intent:'system_overview',resources:[]}); assert.equal(valid.statusCode,200,valid.body);
    const restored = await ctx.m2.workspaces.get(a.device_id,valid.json().workspace_id);
    assert.equal(restored.artifacts[0].type,'native'); assert.equal(JSON.parse(restored.artifacts[0].source).title,'私人云 · 现在'); assert.ok(restored.bindings.length);
    await new Promise(r=>setTimeout(r,150));
    for(const topic of ['conversation.updated','schedule.created','workspace.created','conversation.tool.failed','conversation.tool.completed']) assert.ok(events[0].some(x=>x.topic===topic),topic);
    for(const other of events.slice(1)) assert.equal(other.some(x=>JSON.stringify(x).includes(conv.id)||JSON.stringify(x).includes(schedule.id)||JSON.stringify(x).includes(workspace.id)),false);
    let dispatched=0;
    const node=`node-${randomUUID()}`;
    await ctx.db.query("INSERT INTO agents(id,owner_device_id,name,runtime,status,capabilities) VALUES($1,$2,'node','test','online',$3)",[node,a.device_id,JSON.stringify(['node.codex.execute'])]);
    const m = new M2(ctx.db,()=>{},async()=>({}),undefined,{},async()=>{dispatched++;return {ok:true}});
    const payload={node_id:node,input:{prompt:'approved',cwd:'/workspace'}};
    const approval=await m.control.createApproval(a.device_id,{capability:'node.codex.execute',input:payload});
    await m.control.resolveApproval(a.device_id,approval.id,'approved');
    const invoke=(input:any)=>m.handle('node.invoke',{...input,capability:'node.codex.execute',approval_id:approval.id},a.device_id);
    await assert.rejects(invoke({...payload,input:{...payload.input,prompt:'unapproved'}}),/approval_required/);
    const results=await Promise.allSettled([invoke(payload),invoke(payload)]);
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(dispatched,1);
    await assert.rejects(invoke(payload),/approval_required/);
    const exp=await m.control.createApproval(a.device_id,{capability:'node.codex.execute',input:payload}); await m.control.resolveApproval(a.device_id,exp.id,'approved');
    await ctx.db.query("UPDATE approvals SET expires_at=now()-interval '1 second' WHERE id=$1",[exp.id]);
    await assert.rejects(m.handle('node.invoke',{...payload,capability:'node.codex.execute',approval_id:exp.id},a.device_id),/approval_required/);
    assert.equal(dispatched,1);
  } finally { for(const ws of sockets) ws.terminate(); await ctx.app.close(); delete process.env.HERMES_BRIDGE_KEY; }
});
