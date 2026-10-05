import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createBookingAPI} from '../scripts/booking-api.mjs';

const datetime = new Date(Date.now() + 7 * 86400000).toISOString();
const appointment = {services:[101], staff_id:7, datetime};
const contacts = {fullname:'Тестова перевірка',phone:'+380000000000',email:'',comment:'',consent:true};
const ok = data => new Response(JSON.stringify({success:true,data}), {status:200});
async function fixture(t, options = {}) {
  const calls=[];
  const stateDirectory=await mkdtemp(path.join(os.tmpdir(),'maison-booking-test-'));t.after(()=>rm(stateDirectory,{recursive:true,force:true}));
  const transport=async (url, request) => {
    const path=new URL(url).pathname; calls.push({path,method:request.method,body:request.body && JSON.parse(request.body)});
    if(path.includes('/bookform/')) return ok({company_id:1328326,group_id:options.chain ? 1316653 : 0,phone_confirmation:false,sms_enabled:true,comment_required:false});
    if(path.includes('/company/') || path.includes('/locations/')) return ok({id:1328326,phone_confirmation:!!options.sms,sms_enabled:true,record_type_id:options.recordType ?? 1,payment_policy:{type:options.payment ?? 'none'}});
    if(path.includes('/book_services/')) return ok({services:[{id:101,title:'Тестова послуга',price_min:300,price_max:300,seance_length:900,prepaid:'forbidden'}]});
    if(path.includes('/book_times/')) return ok(options.taken ? [] : [{datetime}]);
    if(path.includes('/book_staff/')) return ok([{id:7,name:'Тестовий фахівець',bookable:true,prepaid:options.staffPayment ?? 'forbidden'}]);
    if(path.includes('/book_check/')) { if(options.checkTimeout) throw new Error('check timeout'); if(options.emptyCheck) return new Response(null,{status:201}); return ok(null); }
    if(path.includes('/book_code/')) return ok(null);
    if(path.includes('/book_record/')) {
      if(options.uncertain==='malformed') return new Response('<html>upstream</html>',{status:502});
      if(options.uncertain==='server') return new Response(JSON.stringify({success:false}),{status:500});
      if(options.uncertain==='missing') return ok([]);
      if(options.uncertain==='null') return new Response('null',{status:200});
      if(options.uncertain==='timeout') throw new Error('timeout');
      return ok([{id:1,record_id:9001}]);
    }
    return ok([]);
  };
  const create=()=>createBookingAPI({token:options.disconnected ? '' : 'fixture-partner-token',transport,stateDirectory});
  let handler=create();
  const server=http.createServer((req,res)=>handler(req,res,new URL(req.url,`http://${req.headers.host}`)));
  await new Promise(r=>server.listen(0,'127.0.0.1',r)); t.after(()=>new Promise(r=>server.close(r)));
  const origin=`http://127.0.0.1:${server.address().port}`;
  const call=async(route,body,extra={})=>{
    const posting=body!==undefined;
    const r=await fetch(origin+'/api/booking/'+route,{method:posting?'POST':'GET',headers:{...(posting?{Origin:origin,'Content-Type':'application/json'}:{}),...extra},...(posting?{body:JSON.stringify(body)}:{})});
    return {status:r.status,...await r.json()};
  };
  return {call,calls,restart:()=>{handler=create();}};
}

test('disconnected backend blocks calendars without contacting upstream',async t=>{
  const f=await fixture(t,{disconnected:true}); assert.equal((await f.call('status')).connected,false); assert.equal((await f.call('times?staff_id=7&date=2030-01-01')).status,503); assert.equal(f.calls.length,0);
});
test('chain form uses this location settings instead of rejecting group id',async t=>{
  const f=await fixture(t,{chain:true,sms:true}); const r=await f.call('prepare',appointment);
  assert.equal(r.status,200); assert.equal(r.data.phoneConfirmation,true); assert.ok(f.calls.some(c=>c.path.includes('/locations/1328326') || c.path.includes('/company/1328326')));
});
test('new preparation cannot bypass uncertain same-phone appointment lock',async t=>{
  const f=await fixture(t,{uncertain:'timeout'}); const a=await f.call('prepare',appointment); await f.call('records',{...contacts,session:a.data.session});
  const b=await f.call('prepare',appointment); const result=await f.call('records',{...contacts,session:b.data.session}); assert.equal(result.error,'RESULT_UNKNOWN'); assert.equal(f.calls.filter(c=>c.path.includes('/book_record/')).length,1);
});
test('uncertain write stays locked after API process recreation',async t=>{
  const f=await fixture(t,{uncertain:'timeout'});const a=await f.call('prepare',appointment);await f.call('records',{...contacts,session:a.data.session});f.restart();
  const b=await f.call('prepare',appointment);const r=await f.call('records',{...contacts,session:b.data.session});assert.equal(r.error,'RESULT_UNKNOWN');assert.equal(f.calls.filter(c=>c.path.includes('/book_record/')).length,1);
});
test('confirmed intent is replayed after process recreation without a second write',async t=>{
  const f=await fixture(t);const a=await f.call('prepare',appointment);await f.call('records',{...contacts,session:a.data.session});f.restart();
  const b=await f.call('prepare',appointment);const r=await f.call('records',{...contacts,session:b.data.session});assert.equal(r.data.record_id,9001);assert.equal(f.calls.filter(c=>c.path.includes('/book_record/')).length,1);
});
test('SMS source budget resists new sessions and recipient rotation',async t=>{
  const f=await fixture(t,{chain:true,sms:true});let sent=0,limited=0;
  for(let i=0;i<8;i++){const p=await f.call('prepare',appointment);const r=await f.call('code',{session:p.data.session,phone:'+38000000000'+i,fullname:contacts.fullname});if(r.status===200)sent++;if(r.status===429)limited++;}
  assert.equal(sent,3);assert.equal(limited,5);assert.equal(f.calls.filter(c=>c.path.includes('/book_code/')).length,3);
});
test('read-only preflight timeout is retryable, with no reservation uncertainty',async t=>{const f=await fixture(t,{checkTimeout:true}); const r=await f.call('prepare',appointment); assert.equal(r.error,'UPSTREAM_UNAVAILABLE'); assert.equal(f.calls.filter(c=>c.path.includes('/book_record/')).length,0);});
test('JSON null is a client error',async t=>{const f=await fixture(t); assert.equal((await f.call('prepare',null)).status,400);});
test('one SMS session cannot relay to different phone recipients',async t=>{
  const f=await fixture(t,{chain:true,sms:true}); const p=await f.call('prepare',appointment); const body={session:p.data.session,phone:contacts.phone,fullname:contacts.fullname};
  assert.equal((await f.call('code',body)).status,200); assert.equal((await f.call('code',{...body,phone:'+380000000001'})).status,409); assert.equal(f.calls.filter(c=>c.path.includes('/book_code/')).length,1);
});
test('calendar range needs both bounds in increasing order',async t=>{const f=await fixture(t); assert.equal((await f.call('dates?date_from=2030-01-01')).status,400); assert.equal((await f.call('dates?date_from=2030-02-01&date_to=2030-01-01')).status,400);});
test('location required payment blocks booking before preparation',async t=>{const f=await fixture(t,{payment:'deposit'}); assert.equal((await f.call('prepare',appointment)).error,'PAYMENT_REQUIRED');});
test('staff required payment blocks unsupported payment flow',async t=>{const f=await fixture(t,{staffPayment:'required'}); assert.equal((await f.call('prepare',appointment)).error,'PAYMENT_REQUIRED');});
test('unknown location booking type fails closed',async t=>{const f=await fixture(t,{recordType:999}); assert.equal((await f.call('prepare',appointment)).error,'CONFIG_MISMATCH');});
test('documented empty check201 is valid, without accepting an empty booking result',async t=>{const f=await fixture(t,{emptyCheck:true}); assert.equal((await f.call('prepare',appointment)).status,200);});
test('valid same-page booking and duplicate submit create only one record',async t=>{
  const f=await fixture(t); const p=await f.call('prepare',appointment); assert.equal(p.status,200);
  const body={...contacts,session:p.data.session}; const [a,b]=await Promise.all([f.call('records',body),f.call('records',body)]);
  assert.equal(a.status,201); assert.ok([201,409].includes(b.status)); assert.equal((await f.call('records',body)).data.record_id,9001); assert.equal(f.calls.filter(c=>c.path.includes('/book_record/')).length,1);
});
for(const uncertain of ['malformed','server','missing','null','timeout']) test(`uncertain ${uncertain} response stays locked without duplicate booking`,async t=>{
  const f=await fixture(t,{uncertain}); const p=await f.call('prepare',appointment); const body={...contacts,session:p.data.session};
  const a=await f.call('records',body),b=await f.call('records',body); assert.equal(a.error,'RESULT_UNKNOWN'); assert.equal(b.error,'RESULT_UNKNOWN'); assert.equal(f.calls.filter(c=>c.path.includes('/book_record/')).length,1);
});
test('invalid calendar date returns client validation error',async t=>{const f=await fixture(t); assert.equal((await f.call('times?staff_id=7&date=2030-99-99')).status,400);});
test('service query accepts ISO appointment datetime',async t=>{const f=await fixture(t); assert.equal((await f.call('services?datetime='+encodeURIComponent(datetime))).status,200);});
test('foreign-origin mutations are rejected before upstream',async t=>{const f=await fixture(t); assert.equal((await f.call('prepare',appointment,{Origin:'https://invalid.example'})).status,403); assert.equal(f.calls.length,0);});
test('taken slot prevents prepare and record',async t=>{const f=await fixture(t,{taken:true}); const r=await f.call('prepare',appointment); assert.equal(r.error,'SLOT_TAKEN'); assert.equal(f.calls.filter(c=>c.path.includes('/book_record/')).length,0);});
test('unconsented contacts never reach booking provider',async t=>{const f=await fixture(t); const p=await f.call('prepare',appointment); const r=await f.call('records',{...contacts,consent:false,session:p.data.session}); assert.equal(r.error,'CONTACTS'); assert.equal(f.calls.filter(c=>c.path.includes('/book_record/')).length,0);});
