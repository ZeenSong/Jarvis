import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
const dir='docs/evidence/m3.1-20260916',base='http://100.77.157.73:8080';
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
const context=await browser.newContext({viewport:{width:1440,height:1100},storageState:'.local/m3-release-0.3.0-preview.1/browser-private.json'});
const page=await context.newPage(),report={time:new Date().toISOString(),base,events:[],errors:[]};
page.on('pageerror',e=>report.errors.push(e.message));
page.on('websocket',ws=>ws.on('framereceived',frame=>{try{const m=JSON.parse(frame.payload.toString());if(/conversation\.(message.delta|tool|status)/.test(m.topic))report.events.push({time:Date.now(),...m});}catch{}}));
try{
 await page.goto(base);await page.getByRole('heading',{name:'让科技，回归生活。'}).waitFor();
 report.assets=await page.locator('script[src]').evaluateAll(es=>es.map(e=>e.src));
 await page.screenshot({path:`${dir}/11-live-home.png`,fullPage:true});
 await page.locator('nav').getByRole('button',{name:'应用',exact:true}).click();
 await page.getByRole('button',{name:'查看 Immich 详情',exact:true}).click();
 await page.screenshot({path:`${dir}/12-live-app-detail.png`,fullPage:true});
 report.appDialog=await page.getByRole('dialog').innerText();
 const popupPromise=page.waitForEvent('popup',{timeout:10000}).catch(()=>null);
 await page.getByRole('dialog').getByRole('button',{name:/打开/}).click();
 const popup=await popupPromise;if(popup){await popup.waitForLoadState('domcontentloaded').catch(()=>{});report.appOpened=popup.url();await popup.screenshot({path:`${dir}/13-live-immich-opened.png`,fullPage:true});await popup.close();}
 await page.keyboard.press('Escape');await page.locator('nav').getByRole('button',{name:'Jarvis',exact:true}).click();
 await page.getByRole('button',{name:'＋ 新会话',exact:true}).click();
 await page.getByLabel('消息',{exact:true}).fill('M3.1 验收测试：请调用工具读取服务器状态，以 Markdown 二级标题、加粗文字、两列表格和一个只读示例代码块给出简短结果，并展示系统状态图表。请勿修改系统。');
 await page.getByRole('button',{name:'发送 ↑'}).click();
 const until=Date.now()+180000;let intermediate=false;
 while(Date.now()<until){
  const msg=await page.locator('.message.jarvis').last().innerText().catch(()=> '');
  if(!intermediate && report.events.some(e=>e.topic==='conversation.message.delta')){await page.screenshot({path:`${dir}/14-live-streaming.png`,fullPage:true});intermediate=true;}
  if(/已完成|失败/.test(msg)){report.finalMessage=msg;break;}
  await page.waitForTimeout(1000);
 }
 report.finalMessage??=await page.locator('.message.jarvis').last().innerText().catch(()=> 'missing');
 await page.screenshot({path:`${dir}/15-live-conversation.png`,fullPage:true});
 if(await page.getByRole('button',{name:'查看图表',exact:true}).count()){await page.getByRole('button',{name:'查看图表',exact:true}).last().click();await page.screenshot({path:`${dir}/16-live-workspace.png`,fullPage:true});}
 for(const topic of ['agent.definition.list','node.list','capability.list']){const r=await page.request.post(`${base}/api/v2/${topic}`,{headers:{Origin:base},data:{}});report[topic]={status:r.status(),body:await r.json()};}
}catch(e){report.fatal=String(e);await page.screenshot({path:`${dir}/live-fatal.png`,fullPage:true}).catch(()=>{});}
finally{await writeFile(`${dir}/live-results.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({fatal:report.fatal,events:report.events.length,final:report.finalMessage}));await browser.close();}
