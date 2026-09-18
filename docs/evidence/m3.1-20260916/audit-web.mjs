import { chromium } from 'playwright';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
const dir='docs/evidence/m3.1-20260916';
const base='http://127.0.0.1:55440';
const report={time:new Date().toISOString(),mode:'current source, isolated PostgreSQL, seeded Markdown fixture',checks:{},errors:[]};
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
const context=await browser.newContext({viewport:{width:1440,height:1000}});
const page=await context.newPage();
page.on('pageerror',e=>report.errors.push(e.message));
const shot=async name=>page.screenshot({path:`${dir}/${name}.png`,fullPage:true});
async function login(p){ await p.goto(base); await p.getByRole('button',{name:'使用用户名密码',exact:true}).click(); await p.getByLabel('用户名',{exact:true}).fill('m31-audit'); await p.getByLabel('密码',{exact:true}).fill('M31-Audit-Only-20260916'); await p.getByRole('button',{name:'登录',exact:true}).click(); await p.getByRole('heading',{name:'让科技，回归生活。'}).waitFor(); }
const rpc=async(p,topic,payload={})=>{const r=await p.request.post(`${base}/api/v2/${topic}`,{data:payload});return {status:r.status(),body:await r.json()};};
try{
 await login(page); report.checks.password_login=true; await shot('01-web-login-home');
 await page.locator('nav').getByRole('button',{name:'Jarvis',exact:true}).click();
 await page.getByRole('button',{name:'M3.1 渲染验收样本',exact:true}).first().click();
 await page.locator('.message.jarvis table').waitFor(); await shot('02-web-markdown');
 report.checks.markdown=await page.locator('.message.jarvis').evaluate(e=>({text:e.innerText,headings:e.querySelectorAll('h1').length,code:e.querySelectorAll('pre code').length,tables:e.querySelectorAll('table').length,links:e.querySelectorAll('a').length,strong:e.querySelectorAll('strong').length,em:e.querySelectorAll('em').length,lists:e.querySelectorAll('ul,ol').length,quotes:e.querySelectorAll('blockquote').length}));
 await page.getByRole('button',{name:'查看图表',exact:true}).click();
 await page.getByRole('region',{name:'持久化工作区'}).waitFor(); await shot('03-web-workspace-layout');
 report.checks.canvas={visibleChat:await page.locator('.chat').count(),workspace:await page.locator('.workspace-panel').count()};
 await page.getByRole('button',{name:'＋ 新建',exact:true}).click();
 await page.waitForTimeout(500); await shot('04-web-create-crash');
 report.checks.create_blank_page=!(await page.locator('.workspace-panel').count());
 if(report.checks.create_blank_page){
  await page.reload(); await page.locator('nav').getByRole('button',{name:'Jarvis',exact:true}).click();
  await page.getByRole('button',{name:'M3.1 渲染验收样本',exact:true}).first().click();
  await page.getByRole('button',{name:'查看图表',exact:true}).click();
  await page.locator('.workspace-picker button').first().click();
 }
 await page.getByLabel('Artifact 源码').waitFor();
 await page.getByLabel('Artifact 源码').fill('<h1>M31 Artifact Version 1</h1>');
 report.checks.create_save_enabled=await page.getByRole('button',{name:'保存 Artifact'}).isEnabled();
 await page.getByRole('button',{name:'保存 Artifact'}).click();
 await page.waitForTimeout(700); await shot('04-web-create-save-noop');
 report.checks.after_create_save={iframes:await page.locator('iframe').count(),picker:await page.locator('.workspace-picker').innerText()};
 await page.locator('.workspace-picker button').last().click();
 await page.getByRole('button',{name:'保存 Artifact'}).click();
 await page.frameLocator('iframe').getByText('M31 Artifact Version 1').waitFor();
 await shot('05-web-artifact-after-reselect');
 const workspaces=await rpc(page,'workspace.list'); const ws=workspaces.body[0];
 report.checks.workspace_initial=await rpc(page,'workspace.get',{workspace_id:ws.id});
 await page.getByLabel('Artifact 源码').fill('<h1>M31 Artifact Version 2</h1>'); await page.getByRole('button',{name:'保存 Artifact'}).click();
 await page.frameLocator('iframe').getByText('M31 Artifact Version 2').waitFor();
 report.checks.workspace_updated=await rpc(page,'workspace.get',{workspace_id:ws.id});
 await shot('06-web-artifact-revision');
 if(await page.locator('.workspace-picker button').count()>1){await page.locator('.workspace-picker button').last().click();report.checks.second_workspace_source=await page.getByLabel('Artifact 源码').inputValue();await shot('07-web-source-leaks-to-next-workspace');}
 // A separate browser process with a persistent profile proves browser restart.
 const profile=await mkdtemp(join(tmpdir(),'jarvis-m31-audit-browser-'));
 let persistent=await chromium.launchPersistentContext(profile,{headless:true,executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']});
 await login(persistent.pages()[0]); await persistent.close();
 persistent=await chromium.launchPersistentContext(profile,{headless:true,executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']});
 await persistent.pages()[0].goto(base); await persistent.pages()[0].getByRole('heading',{name:'让科技，回归生活。'}).waitFor(); report.checks.browser_process_restart=true; await persistent.close();
 const second=await browser.newContext();const p2=await second.newPage(); await login(p2);
 const me=await (await p2.request.get(`${base}/api/v2/auth/me`)).json();
 await page.getByRole('button',{name:/^待处理/}).click(); await page.getByRole('heading',{name:'已登录设备'}).waitFor(); await shot('08-web-sessions');
 report.checks.sessions_same_device=await page.locator('.session-list').innerText();
 // Revoke the newly logged in session through the actual UI.
 await page.locator('.session-item').first().getByRole('button',{name:'撤销',exact:true}).click();
 report.checks.revoked_session_http=(await p2.request.get(`${base}/api/v2/auth/me`)).status();
 await p2.locator('nav').getByRole('button',{name:'Jarvis',exact:true}).click();
 await p2.getByLabel('消息',{exact:true}).fill('CPU 现在多少？'); await p2.getByRole('button',{name:'发送 ↑'}).click();
 await p2.waitForTimeout(2000);
 report.checks.revoked_socket_still_operates=await p2.locator('.message.jarvis').innerText().catch(()=> 'no reply');
 await p2.screenshot({path:`${dir}/09-web-revoked-session-still-active.png`,fullPage:true});
 await second.close();
 // Expiry accelerated in the isolated DB; reconnect is exercised without reload.
 const pool=new pg.Pool({connectionString:'postgres://postgres@127.0.0.1:55439/jarvis_audit'});
 const own=await (await page.request.get(`${base}/api/v2/auth/me`)).json();
 await pool.query("UPDATE user_sessions SET last_seen_at=now()-interval '16 minutes' WHERE id=$1",[own.session_id]);
 await context.setOffline(true);await page.waitForTimeout(500);await context.setOffline(false);await page.waitForTimeout(6000);
 report.checks.expired_access_http=(await page.request.get(`${base}/api/v2/session`)).status();
 report.checks.expired_access_ui=await page.locator('body').innerText(); await shot('10-web-expired-reconnect');
 await page.reload();await page.getByRole('heading',{name:'让科技，回归生活。'}).waitFor({timeout:10000}).catch(()=>{});
 report.checks.refresh_after_reload=(await page.request.get(`${base}/api/v2/auth/me`)).status();
 await pool.end();
}catch(e){report.fatal=String(e);await shot('web-fatal').catch(()=>{});}
finally{await writeFile(`${dir}/web-results.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({checks:Object.keys(report.checks),errors:report.errors,fatal:report.fatal}));await browser.close();}
