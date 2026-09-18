import {chromium} from 'playwright';
import {execFileSync,spawn} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import pg from 'pg';
const dir='docs/evidence/m3.1-20260916',base='http://127.0.0.1:55440';
const adb=(...args)=>execFileSync('.local/android-sdk/platform-tools/adb',['-s','emulator-5554',...args],{timeout:30000});
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const report={time:new Date().toISOString(),scope:'isolated source server + emulator; same APK overlay, not different version',steps:[]};
const b=await chromium.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']}),c=await b.newContext({viewport:{width:1440,height:1000}}),p=await c.newPage();
const pool=new pg.Pool({connectionString:'postgres://postgres@127.0.0.1:55439/jarvis_audit'});let server;
async function androidOnline(name){let xml='';const end=Date.now()+60000;while(Date.now()<end){try{adb('shell','uiautomator','dump','/sdcard/m31-restart.xml');xml=adb('shell','cat','/sdcard/m31-restart.xml').toString();if(xml.includes('text="已连接"'))break;}catch{}await delay(1000);}await writeFile(`${dir}/${name}.xml`,xml);await writeFile(`${dir}/${name}.png`,adb('exec-out','screencap','-p'));const ok=xml.includes('text="已连接"')&&!xml.includes('配对并连接');report.steps.push({step:name,online:ok});console.log(name,ok);return ok;}
try{
 const androidSession=(await pool.query('SELECT id,last_seen_at FROM user_sessions WHERE revoked_at IS NULL ORDER BY created_at DESC LIMIT 1')).rows[0];
 await p.goto(base);await p.getByRole('button',{name:'使用用户名密码',exact:true}).click();await p.getByLabel('用户名',{exact:true}).fill('m31-audit');await p.getByLabel('密码',{exact:true}).fill('M31-Audit-Only-20260916');await p.getByRole('button',{name:'登录',exact:true}).click();await p.getByRole('heading',{name:'让科技，回归生活。'}).waitFor();
 const before=await(await p.request.post(`${base}/api/v2/workspace.list`,{data:{}})).json();
 const pid=Number(process.argv[2]);const cmd=await readFile(`/proc/${pid}/cmdline`,'utf8');if(!cmd.includes('audit-server.ts'))throw Error('Not the isolated audit server');process.kill(pid,'SIGTERM');
 for(let i=0;i<30;i++){try{await fetch(`${base}/health`);await delay(100);}catch{break;}}
 server=spawn(process.execPath,['--import','tsx','docs/evidence/m3.1-20260916/audit-server.ts'],{stdio:['ignore','pipe','pipe']});
 await new Promise((resolve,reject)=>{server.stdout.on('data',x=>{if(String(x).includes('AUDIT_READY'))resolve();});server.once('exit',code=>reject(Error(`server ${code}`)));setTimeout(()=>reject(Error('server readiness timeout')),20000).unref();});
 await p.reload();await p.getByRole('heading',{name:'让科技，回归生活。'}).waitFor();const after=await(await p.request.post(`${base}/api/v2/workspace.list`,{data:{}})).json();
 report.steps.push({step:'server process restart',webSessionStatus:(await p.request.get(`${base}/api/v2/auth/me`)).status(),sameWorkspaceIds:JSON.stringify(before.map(w=>w.id).sort())===JSON.stringify(after.map(w=>w.id).sort()),revisions:after.map(w=>({id:w.id,revision:w.revision,artifacts:w.artifacts.length}))});await p.screenshot({path:`${dir}/31-web-server-restart.png`,fullPage:true});
 if(!(await androidOnline('32-android-server-restart')))throw Error('Android reconnect failed');
 adb('shell','am','force-stop','cloud.jarvis.app');adb('shell','am','start','-W','-n','cloud.jarvis.app/.MainActivity');await androidOnline('33-android-app-restart');
 adb('reboot');for(let i=0;i<60;i++){await delay(1000);try{if(adb('shell','getprop','sys.boot_completed').toString().trim()==='1')break;}catch{}}
 adb('shell','input','keyevent','82');adb('shell','am','start','-W','-n','cloud.jarvis.app/.MainActivity');await androidOnline('34-android-device-reboot');
 report.install=adb('install','-r','apps/android/app/build/outputs/apk/debug/app-debug.apk').toString();adb('shell','am','start','-W','-n','cloud.jarvis.app/.MainActivity');await androidOnline('35-android-apk-overlay');
 await pool.query("UPDATE user_sessions SET last_seen_at=now()-interval '16 minutes' WHERE id=$1",[androidSession.id]);
 adb('shell','am','force-stop','cloud.jarvis.app');adb('shell','am','start','-W','-n','cloud.jarvis.app/.MainActivity');await androidOnline('36-android-access-refresh');
 const refreshed=(await pool.query('SELECT last_seen_at,expires_at FROM user_sessions WHERE id=$1',[androidSession.id])).rows[0];report.steps.push({step:'Android expired access refresh database evidence',lastSeenAdvanced:new Date(refreshed.last_seen_at)>new Date(androidSession.last_seen_at)});
}catch(e){report.error=String(e);}finally{await writeFile(`${dir}/restart-results.json`,JSON.stringify(report,null,2));console.log(report);await pool.end();await b.close();if(server)server.kill('SIGTERM');}
