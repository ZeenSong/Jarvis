import {chromium} from 'playwright';
import pg from 'pg';
import {writeFile} from 'node:fs/promises';
const dir='docs/evidence/m3.1-20260916',base='http://127.0.0.1:55440';
const b=await chromium.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']});
const pool=new pg.Pool({connectionString:'postgres://postgres@127.0.0.1:55439/jarvis_audit'});
const results={time:new Date().toISOString(),steps:[]};
async function login(){const ctx=await b.newContext({viewport:{width:1440,height:1000}});const p=await ctx.newPage();await p.goto(base);await p.getByRole('button',{name:'使用用户名密码',exact:true}).click();await p.getByLabel('用户名',{exact:true}).fill('m31-audit');await p.getByLabel('密码',{exact:true}).fill('M31-Audit-Only-20260916');await p.getByRole('button',{name:'登录',exact:true}).click();await p.getByRole('heading',{name:'让科技，回归生活。'}).waitFor();return {ctx,p,me:await(await p.request.get(`${base}/api/v2/auth/me`)).json()};}
try{
 const admin=await login(),victim=await login();
 await admin.p.getByRole('button',{name:/^待处理/}).click();await admin.p.locator('.session-item').first().waitFor();
 const sessions=await(await admin.p.request.get(`${base}/api/v2/auth/sessions`)).json();const idx=sessions.findIndex(s=>s.id===victim.me.session_id);
 await admin.p.locator('.session-item').nth(idx).getByRole('button',{name:'撤销',exact:true}).click();
 await admin.p.waitForTimeout(500);
 results.steps.push({step:'revoke exact victim via session-list UI',index:idx,httpAfterRevoke:(await victim.p.request.get(`${base}/api/v2/auth/me`)).status()});
 await victim.p.locator('nav').getByRole('button',{name:'Jarvis',exact:true}).click();await victim.p.getByLabel('消息',{exact:true}).fill('CPU 现在多少？');await victim.p.getByRole('button',{name:'发送 ↑'}).click();await victim.p.waitForTimeout(2500);
 results.steps.push({step:'send after revocation on pre-existing websocket',reply:await victim.p.locator('.message.jarvis').innerText().catch(()=> 'missing')});await victim.p.screenshot({path:`${dir}/17-web-revocation-confirmed.png`,fullPage:true});
 const expiry=await login();let refreshResponses=[];
 expiry.p.on('response',r=>{if(r.url().includes('/auth/refresh'))refreshResponses.push(r.status());});
 await pool.query("UPDATE user_sessions SET last_seen_at=now()-interval '16 minutes' WHERE id=$1",[expiry.me.session_id]);
 await expiry.ctx.clearCookies({name:'jarvis_access'});
 await expiry.p.reload();await expiry.p.waitForTimeout(2000);
 results.steps.push({step:'expired access -> page reload, refresh cookie retained',refreshResponses,loginVisible:await expiry.p.getByRole('button',{name:'配对并连接',exact:true}).count(),meStatus:(await expiry.p.request.get(`${base}/api/v2/auth/me`)).status()});
 await expiry.p.screenshot({path:`${dir}/18-web-refresh-fails.png`,fullPage:true});
 const refresh=(await expiry.ctx.cookies()).find(c=>c.name==='jarvis_refresh')?.value;
 const r=await expiry.p.request.post(`${base}/api/v2/auth/refresh`,{data:{refresh_token:refresh}});
 results.steps.push({step:'same refresh token supplied in JSON body',status:r.status()});
}catch(e){results.error=String(e);}finally{await writeFile(`${dir}/auth-results.json`,JSON.stringify(results,null,2));console.log(results);await pool.end();await b.close();}
