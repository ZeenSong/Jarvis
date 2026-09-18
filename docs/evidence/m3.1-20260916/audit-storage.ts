import pg from 'pg';
import {randomBytes} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {IntegrationCredentialStore} from '../../../apps/server/src/integration-credentials.js';
const db=new pg.Pool({connectionString:'postgres://postgres@127.0.0.1:55439/jarvis_audit'});
const r:any={time:new Date().toISOString(),scope:'isolated PostgreSQL only'};
try{
 process.env.INTEGRATION_CREDENTIAL_KEY=randomBytes(32).toString('base64url');
 const users=(await db.query('SELECT id,username FROM users ORDER BY created_at')).rows;
 const user=users.find(u=>u.username==='m31-audit');const owner=`user-${user.id}`;
 const store=new IntegrationCredentialStore(db as any);
 const item=await store.put(owner,{provider:'m31-audit',label:'acceptance fixture',secret:'fixture-only-not-a-real-secret'});
 const stored=(await db.query('SELECT secret_ciphertext FROM integration_credentials WHERE id=$1',[item.id])).rows[0];
 r.encryptedAtRest=!stored.secret_ciphertext.includes('fixture-only');r.roundTrip=await store.readSecret(owner,item.id)==='fixture-only-not-a-real-secret';r.publicFields=Object.keys(item);
 r.passwordHashAlgorithm=(await db.query('SELECT password_hash FROM user_credentials WHERE user_id=$1',[user.id])).rows[0].password_hash.split('$')[1];
 const member=users.find(u=>u.username.startsWith('m31-member-'));r.otherUserCredentialList=await store.list(`user-${member.id}`);
 await store.revoke(owner,item.id);try{await store.readSecret(owner,item.id);r.revokedReadDenied=false;}catch{r.revokedReadDenied=true;}
}finally{await db.end();await writeFile('docs/evidence/m3.1-20260916/storage-results.json',JSON.stringify(r,null,2));console.log(r);}
