import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import path from 'node:path';

export function createLeadAPI({directory=path.resolve('.maison-leads'),serviceIds=new Set()}={}) {
  const attempts=new Map();
  const reply=(res,status,body)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(body));};
  return async(req,res,url)=>{
    if(url.pathname!=='/api/leads')return reply(res,404,{error:'not_found'});
    if(req.method!=='POST')return reply(res,405,{error:'method_not_allowed'});
    if(req.headers.origin!==`http://${req.headers.host}`&&req.headers.origin!==`https://${req.headers.host}`)return reply(res,403,{error:'origin'});
    if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))return reply(res,415,{error:'content_type'});
    try {
      let bytes=0;const chunks=[];
      for await(const chunk of req){bytes+=chunk.length;if(bytes>8192)return reply(res,413,{error:'too_large'});chunks.push(chunk);}
      const body=Buffer.concat(chunks).toString('utf8');
      let input;try{input=JSON.parse(body);}catch{return reply(res,400,{error:'invalid_json'});}
      if(!input||typeof input!=='object')return reply(res,400,{error:'invalid'});
      const name=typeof input.name==='string'?input.name.trim():'';
      let phone=typeof input.phone==='string'?input.phone.replace(/[^0-9]/g,''):'';
      if(/^0\d{9}$/.test(phone))phone='38'+phone;
      const source=typeof input.source==='string'?input.source.trim():'';
      const preference=typeof input.preference==='string'?input.preference.trim():'';
      const services=input.services;
      if(!name||name.length>100||preference.length>160||!/^380[3-9]\d{8}$/.test(phone)||input.consent!==true||!source||source.length>100||input.website||!Array.isArray(services)||services.length>20||services.some(id=>typeof id!=='string'||!serviceIds.has(id))||typeof input.requestId!=='string'||! /^[a-f0-9-]{36}$/i.test(input.requestId))return reply(res,400,{error:'validation'});
      const value={name,phone:'+'+phone,consent:true,source,preference,services:[...new Set(services)]};
      const fingerprint=createHash('sha256').update(JSON.stringify(value)).digest('hex');
      const key=createHash('sha256').update(input.requestId).digest('hex');
      const file=path.join(directory,key+'.json');
      let previous;try{previous=JSON.parse(await readFile(file,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
      if(previous){if(previous.fingerprint!==fingerprint)return reply(res,409,{error:'request_conflict'});return reply(res,200,{status:'collected',id:previous.id});}
      const ip=req.socket.remoteAddress||'unknown',now=Date.now();
      for(const [address,entry] of attempts)if(now-entry.start>600000)attempts.delete(address);
      const rate=attempts.get(ip)||{start:now,count:0};
      if(rate.count>=6)return reply(res,429,{error:'rate_limit'});
      rate.count++;attempts.set(ip,rate);
      await mkdir(directory,{recursive:true,mode:0o700});
      const record={id:randomUUID(),createdAt:new Date().toISOString(),...value,fingerprint};
      try{await writeFile(file,JSON.stringify(record)+'\n',{flag:'wx',mode:0o600});}
      catch(error){if(error.code!=='EEXIST')throw error;const existing=JSON.parse(await readFile(file,'utf8'));if(existing.fingerprint!==fingerprint)return reply(res,409,{error:'request_conflict'});return reply(res,200,{status:'collected',id:existing.id});}
      return reply(res,201,{status:'collected',id:record.id});
    }catch{return reply(res,503,{error:'storage_unavailable'});}
  };
}
