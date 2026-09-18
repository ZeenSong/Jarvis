import {chromium} from 'playwright';
import {writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import WebSocket from 'ws';
import {createPairingCode} from '../../../apps/server/src/auth.ts';
const base='http://127.0.0.1:55450',dir='docs/evidence/m3.11-20260916';
const pool=new pg.Pool({connectionString:'postgres://postgres@127.0.0.1:55449/jarvis_review'});
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']});const c=await browser.newContext({viewport:{width:1600,height:1100}}),p=await c.newPage();
const r={time:new Date().toISOString(),scope:'isolated DB, deterministic provider, mock node executor; real app authorization and browser UI',errors:[]};const sockets=[];
p.on('pageerror',e=>r.errors.push(e.message));await p.addInitScript(()=>{window.__reviewSockets=[];const Original=window.WebSocket;window.WebSocket=class extends Original{constructor(...args){super(...args);window.__reviewSockets.push(this);}};});
const shot=name=>p.screenshot({path:`${dir}/${name}.png`,fullPage:true});
const api=async(ctx,topic,data={})=>{const q=await ctx.request.post(`${base}/api/v2/${topic}`,{data,headers:{Origin:base}});return {status:q.status(),body:await q.json()};};
async function socket(token){const ws=new WebSocket(base.replace('http','ws')+'/ws',{headers:{Authorization:`Bearer ${token}`}});await new Promise((ok,bad)=>{ws.once('open',ok);ws.once('error',bad);});sockets.push(ws);return ws;}
async function rpc(ws,topic,payload){const id=randomUUID();return new Promise((ok,bad)=>{const timer=setTimeout(()=>bad(Error('rpc timeout '+topic)),5000);const receive=raw=>{const m=JSON.parse(raw);if(m.reply_to===id){clearTimeout(timer);ws.off('message',receive);ok(m);}};ws.on('message',receive);ws.send(JSON.stringify({id,version:1,type:'request',topic,payload}));});}
try{
 await p.goto(base);await p.getByRole('button',{name:'使用用户名密码',exact:true}).click();await p.getByLabel('用户名',{exact:true}).fill('review-admin');await p.getByLabel('密码',{exact:true}).fill('M311-Local-Fixture-Only');await p.getByRole('button',{name:'登录',exact:true}).click();await p.getByRole('heading',{name:'让科技，回归生活。'}).waitFor();r.login=true;
 await p.locator('nav').getByRole('button',{name:'Jarvis',exact:true}).click();await p.getByRole('button',{name:'M311 Markdown fixture',exact:true}).click();await p.locator('.message.jarvis table').waitFor();r.markdown=await p.locator('.message.jarvis').evaluate(e=>Object.fromEntries(['h1','strong','em','ul','blockquote','pre','table','a'].map(k=>[k,e.querySelectorAll(k).length])));await shot('10-web-markdown');
 await p.getByRole('button',{name:'查看图表',exact:true}).click();await p.getByRole('region',{name:'持久化工作区'}).waitFor();await p.getByRole('button',{name:'＋ 新建',exact:true}).click();await p.getByLabel('Artifact 源码').fill('<h1>M311 Version A</h1>');await p.getByRole('button',{name:'保存 Artifact'}).click();await p.frameLocator('iframe').getByText('M311 Version A').waitFor();
 const first=(await api(c,'workspace.list')).body[0];const id=first.id;const aid=first.artifacts[0].id;
 await p.getByLabel('Artifact 源码').fill('<h1>M311 Version B</h1>');await p.getByRole('button',{name:'保存 Artifact'}).click();await p.frameLocator('iframe').getByText('M311 Version B').waitFor();const next=(await api(c,'workspace.get',{workspace_id:id})).body;r.workspace={id,sameArtifact:next.artifacts[0].id===aid,artifactCount:next.artifacts.length,workspaceRevision:next.workspace.revision,artifactRevision:next.artifacts[0].revision};await shot('11-web-workspace-save');
 await p.getByRole('button',{name:'＋ 新建',exact:true}).click();await p.waitForTimeout(300);r.newWorkspaceSource=await p.getByLabel('Artifact 源码').inputValue();await shot('12-web-new-workspace');
 await p.getByRole('button',{name:'待处理',exact:true}).click();await p.getByRole('heading',{name:'已登录设备'}).waitFor();await shot('13-web-devices');await p.getByRole('button',{name:'待处理',exact:true}).click();
 // Two DIFFERENT users. HTTP isolation versus live event isolation.
 const memberName='review-member-'+Date.now();const inv=await api(c,'auth/invites',{username:memberName});const bctx=await browser.newContext();await api(bctx,'auth/invites/accept',{token:inv.body.token,password:'M311-Member-Fixture-Only'});const member=await api(bctx,'auth/login',{username:memberName,password:'M311-Member-Fixture-Only',device_id:randomUUID()});const memberWs=await socket(member.body.access_token);const leaked=[];memberWs.on('message',raw=>{const m=JSON.parse(raw);if(m.type==='event'&&JSON.stringify(m.payload).includes('M311_PRIVATE'))leaked.push(m);});
 const convo=(await api(c,'conversation.create',{title:'M311_PRIVATE_OWNER_ONLY'})).body;
 const sch=await api(c,'schedule.create',{prompt:'M311_PRIVATE_SCHEDULE_OWNER_ONLY',cadence:'once',next_run_at:'2099-01-01T00:00:00Z'});
 await api(c,'conversation.message',{conversation_id:convo.id,content:'M311_PRIVATE_MESSAGE_OWNER_ONLY',idempotency_key:randomUUID()});await p.waitForTimeout(2200);
 r.crossUser={memberHttpConversation:await api(bctx,'conversation.get',{conversation_id:convo.id}),memberScheduleList:await api(bctx,'schedule.list'),leakedEvents:leaked};
 await api(c,'schedule.delete',{schedule_id:sch.body.id});
 // Bounded mock execution: the actual Kernel decides whether to forward.
 const agentId=randomUUID();const pair=await p.request.post(`${base}/api/v1/pair`,{data:{device_id:agentId,code:await createPairingCode(pool,'agent')}});const node=await socket((await pair.json()).token);const calls=[];
 node.on('message',raw=>{const m=JSON.parse(raw);if(m.type==='request'&&m.topic==='node.invoke'){calls.push(m.payload);node.send(JSON.stringify({id:randomUUID(),version:1,type:'response',topic:m.topic,reply_to:m.id,payload:{ok:true,result:{fixture:true,received:m.payload.input}}}));}});
 await rpc(node,'agent.register',{agent_id:'m311-review-mock-node',name:'M311 mock executor',runtime:'node-bridge',version:'1.0',capabilities:['node.codex.execute']});await api(c,'agent.claim',{agent_id:'m311-review-mock-node'});
 const approval=(await api(c,'approval.create',{capability:'node.codex.execute',input:{node_id:'m311-review-mock-node',prompt:'APPROVED_INPUT_A'}})).body;await api(c,'approval.resolve',{approval_id:approval.id,status:'approved'});
 const invoke=()=>api(c,'node.invoke',{node_id:'m311-review-mock-node',capability:'node.codex.execute',input:{prompt:'UNAPPROVED_DIFFERENT_INPUT_B'},approval_id:approval.id});r.approval={first:await invoke(),replay:await invoke(),forwarded:calls};
 // Same user, different Session: revoke existing websocket.
 const other=await browser.newContext();const same=await api(other,'auth/login',{username:'review-admin',password:'M311-Local-Fixture-Only',device_id:randomUUID()});const oldWs=await socket(same.body.access_token);const closed=new Promise(ok=>oldWs.once('close',(code,reason)=>ok({code,reason:String(reason)})));
 await c.request.delete(`${base}/api/v2/auth/sessions/${same.body.session_id}`,{headers:{Origin:base}});r.revocation={close:await Promise.race([closed,new Promise(ok=>setTimeout(()=>ok('timeout'),3000))]),http:(await other.request.get(`${base}/api/v2/auth/me`)).status()};
 // Expired access during reconnection, not just page load.
 await c.clearCookies({name:'jarvis_access'});const responses=[];p.on('response',x=>{if(x.url().includes('/auth/refresh'))responses.push(x.status());});await p.evaluate(()=>window.__reviewSockets.forEach(s=>s.close()));await p.waitForTimeout(6500);r.hotReconnect={refreshResponses:[...responses],session:(await c.request.get(`${base}/api/v2/session`)).status(),body:await p.locator('body').innerText()};await shot('14-web-expired-reconnect');
 await p.reload();await p.waitForTimeout(2000);r.reloadRefresh={responses,session:(await c.request.get(`${base}/api/v2/auth/me`)).status()};await shot('15-web-refresh-after-reload');
}catch(e){r.error=String(e);await shot('isolated-error').catch(()=>{});}finally{await writeFile(`${dir}/isolated-results.json`,JSON.stringify(r,null,2));console.log({error:r.error,markdown:r.markdown,workspace:r.workspace,crossUser:r.crossUser,approval:r.approval,revocation:r.revocation,hotRefresh:r.hotReconnect?.refreshResponses,reload:r.reloadRefresh});sockets.forEach(s=>s.close());await pool.end();await browser.close();}
