import {execFileSync} from 'node:child_process';
import {writeFile,readFile,stat} from 'node:fs/promises';
import os from 'node:os';
const dir='docs/evidence/m3.11-20260916',base='http://100.77.157.73:8080';
const cmd=(bin,args)=>execFileSync(bin,args,{encoding:'utf8',timeout:30000});
const k=args=>JSON.parse(cmd('kubectl',['--kubeconfig','.local/m2.kubeconfig',...args,'-o','json']));
const r={time:new Date().toISOString(),host:{uptime:os.uptime(),cpus:os.cpus().length,load:os.loadavg(),totalMemory:os.totalmem(),freeMemory:os.freemem(),disk:cmd('df',['-h','/','/var/lib/docker'])}};
for(const path of ['/health','/health/ready','/']){try{const x=await fetch(base+path,{signal:AbortSignal.timeout(8000)});r[path]={status:x.status,body:path==='/'?'HTML':await x.json()};}catch(e){r[path]={error:String(e)};}}
r.nodes=k(['get','nodes']).items.map(n=>({name:n.metadata.name,version:n.status.nodeInfo.kubeletVersion,conditions:n.status.conditions,allocatable:n.status.allocatable}));
r.pods=k(['-n','jarvis','get','pods']).items.map(p=>({name:p.metadata.name,created:p.metadata.creationTimestamp,phase:p.status.phase,containers:p.status.containerStatuses,resources:p.spec.containers.map(c=>({name:c.name,resources:c.resources,securityContext:c.securityContext})),hostNetwork:p.spec.hostNetwork}));
r.services=k(['-n','jarvis','get','svc']).items.map(s=>({name:s.metadata.name,spec:s.spec}));
r.pvcs=k(['-n','jarvis','get','pvc']).items.map(s=>({name:s.metadata.name,phase:s.status.phase,capacity:s.status.capacity,storageClass:s.spec.storageClassName}));
r.networkPolicies=k(['-n','jarvis','get','networkpolicy']).items.map(s=>({name:s.metadata.name,spec:s.spec}));
r.cronjobs=k(['get','cronjobs','-A']).items.map(s=>({namespace:s.metadata.namespace,name:s.metadata.name,schedule:s.spec.schedule}));
r.metrics=cmd('kubectl',['--kubeconfig','.local/m2.kubeconfig','top','pods','-n','jarvis']);
r.docker=cmd('docker',['ps','--format','{{.Names}}\t{{.Status}}\t{{.Ports}}']);
const node=JSON.parse(cmd('docker',['inspect','jarvis-node-bridge-m31']))[0];r.nodeContainer={image:node.Config.Image,user:node.Config.User,network:node.HostConfig.NetworkMode,privileged:node.HostConfig.Privileged,readOnlyRoot:node.HostConfig.ReadonlyRootfs,capDrop:node.HostConfig.CapDrop,mounts:node.Mounts.map(m=>({source:m.Source,destination:m.Destination,rw:m.RW}))};
r.nodeRuntime=JSON.parse(cmd('docker',['exec','jarvis-node-bridge-m31','node','--input-type=module','-e','console.log(JSON.stringify({health:await(await fetch("http://127.0.0.1:8790/health")).json(),capabilities:await(await fetch("http://127.0.0.1:8790/capabilities")).json()}))']));
r.backups=[];for(const p of ['.local/m3.1-backup-20260915-171853/postgres.dump.verified.json','.local/m2-last-backup']){try{const s=await stat(p);const content=await readFile(p,'utf8');r.backups.push({path:p,modified:s.mtime,content:p.endsWith('.json')?JSON.parse(content):content.trim()});}catch(e){r.backups.push({path:p,error:String(e)});}}
r.timers=cmd('systemctl',['list-timers','--all','--no-pager']).split('\n').filter(s=>/jarvis|backup/i.test(s));
try{await fetch('http://100.77.157.73:8642/health',{signal:AbortSignal.timeout(3000)});r.hermesDirect='reachable';}catch(e){r.hermesDirect=e.cause?.code??e.message;}
await writeFile(`${dir}/system-status.json`,JSON.stringify(r,null,2));console.log({time:r.time,pods:r.pods.map(p=>p.name),metrics:r.metrics,node:r.nodeRuntime,backupCount:r.backups.length});
