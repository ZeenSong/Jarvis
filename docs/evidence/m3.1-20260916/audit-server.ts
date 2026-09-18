// Isolated acceptance fixture. Never points to the production database.
import { buildApp } from '../../../apps/server/src/app.js';
import { createPairingCode } from '../../../apps/server/src/auth.js';
import { randomUUID } from 'node:crypto';
const databaseUrl = 'postgres://postgres@127.0.0.1:55439/jarvis_audit';
const ctx = await buildApp({ databaseUrl });
if (!(await ctx.db.query('SELECT 1 FROM users LIMIT 1')).rowCount) {
  const device = randomUUID();
  const paired = await ctx.app.inject({ method:'POST',url:'/api/v1/pair',payload:{device_id:device,code:await createPairingCode(ctx.db)} });
  const boot = await ctx.app.inject({method:'POST',url:'/api/v2/auth/bootstrap',headers:{authorization:`Bearer ${paired.json().token}`},payload:{username:'m31-audit',password:'M31-Audit-Only-20260916'}});
  if(boot.statusCode!==200) throw Error('fixture bootstrap failed');
}
if (!(await ctx.db.query('SELECT 1 FROM conversation_messages LIMIT 1')).rowCount) {
  const login = await ctx.app.inject({method:'POST',url:'/api/v2/auth/login',payload:{username:'m31-audit',password:'M31-Audit-Only-20260916'}});
  const owner = `user-${login.json().user.id}`;
  const c:any = await ctx.m2.handle('conversation.create',{title:'M3.1 渲染验收样本'},owner);
  const v:any = await ctx.m2.handle('view.show',{type:'view.show',intent:'system_overview',resources:[]},owner);
  const content = '# M3.1 Markdown\n**粗体** 与 *斜体*\n- 第一项\n- 第二项\n> 引用文字\n\n```js\nconsole.log("M3.1");\n```\n\n| 项目 | 状态 |\n| --- | --- |\n| Workspace | 待验收 |\n\n[测试链接](https://example.com)';
  await ctx.db.query("INSERT INTO conversation_messages(id,conversation_id,owner_device_id,owner_user_id,role,content,status,view_id) VALUES($1,$2,$3,$4,'jarvis',$5,'completed',$6)",[randomUUID(),c.id,owner,login.json().user.id,content,v.id]);
}
await ctx.app.listen({host:'0.0.0.0',port:55440});
console.log('AUDIT_READY http://127.0.0.1:55440 (isolated fixtures; no LLM configured)');
for(const s of ['SIGINT','SIGTERM']) process.on(s,()=>void ctx.app.close().then(()=>process.exit(0)));
