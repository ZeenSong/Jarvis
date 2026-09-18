import { chromium } from 'playwright';
import {writeFile} from 'node:fs/promises';
const dir='docs/evidence/m3.1-20260916',base='http://127.0.0.1:55440';
const b=await chromium.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']});const c=await b.newContext({viewport:{width:1440,height:1000}}),p=await c.newPage();const r={time:new Date().toISOString()};
const call=async(topic,data)=>{const response=await p.request.post(`${base}/api/v2/${topic}`,{data});return {status:response.status(),body:await response.json()};};
try{
 await p.request.post(`${base}/api/v2/auth/login`,{data:{username:'m31-audit',password:'M31-Audit-Only-20260916'}});
 const cs=await call('conversation.list',{}),conversation=cs.body.find(x=>x.title==='M3.1 渲染验收样本');
 const ws=await call('workspace.create',{conversation_id:conversation.id,title:'M31 Sandbox Probe',type:'web'});
 r.rejectNetwork=await call('workspace.artifact.upsert',{workspace_id:ws.body.id,type:'html',media_type:'text/html',source:'<script>fetch("/api/v2/session")</script>'});
 const source='<h1>M31 Sandbox Probe</h1><p id="result">pending</p><script>globalThis["fet"+"ch"]("/api/v2/session").then(r=>document.getElementById("result").textContent="ALLOWED "+r.status).catch(e=>document.getElementById("result").textContent="BLOCKED: "+e.name);try {document.body.dataset.parentAccess=String(parent.document.body);}catch(e){document.body.dataset.parentAccess="BLOCKED: "+e.name;}</script>';
 r.indirectSourceAccepted=await call('workspace.artifact.upsert',{workspace_id:ws.body.id,type:'html',media_type:'text/html',source,compiled:source,status:'ready'});
 await p.goto(base);await p.locator('nav').getByRole('button',{name:'Jarvis',exact:true}).click();await p.getByRole('button',{name:'M3.1 渲染验收样本',exact:true}).first().click();await p.getByRole('button',{name:'查看图表',exact:true}).click();await p.getByRole('button',{name:/M31 Sandbox Probe/}).first().click();await p.frameLocator('iframe').getByText('BLOCKED: TypeError').waitFor();
 r.browser=await p.frameLocator('iframe').locator('body').evaluate(e=>({text:e.innerText,parentAccess:e.dataset.parentAccess}));await p.screenshot({path:`${dir}/30-web-sandbox-network-denied.png`,fullPage:true});
 r.missingCredentialKey=await call('integration.credential.put',{provider:'m31-test',label:'non-secret test',secret:'fixture-only'});
 const inv=await p.request.post(`${base}/api/v2/auth/invites`,{data:{username:`m31-member-${Date.now()}`}});const invitation=await inv.json();
 const c2=await b.newContext(),p2=await c2.newPage();await p2.request.post(`${base}/api/v2/auth/invites/accept`,{data:{token:invitation.token,password:'M31-Member-Only-20260916'}});await p2.request.post(`${base}/api/v2/auth/login`,{data:{username:invitation.username,password:'M31-Member-Only-20260916'}});
 const denied=await p2.request.post(`${base}/api/v2/workspace.get`,{data:{workspace_id:ws.body.id}});r.otherUserWorkspace={status:denied.status(),body:await denied.json()};
 r.otherUserConversations=await(await p2.request.post(`${base}/api/v2/conversation.list`,{data:{}})).json();
 r.noSuchNode=await call('node.invoke',{node_id:'not-owned-audit',capability:'node.file.read',input:{path:'../outside'}});
}catch(e){r.error=String(e);}finally{await writeFile(`${dir}/security-results.json`,JSON.stringify(r,null,2));console.log(r);await b.close();}
