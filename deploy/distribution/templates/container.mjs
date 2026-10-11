// Untested Docker template; host mapping must explicitly bind 127.0.0.1.
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
const data=resolve(process.env.RCM_DATA_DIR||'/data');mkdirSync(data,{recursive:true});
const file=resolve(data,'connection.json');
if(!existsSync(file))writeFileSync(file,JSON.stringify({serverUrl:'http://127.0.0.1:7331',token:randomBytes(32).toString('hex')},null,2),{flag:'wx',mode:0o600});
const {token}=JSON.parse(readFileSync(file,'utf8'));
if(typeof token!=='string'||token.length<32)throw new Error('Invalid token');
Object.assign(process.env,{RCM_HOST:'0.0.0.0',RCM_PORT:'7331',RCM_TOKEN:token,RCM_DB_PATH:resolve(data,'memory.db'),RCM_SECRETS_PATH:resolve(data,'secrets.env'),RCM_RETRIEVAL_TRACE:'off'});
await import('./server.mjs');
