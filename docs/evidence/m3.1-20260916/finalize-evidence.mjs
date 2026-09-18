import {readFile,writeFile,readdir,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const dir='docs/evidence/m3.1-20260916';
const sources={
 'apps/server/src/app.ts':[[295,345],[483,555]],
 'apps/server/src/identity.ts':[[45,95]],
 'apps/server/src/workspaces.ts':[[28,100]],
 'apps/server/src/m2.ts':[[428,489]],
 'apps/server/src/main.ts':[[14,32]],
 'apps/web/src/main.tsx':[[28,52],[188,194],[429,465],[520,542]],
 'apps/web/src/workspace-panel.tsx':[[1,49]],
 'apps/android/app/src/main/java/cloud/jarvis/app/ConversationScreen.kt':[[16,58]],
 'apps/android/app/src/main/java/cloud/jarvis/app/MainActivity.kt':[[72,88]],
 'apps/android/app/src/main/java/cloud/jarvis/app/M2Repository.kt':[[78,80]],
 'packages/conversation/src/index.ts':[[236,250],[270,347]],
 'packages/hermes-runtime/src/index.ts':[[1,82]],
 'packages/workspace-artifact/src/index.ts':[[1,30]],
 'apps/node-bridge/src/main.mjs':[[8,45]],
 'deploy/k8s/hermes.yaml':[[1,100]],
};
const fingerprint={time:new Date().toISOString(),head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),files:{}};let excerpts='Current worktree source excerpts; line numbers preserved.\n';
for(const [path,ranges]of Object.entries(sources)){const data=await readFile(path);fingerprint.files[path]=createHash('sha256').update(data).digest('hex');const lines=data.toString().split('\n');excerpts+=`\nFILE ${path}\n`;for(const[a,b]of ranges)excerpts+=lines.slice(a-1,b).map((s,i)=>`${a+i}: ${s}`).join('\n')+'\n';}
await writeFile(`${dir}/source-review.txt`,excerpts);await writeFile(`${dir}/source-fingerprints.json`,JSON.stringify(fingerprint,null,2));
const manifest={generatedAt:new Date().toISOString(),files:[]};for(const file of(await readdir(dir)).sort()){if(file==='manifest.json')continue;const path=`${dir}/${file}`;if(!(await stat(path)).isFile())continue;const data=await readFile(path);manifest.files.push({file,bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')});}await writeFile(`${dir}/manifest.json`,JSON.stringify(manifest,null,2));console.log({files:manifest.files.length,png:manifest.files.filter(f=>f.file.endsWith('.png')).length});
