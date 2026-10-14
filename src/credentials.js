// Process memory only. The worker receives the selected credentials over IPC.
const values=new Map();
export function putCredential(id,owner,key) { values.set(id,{owner,key}); }
export function getCredential(id,owner) {const entry=values.get(id);return entry&&(owner==null||entry.owner===owner)?entry.key:null;}
export function deleteCredential(id) {values.delete(id);}
export function installWorkerCredentials(entries) {values.clear();for(const [id,key] of entries||[])putCredential(id,null,key);}
