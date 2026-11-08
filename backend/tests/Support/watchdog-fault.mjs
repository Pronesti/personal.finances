import https from 'node:https';
import {readFileSync} from 'node:fs';
export function watchdogExpiry(start,now,uploaded){
 if(!uploaded&&now-start>=180000)return {status:408,code:'upload_timeout'};
 if(now-start>=720000)return {status:504,code:'request_deadline_exceeded'};
 return null;
}
/** Test-only outer watchdog: the non-OCR guard is absent here, never toggled in production. */
export function isolatedWatchdog(config){
 const clock=()=>Number(process.hrtime.bigint())/1e6;
 const server=https.createServer({key:readFileSync(config.tlsKey),cert:readFileSync(config.tlsCert)},(request,response)=>{
  const start=request.socket.testFirstByte;let uploaded=false,complete=false;let queue;
  const finish=(status,code)=>{if(complete)return;complete=true;clearTimeout(upload);clearTimeout(outer);clearTimeout(queue);response.writeHead(status,{'Content-Type':'application/json'}).end(JSON.stringify({error:{code},mode:'isolated_outer_watchdog',backendStarted:false,elapsed:clock()-start}));request.resume();};
  let upload,outer;const expireUpload=()=>{const remaining=180000-(clock()-start);const failure=watchdogExpiry(start,clock(),uploaded);if(!failure){upload=setTimeout(expireUpload,Math.ceil(Math.max(1,remaining)));return;}finish(failure.status,failure.code);};const expireOuter=()=>{const remaining=720000-(clock()-start);const failure=watchdogExpiry(start,clock(),uploaded);if(!failure){outer=setTimeout(expireOuter,Math.ceil(Math.max(1,remaining)));return;}finish(failure.status,failure.code);};upload=setTimeout(expireUpload,Math.ceil(Math.max(0,180000-(clock()-start))));outer=setTimeout(expireOuter,Math.ceil(Math.max(0,720000-(clock()-start))));
  request.on('data',()=>{if(!uploaded&&clock()-start>=180000)finish(408,'upload_timeout');});
  request.on('end',()=>{const failure=watchdogExpiry(start,clock(),false);if(failure){finish(failure.status,failure.code);return;}uploaded=true;clearTimeout(upload);queue=setTimeout(()=>finish(500,'unexpected_backend_dispatch'),config.queueMs);});
  response.on('close',()=>{clearTimeout(upload);clearTimeout(outer);clearTimeout(queue);});
 });
 server.requestTimeout=0;server.headersTimeout=0;server.timeout=0;server.on('secureConnection',socket=>socket.prependOnceListener('data',()=>{socket.testFirstByte=clock();}));return server;
}
