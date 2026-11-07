import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import https from 'node:https';
import { spawn, execFileSync } from 'node:child_process';
import { createIngress, phaseExpiry } from './server.mjs';
const wait = ms => new Promise(resolve=>setTimeout(resolve,ms));
async function until(predicate, timeout=5000) { const end=Date.now()+timeout; while(!predicate()) { if(Date.now()>=end) throw new Error('Harness condition timed out'); await wait(20); } }
const config=JSON.parse(readFileSync(process.env.TARJETAS_INGRESS_TEST_CONFIG,'utf8'));
let php, edge;
before(async()=>{
  php=spawn('php',['-S',`127.0.0.1:${config.upstreamPort}`,'tests/Support/ingress-router.php'],{cwd:new URL('..',import.meta.url),env:{...process.env,APP_ENV:'testing',TARJETAS_INGRESS_ROOT:config.root,TARJETAS_INGRESS_KEY:config.key,TARJETAS_PYTHON:new URL('../.venv/bin/python',import.meta.url).pathname},stdio:['ignore','pipe','pipe']});
  let ready=false;php.stderr.on('data',bytes=>{if(bytes.toString().includes('started'))ready=true;});await until(()=>ready);
  edge=createIngress(config);await new Promise(resolve=>edge.listen(config.port,'127.0.0.1',resolve));
});
after(async()=>{await new Promise(resolve=>edge.close(resolve));php.kill('SIGTERM');});
const ca=readFileSync(config.ca);
function request(path,body='',headers={}) {return new Promise((resolve,reject)=>{ const req=https.request(config.origin+path,{method:'POST',ca,headers:{'Content-Type':'application/octet-stream','Content-Length':Buffer.byteLength(body),...headers}},res=>{let text='';res.on('data',chunk=>text+=chunk);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(text)}));});req.on('error',reject);req.end(body);});}
test('production phase guards reject exact upload/non-OCR/OCR boundaries independently',()=>{
  assert.equal(phaseExpiry(0,179999,false),null);assert.deepEqual(phaseExpiry(0,180000,false),{status:408,code:'upload_timeout'});assert.equal(phaseExpiry(0,180001,false).code,'upload_timeout');
  assert.equal(phaseExpiry(0,180000,true).code,'non_ocr_budget_exceeded');assert.equal(phaseExpiry(0,720000,true).code,'processing_timeout');
  assert.equal(phaseExpiry(0,300000,true,{clockMs:200000,nonOcrMs:120000,activeOcr:1,ocrMs:{1:70000}}),null);
  assert.equal(phaseExpiry(0,310000,true,{clockMs:200000,nonOcrMs:120000,activeOcr:1,ocrMs:{1:70000}}).code,'ocr_attempt_timeout');
  assert.equal(phaseExpiry(0,640000,true,{clockMs:630000,nonOcrMs:150000,activeOcr:null,ocrMs:{1:160000,2:160000,3:160000}}),null);
});
test('signed first-byte timestamp precedes complete body and replaces forged client metadata',async()=>{
  const begin=Date.now();
  const result=await new Promise((resolve,reject)=>{
    const req=https.request(config.origin+'/stamp',{method:'POST',ca,headers:{'Content-Length':2,'X-Tarjetas-Deadline':'forged','X-Tarjetas-Signature':'forged','X_Tarjetas_Deadline':'forged-alternative','Tarjetas_Ingress_Started_At_Unix_Ms':'forged-alternative','X_Forwarded_Host':'untrusted.invalid'}},res=>{let body='';res.on('data',chunk=>body+=chunk);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(body)}));});
    req.on('error',reject);req.flushHeaders();req.write('a');setTimeout(()=>req.end('b'),200);
  });
  assert.equal(result.status,200);assert.ok(Number(result.body.startedAt)>=begin);assert.ok(result.body.now-Number(result.body.startedAt)>=190);assert.ok(result.body.requestId);assert.deepEqual(result.body.alternateHeaders,[]);
});
test('real TLS client disconnect cancels and reaps private PHP worker descendants',async()=>{
  const before=new Set(readdirSync(config.root));
  const req=https.request(config.origin+'/process',{method:'POST',ca,headers:{'Content-Length':0}});req.on('error',()=>{});req.end();
  await until(()=>readdirSync(config.root).some(name=>name.startsWith('worker-')&&!before.has(name)));
  const marker=readdirSync(config.root).find(name=>name.startsWith('worker-')&&!before.has(name)); const pids=JSON.parse(readFileSync(config.root+'/'+marker,'utf8'));
  const id=marker.slice(7,-5);req.destroy();await until(()=>!existsSync(config.root+'/'+id));
  for(const pid of pids) {let state='';try{state=execFileSync('/bin/ps',['-o','stat=','-p',String(pid)],{encoding:'utf8'}).trim();}catch{} assert.ok(!state||state.startsWith('Z'),`Private descendant ${pid} still running`);}
  rmSync(config.root+'/'+marker);
});
test('real slow body expires at the independent 180-second upload guard before PHP dispatch',{timeout:190000},async()=>{
  const begin=Number(process.hrtime.bigint())/1e6, wallBegin=Date.now();
  const result=await new Promise((resolve,reject)=>{
    const req=https.request(config.origin+'/stamp',{method:'POST',ca,headers:{'Content-Length':2}},res=>{let body='';res.on('data',chunk=>body+=chunk);res.on('end',()=>{resolve({status:res.statusCode,body:JSON.parse(body)});req.destroy();});});req.on('error',reject);req.flushHeaders();req.write('a');
  });
  const elapsed=Number(process.hrtime.bigint())/1e6-begin;process.stdout.write(JSON.stringify({scenario:'real_slow_upload',monotonicElapsedMs:elapsed,wallElapsedMs:Date.now()-wallBegin})+'\n');
  assert.equal(result.status,408);assert.equal(result.body.error.code,'upload_timeout');assert.ok(elapsed>=180000);assert.ok(elapsed<182000);
});
