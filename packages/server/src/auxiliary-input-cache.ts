import { createHash } from 'node:crypto';
import type { RcmDatabase } from './db.js';
export function auxiliaryInputFingerprint(db:RcmDatabase,value:unknown):string {
  const settings=db.prepare("SELECT key,value FROM server_meta WHERE key IN ('server_llm_config','risu_model_settings_fingerprint') ORDER BY key").all();
  return createHash('sha256').update(JSON.stringify([value,settings])).digest('hex');
}
export function auxiliaryInputOutcome(db:RcmDatabase,chatId:string,kind:string,key:string):'succeeded'|'failed'|undefined {
  const row=db.prepare('SELECT value FROM server_meta WHERE key=?').get(`auxiliary_input:${chatId}:${kind}:${key}`) as {value:string}|undefined;
  return row?.value as 'succeeded'|'failed'|undefined;
}
export function recordAuxiliaryInput(db:RcmDatabase,chatId:string,kind:string,key:string,outcome:'succeeded'|'failed'):void {
  db.prepare('INSERT INTO server_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(`auxiliary_input:${chatId}:${kind}:${key}`,outcome);
}
export function clearAuxiliaryInputs(db:RcmDatabase,chatId:string):void {
  const prefix=`auxiliary_input:${chatId}:`;
  db.prepare('DELETE FROM server_meta WHERE substr(key,1,?)=?').run(prefix.length,prefix);
}
