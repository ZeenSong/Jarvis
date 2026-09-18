import {buildApp} from '../../../apps/server/src/app.js';
import {createPairingCode} from '../../../apps/server/src/auth.js';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
// Deterministic local provider ONLY for UI/authorization tests, not model acceptance.
const stub=createServer((req,res)=>{if(req.url==='/health'){res.end('{}');return;}let raw='';req.on('data',d=>raw+=d);req.on('end',()=>{const input=JSON.parse(raw);const text=input.messages.at(-1).content.includes('M311_EMPTY_PROVIDER')?'':'ISOLATED_FIXTURE_REPLY '+input.messages.at(-1).content;res.writeHead(200,{'Content-Type':'text/event-stream'});res.write(`data: ${JSON.stringify({choices:[{delta:{content:text}}]})}\n\n`);res.end('data: [DONE]\n\n');});});
await new Promise<void>(r=>stub.listen(55451,'127.0.0.1',r));
Object.assign(process.env,{HERMES_ENABLED:'1',HERMES_URL:'http://127.0.0.1:55451',HERMES_API_KEY:'fixture',HERMES_BRIDGE_KEY:'isolated-review-fixture-key'});
const ctx=await buildApp({databaseUrl:'postgres://postgres@127.0.0.1:55449/jarvis_review'});
if(!(await ctx.db.query('SELECT 1 FROM users LIMIT 1')).rowCount){
const device=randomUUID();const pair=await ctx.app.inject({method:'POST',url:'/api/v1/pair',payload:{device_id:device,code:await createPairingCode(ctx.db)}});
await ctx.app.inject({method:'POST',url:'/api/v2/auth/bootstrap',headers:{authorization:`Bearer ${pair.json().token}`},payload:{username:'review-admin',password:'M311-Local-Fixture-Only'}});
const user=(await ctx.db.query("SELECT id FROM users WHERE username='review-admin'")).rows[0];
const c:any=await ctx.m2.handle('conversation.create',{title:'M311 Markdown fixture'},device);const v:any=await ctx.m2.handle('view.show',{type:'view.show',intent:'system_overview',resources:[]},device);
await ctx.db.query("INSERT INTO conversation_messages(id,conversation_id,owner_device_id,owner_user_id,role,content,status,view_id) VALUES($1,$2,$3,$4,'jarvis',$5,'completed',$6)",[randomUUID(),c.id,device,user.id,'# Markdown\n**粗体** 与 *斜体*\n- 列表\n> 引用\n```js\nconsole.log(1)\n```\n| 项目 | 结果 |\n| --- | --- |\n| M311 | 待检 |\n[链接](https://example.com)',v.id]);
}
await ctx.app.listen({host:'0.0.0.0',port:55450});console.log('REVIEW_READY 55450');
process.on('SIGTERM',()=>void ctx.app.close().then(()=>stub.close(()=>process.exit(0))));
