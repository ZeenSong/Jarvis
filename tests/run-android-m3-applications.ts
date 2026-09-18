import { execFileSync, execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { buildApp } from "../apps/server/src/app.js";
import { createPairingCode } from "../apps/server/src/auth.js";
import { controlledRegistry } from "./controlled-runtime.js";

if (!process.env.TEST_DATABASE_URL || !process.env.CASAOS_SESSION_FILE) throw Error("Explicit test database and CasaOS session required");
const adb=process.env.ADB ?? ".local/android-sdk/platform-tools/adb";
const serial=process.env.ANDROID_TEST_SERIAL ?? "emulator-5554";
if (!/^emulator-\d+$/.test(serial)) throw Error("This runner only clears dedicated emulator test state");
const run=(args:string[])=>execFileSync(adb,["-s",serial,...args],{timeout:30000});
const runAsync=(args:string[])=>new Promise<string>((resolve,reject)=>execFile(adb,["-s",serial,...args],{encoding:"utf8",timeout:30000},(error,stdout)=>error?reject(error):resolve(stdout)));
const waitForOnline=async()=>{
  const deadline=Date.now()+60000;
  while(Date.now()<deadline){
    try {
      await runAsync(["shell","uiautomator","dump","/sdcard/jarvis-m3-recovery.xml"]);
      const xml=await runAsync(["shell","cat","/sdcard/jarvis-m3-recovery.xml"]);
      if(xml.includes("已连接")) return xml;
    } catch {}
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  throw Error("Android app did not restore an authenticated connection");
};
const ctx=await buildApp({databaseUrl:process.env.TEST_DATABASE_URL,runtimes:controlledRegistry()});
try {
  await ctx.app.listen({host:"127.0.0.1",port:0});
  const port=(ctx.app.server.address() as {port:number}).port;
  run(["install","-r","apps/android/app/build/outputs/apk/debug/app-debug.apk"]);
  run(["install","-r","apps/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk"]);
  run(["shell","pm","clear","cloud.jarvis.app"]);
  const code=await createPairingCode(ctx.db);
  const result=await new Promise<string>((resolve,reject)=>execFile(adb,["-s",serial,"shell","am","instrument","-w","-r","-e","class","cloud.jarvis.app.M3ApplicationsEndToEndTest","-e","server",`http://10.0.2.2:${port}`,"-e","pairingCode",code,"cloud.jarvis.app.test/androidx.test.runner.AndroidJUnitRunner"],{timeout:120000},(err,out)=>err?reject(Error("Android instrumentation command failed")):resolve(out)));
  console.log(result);
  await writeFile(".local/evidence/m3-android-live-applications.txt",result);
  if(!result.includes("OK (1 test)")) throw Error("Android live applications verification failed");
  await writeFile(".local/evidence/m3-android-live-app-detail.png",run(["exec-out","run-as","cloud.jarvis.app","cat","files/m3-live-app-detail.png"]));
  await writeFile(".local/evidence/m3-android-live-home.png",run(["exec-out","run-as","cloud.jarvis.app","cat","files/m3-live-home.png"]));
  // Identity acceptance: credentials must survive a process kill and an
  // overlay install of the next APK without showing the pairing screen.
  run(["shell","am","force-stop","cloud.jarvis.app"]);
  run(["shell","am","start","-W","-n","cloud.jarvis.app/.MainActivity"]);
  let xml=await waitForOnline();
  if(xml.includes("配对并连接")) throw Error("Pairing screen returned after process restart");
  run(["install","-r","apps/android/app/build/outputs/apk/debug/app-debug.apk"]);
  run(["shell","am","start","-W","-n","cloud.jarvis.app/.MainActivity"]);
  xml=await waitForOnline();
  if(xml.includes("配对并连接")) throw Error("Pairing screen returned after overlay update");
  await writeFile(".local/evidence/m3-android-identity-recovery.txt",xml);
} finally { await ctx.app.close(); }
