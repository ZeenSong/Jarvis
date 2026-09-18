import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const adb='.local/android-sdk/platform-tools/adb';
const run=(...args)=>execFileSync(adb,['-s','emulator-5554',...args],{timeout:30000});
const [mode,arg]=process.argv.slice(2);
function xml(){run('shell','uiautomator','dump','/sdcard/m31-window.xml');return run('shell','cat','/sdcard/m31-window.xml').toString();}
if(mode==='snapshot'){
 const x=xml();writeFileSync(`docs/evidence/m3.1-20260916/${arg}.xml`,x);
 writeFileSync(`docs/evidence/m3.1-20260916/${arg}.png`,run('exec-out','screencap','-p'));
 console.log([...x.matchAll(/<node[^>]*text="([^"]+)"[^>]*bounds="([^"]+)"/g)].map(m=>[m[1],m[2]]));
}else if(mode==='tap'){
 const x=xml(),m=[...x.matchAll(/<node[^>]*text="([^"]+)"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/g)].find(m=>m[1]===arg);
 if(!m)throw Error(`text not visible: ${arg}`);
 run('shell','input','tap',String(Math.round((+m[2]+ +m[4])/2)),String(Math.round((+m[3]+ +m[5])/2)));
}
