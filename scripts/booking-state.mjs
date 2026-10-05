import {createHmac, randomBytes, randomUUID} from 'node:crypto';
import {mkdirSync, readFileSync, writeFileSync, openSync, closeSync, fsyncSync, renameSync, unlinkSync} from 'node:fs';
import path from 'node:path';

// Single-process durable booking journal. Files contain status/record ID only;
// phone, services and datetime are represented by a keyed digest, never plaintext.
export function createBookingState(directory) {
  mkdirSync(directory, {recursive:true,mode:0o700});
  const keyPath=path.join(directory,'.digest-key');
  try { const fd=openSync(keyPath,'wx',0o600);try{writeFileSync(fd,randomBytes(32));fsyncSync(fd);}finally{closeSync(fd);} } catch(e) { if(e.code!=='EEXIST') throw e; }
  const key=readFileSync(keyPath);
  if(key.length!==32)throw new Error('Invalid booking journal key');
  const digest=value=>createHmac('sha256',key).update(value).digest('hex');
  const file=intent=>path.join(directory,digest(intent)+'.json');
  const syncDirectory=()=>{const fd=openSync(directory,'r');try{fsyncSync(fd);}finally{closeSync(fd);}};
  const durableWrite=(name,data,exclusive=false)=>{
    const dest=exclusive?name:name+'.'+randomUUID()+'.tmp';
    const fd=openSync(dest,exclusive?'wx':'w',0o600);
    try {writeFileSync(fd,JSON.stringify(data));fsyncSync(fd);}finally{closeSync(fd);}
    if(!exclusive)renameSync(dest,name);
    syncDirectory();
  };
  return {
    claim(intent) {
      const name=file(intent);
      try { durableWrite(name,{status:'pending'},true); return null; }
      catch(e) {
        if(e.code!=='EEXIST') throw e;
        // A partial file or pending entry after restart is uncertain, never retryable.
        try { const data=JSON.parse(readFileSync(name,'utf8')); return data.status==='confirmed' && Number.isSafeInteger(data.record_id) && data.record_id>0 ? data : {status:'unknown'}; }
        catch { return {status:'unknown'}; }
      }
    },
    save(intent,data) {durableWrite(file(intent),data);},
    remove(intent) {try{unlinkSync(file(intent));syncDirectory();}catch(e){if(e.code!=='ENOENT')throw e;}},
    digest
  };
}
