import {execFileSync} from 'node:child_process';import{writeFileSync}from'node:fs';
const run=(...a)=>execFileSync('.local/android-sdk/platform-tools/adb',['-s','emulator-5554',...a],{timeout:30000});
const[mode,arg]=process.argv.slice(2);run('shell','uiautomator','dump','/sdcard/m311-window.xml');const xml=run('shell','cat','/sdcard/m311-window.xml').toString();const nodes=[...xml.matchAll(/<node[^>]*text="([^"]+)"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/g)];
if(mode==='snapshot'){writeFileSync(`docs/evidence/m3.11-20260916/${arg}.xml`,xml);writeFileSync(`docs/evidence/m3.11-20260916/${arg}.png`,run('exec-out','screencap','-p'));console.log(nodes.map(m=>({text:m[1],bounds:m.slice(2,6)})));}
if(mode==='tap'){const m=nodes.find(n=>n[1]===arg);if(!m)throw Error('Not visible: '+arg);run('shell','input','tap',String(Math.round((+m[2]+ +m[4])/2)),String(Math.round((+m[3]+ +m[5])/2)));}
