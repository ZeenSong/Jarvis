import {test,expect} from '@playwright/test';
import {fork,type ChildProcess} from 'node:child_process';
let child:ChildProcess,base:string,login:{username:string;password:string};
test.beforeAll(async()=>{child=fork('tests/web-server.ts',[],{execArgv:['--import','tsx'],stdio:['ignore','ignore','pipe','ipc']});const value:any=await new Promise((resolve,reject)=>{child.once('message',resolve);child.once('exit',code=>reject(Error(String(code))));});base=value.base;login=value.login;});
test.afterAll(async()=>{if(child?.connected){child.send('stop');await new Promise(r=>child.once('exit',r));}});
test('expired access reconnect refreshes once and revoked session cannot reconnect',async({page,context})=>{
 await page.addInitScript(()=>{const Native=WebSocket;(window as any).__sockets=[];(window as any).WebSocket=class extends Native{constructor(...args:ConstructorParameters<typeof WebSocket>){super(...args);(window as any).__sockets.push(this)}};});
 await page.goto(base);await page.getByRole('button',{name:'使用用户名密码'}).click();await page.getByLabel('用户名',{exact:true}).fill(login.username);await page.getByLabel('密码',{exact:true}).fill(login.password);await page.getByRole('button',{name:'登录',exact:true}).click();await expect(page.getByText('已连接',{exact:true})).toBeVisible();
 let refresh=0;page.on('request',r=>{if(r.url().endsWith('/api/v2/auth/refresh'))refresh++});
 await context.clearCookies({name:'jarvis_access'});await page.evaluate(()=>{for(const ws of (window as any).__sockets)ws.close()});
 await expect.poll(()=>refresh).toBe(1);await expect(page.getByText('已连接',{exact:true})).toBeVisible();
 const me=await page.request.get(base+'/api/v2/auth/me');expect(me.status()).toBe(200);const session=(await me.json()).session_id;
 const revoke=await page.request.delete(base+'/api/v2/auth/sessions/'+session,{headers:{Origin:base}});expect(revoke.status()).toBe(200);
 await expect(page.getByRole('heading',{name:'连接 Jarvis'})).toBeVisible();await page.waitForTimeout(1500);expect(refresh).toBe(1);
});
