import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import {spawn,execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,existsSync,lstatSync,realpathSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createBridge} from './fastcgi-bridge.mjs';
import {createIngress} from './server.mjs';
import {isolatedWatchdog} from '../tests/Support/watchdog-fault.mjs';
const root=process.env.TARJETAS_DEADLINE_WIRE_ROOT;
const backend=fileURLToPath(new URL('..',import.meta.url)).replace(/\/$/,'');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check,ms=5000){const end=Date.now()+ms;while(!check()){if(Date.now()>=end)throw new Error('Private harness readiness/cleanup timed out');await sleep(20);}}
async function listen(server){await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return server.address().port;}
async function unusedPort(){const server=net.createServer();const port=await listen(server);await new Promise(resolve=>server.close(resolve));return port;}
function write(filename,value){writeFileSync(filename,value,{flag:'wx',mode:0o600});}
const caPath='/Users/pronestivm/Library/Application Support/io.yerd.Yerd/ca.cert.pem';
const leaves='/Users/pronestivm/Library/Application Support/io.yerd.Yerd/leaves';
const tls={tlsKey:leaves+'/api.tarjetas-browser.test.key.pem',tlsCert:leaves+'/api.tarjetas-browser.test.cert.pem'};
async function normal(settings){
 const directory=settings.root;const cfg=Object.fromEntries(readFileSync(backend+'/.env.testing','utf8').split('\n').filter(line=>line.includes('=')&&!line.startsWith('#')).map(line=>{const index=line.indexOf('=');return [line.slice(0,index),line.slice(index+1)];}));const key=randomBytes(32).toString('hex');
 const pool=readFileSync(backend+'/ingress/php-fpm.pool.example.conf','utf8').replaceAll('/absolute/private/runtime',directory).replaceAll('/absolute/private/uploads',directory+'/uploads').replaceAll('/absolute/private/temp',directory+'/tmp').replace('php-fpm.sock','f.sock').replace('pm.max_children = 4','pm.max_children = 1');
 assert.ok(Buffer.byteLength(directory+'/f.sock')<104);write(directory+'/pool.conf',pool);
 const environment=Object.fromEntries(['PATH','HOME','USER','LOGNAME','LANG','LC_ALL','TMPDIR'].filter(name=>process.env[name]).map(name=>[name,process.env[name]]));
 const php=spawn('/Users/pronestivm/Library/Application Support/io.yerd.Yerd/php/php-8.5/sbin/php-fpm',['-F','-y',directory+'/pool.conf'],{cwd:backend,env:{...environment,...cfg,TARJETAS_INGRESS_KEY:key,TARJETAS_INGRESS_ROOT:directory+'/contexts',TARJETAS_PYTHON:backend+'/.venv/bin/python',TARJETAS_PROCESSING_TEMP_ROOT:directory+'/tmp',TARJETAS_DEADLINE_CASE:directory+'/case.json'},stdio:['ignore','pipe','pipe']});let startup='';php.stderr.on('data',bytes=>{startup+=bytes.toString();});
 try { await until(()=>existsSync(directory+'/f.sock'));const bridge=createBridge({socket:directory+'/f.sock',script:backend+'/tests/Support/deadline-router.php',publicRoot:backend+'/public'});bridge.requestTimeout=0;bridge.headersTimeout=0;bridge.timeout=0;const bridgePort=await listen(bridge);
 const queue=http.createServer((request,response)=>{const body=[];request.on('data',bytes=>body.push(bytes));request.on('end',()=>{const timer=setTimeout(()=>{const downstream=http.request({hostname:'127.0.0.1',port:bridgePort,path:request.url,method:request.method,headers:request.headers},result=>{response.writeHead(result.statusCode,result.headers);result.pipe(response);});downstream.on('error',()=>{if(!response.headersSent)response.writeHead(502).end();});downstream.end(Buffer.concat(body));},settings.fixture.upstream_queue_ms);response.on('close',()=>clearTimeout(timer));});});queue.requestTimeout=0;queue.headersTimeout=0;queue.timeout=0;const queuePort=await listen(queue);
 const config={...tls,key,root:directory+'/contexts',frontend:'https://app.tarjetas-integration.test',origin:'https://api.tarjetas-browser.test:0',upstreamPort:queuePort};const edge=createIngress(config);const port=await listen(edge);config.origin='https://api.tarjetas-browser.test:'+port;
 return {url:config.origin,close:async()=>{edge.closeAllConnections();queue.closeAllConnections();bridge.closeAllConnections();await Promise.all([new Promise(resolve=>edge.close(resolve)),new Promise(resolve=>queue.close(resolve)),new Promise(resolve=>bridge.close(resolve))]);php.kill('SIGTERM');await until(()=>php.exitCode!==null||php.signalCode!==null);}}; } catch (error) { php.kill('SIGTERM'); throw error; }
}
async function wire(url,fixture){
 const start=Number(process.hrtime.bigint())/1e6,wallStart=Date.now();let timer;return new Promise((resolve,reject)=>{const request=https.request(url+'/case',{method:'POST',ca:readFileSync(caPath),headers:{'Content-Length':2,'X-Tarjetas-Deadline':'forged-client-stamp','X-Tarjetas-Signature':'forged-client-signature'}},response=>{let body='';response.on('data',bytes=>body+=bytes);response.on('end',()=>{clearTimeout(timer);request.destroy();try{resolve({status:response.statusCode,body:JSON.parse(body),elapsed:Number(process.hrtime.bigint())/1e6-start,wallElapsed:Date.now()-wallStart});}catch(error){reject(error);}});});request.on('error',reject);request.flushHeaders();request.write('a');timer=setTimeout(()=>request.end('b'),fixture.upload_ms);});
}
function running(pid){try{return execFileSync('/bin/ps',['-o','stat=','-p',String(pid)],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();}catch{return '';}}
test('real first-byte buffering/FPM/worker deadlines and separately isolated outer watchdog',{skip:!root,timeout:780000,concurrency:3},async t=>{
 assert.equal(realpathSync(root),root);assert.equal(lstatSync(root).mode&0o077,0);execFileSync('php',['artisan','tarjetas:test-target:check','--env=testing'],{cwd:backend,stdio:'pipe'});const files=JSON.parse(readFileSync(root+'/cases.json','utf8'));
 await Promise.all(files.map(filename=>t.test(JSON.parse(readFileSync(filename,'utf8')).fixture.name,{timeout:770000},async()=>{
  const settings=JSON.parse(readFileSync(filename,'utf8'));const fixture=settings.fixture;let server;
  process.stdout.write(JSON.stringify({scenario:fixture.name,mode:fixture.mode,stage:'starting_real_wall_clock'})+'\n');
  if(fixture.mode==='normal'){server=await normal(settings);}else{const edge=isolatedWatchdog({...tls,queueMs:fixture.upstream_queue_ms});const port=await listen(edge);server={url:'https://api.tarjetas-browser.test:'+port,close:async()=>{edge.closeAllConnections();await new Promise(resolve=>edge.close(resolve));}};}
  try{
   const result=await wire(server.url,fixture);write(settings.root+'/actual.json',JSON.stringify({...result,scenario:fixture.name,mode:fixture.mode}));assert.equal(result.status,fixture.expected.status);const code=result.status===200?'ok':result.body.error.code;assert.equal(code,fixture.expected.code);assert.ok(result.elapsed>=fixture.expected.finished_elapsed_ms-(fixture.name==='buffered_upload_then_processing_timeout'?1100:100));assert.ok(result.elapsed<fixture.expected.finished_elapsed_ms+3000);
   if(fixture.mode==='normal'){
    await until(()=>existsSync(settings.root+'/backend.json'));const entry=JSON.parse(readFileSync(settings.root+'/backend.json','utf8'));assert.equal(entry.sapi,'fpm-fcgi');assert.equal(entry.originalDeadline-entry.originalStart,720000);assert.ok(entry.backendEntry-entry.originalStart>=fixture.upload_ms+fixture.upstream_queue_ms-100);assert.ok(entry.backendEntry-entry.originalStart<fixture.upload_ms+fixture.upstream_queue_ms+3000);const worker=JSON.parse(readFileSync(settings.root+'/worker.json','utf8'));assert.equal(worker.originalStart,entry.originalStart);assert.equal(worker.originalDeadline,entry.originalDeadline);assert.equal(worker.credentialsPresent,false);
    await until(()=>!existsSync(settings.root+'/contexts/'+(result.body.requestId??'not-an-id'))&&![worker.worker,worker.descendant].some(pid=>{const state=running(pid);return state&&!state.startsWith('Z');}),5000);
   }else{assert.equal(result.body.mode,'isolated_outer_watchdog');assert.equal(result.body.backendStarted,false);assert.equal(existsSync(settings.root+'/backend.json'),false);}
   process.stdout.write(JSON.stringify({scenario:fixture.name,mode:fixture.mode,status:result.status,code,elapsed:result.elapsed,stage:'finished_real_wall_clock'})+'\n');
  }finally{await server.close();}
 })));
 const audit=JSON.parse(execFileSync('php',['artisan','tarjetas:acceptance:deadline-cases',root,'--audit','--env=testing'],{cwd:backend,encoding:'utf8'}));for(const row of audit){const expected=row.name==='buffered_upload_then_success'?1:0;assert.equal(row.journals,expected,JSON.stringify(row));}write(root+'/audit.json',JSON.stringify(audit));
});
