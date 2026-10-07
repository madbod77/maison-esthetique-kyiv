import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp, readdir, readFile, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createLeadAPI} from '../scripts/leads-api.mjs';

test('lead collection persists only validated consented leads; retries are durable and conflicts fail', async () => {
  const dir=await mkdtemp(path.join(os.tmpdir(),'maison-lead-test-'));
  let api=createLeadAPI({directory:dir,serviceIds:new Set(['s1'])});
  const server=http.createServer((req,res)=>api(req,res,new URL(req.url,'http://localhost')));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${server.address().port}`;
  const payload={name:'Тест Maison',phone:'0930000000',consent:true,source:'callback',services:['s1'],preference:'Живіт',requestId:randomUUID()};
  const send=(body,origin=url)=>fetch(url+'/api/leads',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify(body)});
  try {
    assert.equal((await send({...payload,name:''})).status,400);
    assert.equal((await send({...payload,name:'   '})).status,400);
    assert.equal((await send({...payload,consent:false})).status,400);
    assert.equal((await send({...payload,phone:'123'})).status,400);
    assert.equal((await send({...payload,services:['unknown']})).status,400);
    assert.equal((await send(payload,'https://unrelated.example')).status,403);
    assert.equal((await readdir(dir)).length,0);
    const response=await send(payload); assert.equal(response.status,201);
    const receipt=await response.json(); assert.equal(receipt.status,'collected'); assert.ok(receipt.id);
    const records=await readdir(dir); assert.equal(records.length,1);
    const record=JSON.parse(await readFile(path.join(dir,records[0]),'utf8'));
    assert.equal(record.phone,'+380930000000');assert.deepEqual(record.services,['s1']);assert.equal(record.consent,true);
    assert.equal(record.preference,'Живіт');
    api=createLeadAPI({directory:dir,serviceIds:new Set(['s1'])});
    const retry=await send(payload);assert.equal(retry.status,200);assert.equal((await retry.json()).id,receipt.id);
    assert.equal((await send({...payload,name:'Changed'})).status,409);
    assert.equal((await readdir(dir)).length,1);
    const invalid=await fetch(url+'/api/leads',{method:'POST',headers:{Origin:url,'Content-Type':'text/plain'},body:'test'});assert.equal(invalid.status,415);
  } finally {await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});}
});

test('storage failure never reports successful collection',async()=>{
  const api=createLeadAPI({directory:'/dev/null/impossible'});
  const server=http.createServer((req,res)=>api(req,res,new URL(req.url,'http://localhost')));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${server.address().port}`;
  try {const r=await fetch(url+'/api/leads',{method:'POST',headers:{Origin:url,'Content-Type':'application/json'},body:JSON.stringify({name:'Тест Maison',phone:'0930000000',consent:true,source:'callback',services:[],requestId:randomUUID()})});assert.equal(r.status,503);}finally{await new Promise(resolve=>server.close(resolve));}
});
