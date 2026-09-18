import { chromium } from 'playwright';
import {writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
const dir='docs/evidence/m3.1-20260916',base='http://100.77.157.73:8080';
const b=await chromium.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']});const c=await b.newContext({storageState:'.local/m3-release-0.3.0-preview.1/browser-private.json',viewport:{width:1440,height:1000}}),p=await c.newPage();
const r={time:new Date().toISOString()};
r.appSocket=[];p.on('websocket',ws=>ws.on('framereceived',f=>{try{const m=JSON.parse(f.payload);if(m.topic==='app.resolve')r.appSocket.push(m);}catch{}}));
try{
 await p.goto(base);await p.getByRole('heading',{name:'让科技，回归生活。'}).waitFor();
 for(const topic of ['agent.definition.list','runtime.health','capability.list']){const response=await p.request.post(`${base}/api/v2/${topic}`,{headers:{Origin:base},data:{}});const body=await response.json();r[topic]={status:response.status(),body:topic==='agent.definition.list'?{definitions:body.definitions,instanceCount:body.instances?.length,runCount:body.runs?.length}:body};}
 r.appLinks=[];
 for(const app_id of ['immich','home-assistant'])for(const platform of ['web','android']){const response=await p.request.post(`${base}/api/v2/app.resolve`,{headers:{Origin:base},data:{app_id,platform,kind:app_id==='immich'?'album':'entity',id:'m31-audit'}});r.appLinks.push({app_id,platform,status:response.status(),body:await response.json()});}
 await p.locator('nav').getByRole('button',{name:'应用',exact:true}).click();await p.getByRole('button',{name:'查看 Immich 详情',exact:true}).click();await p.getByRole('dialog').getByRole('button',{name:/在应用中打开/}).click();await p.waitForTimeout(700);await p.keyboard.press('Escape');await p.screenshot({path:`${dir}/19-live-app-open-failure.png`,fullPage:true});r.appAfterClick=await p.locator('body').innerText();
 const k=args=>execFileSync('kubectl',['--kubeconfig','.local/m2.kubeconfig','-n','jarvis',...args],{encoding:'utf8'});
 r.pods=JSON.parse(k(['get','pods','-o','json'])).items.map(p=>({name:p.metadata.name,phase:p.status.phase,containers:p.status.containerStatuses?.map(c=>({name:c.name,ready:c.ready,restarts:c.restartCount,lastState:c.lastState,image:c.image,imageID:c.imageID}))}));
 r.hermesService=JSON.parse(k(['get','svc','hermes-core','-o','json'])).spec;
 r.hermesNetworkPolicy=JSON.parse(k(['get','networkpolicy','hermes-private','-o','json'])).spec;
 const dep=JSON.parse(k(['get','deployment','hermes-core','-o','json']));r.hermesEnvNames=dep.spec.template.spec.containers[0].env.map(e=>e.name);r.hermesServiceAccountToken=dep.spec.template.spec.automountServiceAccountToken;
 r.hermesPrivatePort=await fetch('http://100.77.157.73:8642/health',{signal:AbortSignal.timeout(3000)}).then(x=>({status:x.status})).catch(e=>({error:e.cause?.code??e.message}));
 r.node=JSON.parse(execFileSync('docker',['exec','jarvis-node-bridge-m31','node','--input-type=module','-e','console.log(JSON.stringify({health:await (await fetch("http://127.0.0.1:8790/health")).json(),capabilities:await (await fetch("http://127.0.0.1:8790/capabilities")).json(),unauthorizedExecute:(await fetch("http://127.0.0.1:8790/execute",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({capability:"node.system.read"})})).status}))'],{encoding:'utf8'}));
 const nodeInvoke=await p.request.post(`${base}/api/v2/node.invoke`,{headers:{Origin:base},data:{node_id:'ubuntu-m31',capability:'node.codex.execute',input:{args:['--version']}}});
 r.nodeCodexProbe={status:nodeInvoke.status(),body:await nodeInvoke.json()};
}catch(e){r.error=String(e);}finally{await writeFile(`${dir}/live-status.json`,JSON.stringify(r,null,2));console.log(JSON.stringify({error:r.error,appLinks:r.appLinks,node:r.node,runtimes:r['runtime.health']}));await b.close();}
