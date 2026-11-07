import https from 'node:https';
import {readFileSync} from 'node:fs';
/** Test-only outer watchdog: the non-OCR guard is absent here, never toggled in production. */
export function isolatedWatchdog(config){
 const clock=()=>Number(process.hrtime.bigint())/1e6;
 const server=https.createServer({key:readFileSync(config.tlsKey),cert:readFileSync(config.tlsCert)},(request,response)=>{
  const start=request.socket.testFirstByte;let uploaded=false,complete=false;let queue;
  const finish=(status,code)=>{if(complete)return;complete=true;clearTimeout(upload);clearTimeout(outer);clearTimeout(queue);response.writeHead(status,{'Content-Type':'application/json'}).end(JSON.stringify({error:{code},mode:'isolated_outer_watchdog',backendStarted:false,elapsed:clock()-start}));request.resume();};
  let upload,outer;const expireUpload=()=>{const remaining=180000-(clock()-start);if(remaining>0){upload=setTimeout(expireUpload,Math.ceil(remaining));return;}finish(408,'upload_timeout');};const expireOuter=()=>{const remaining=720000-(clock()-start);if(remaining>0){outer=setTimeout(expireOuter,Math.ceil(remaining));return;}finish(504,'request_deadline_exceeded');};upload=setTimeout(expireUpload,Math.ceil(Math.max(0,180000-(clock()-start))));outer=setTimeout(expireOuter,Math.ceil(Math.max(0,720000-(clock()-start))));
  request.on('data',()=>{if(!uploaded&&clock()-start>=180000)finish(408,'upload_timeout');});
  request.on('end',()=>{if(clock()-start>=180000){finish(408,'upload_timeout');return;}uploaded=true;clearTimeout(upload);queue=setTimeout(()=>finish(500,'unexpected_backend_dispatch'),config.queueMs);});
  response.on('close',()=>{clearTimeout(upload);clearTimeout(outer);clearTimeout(queue);});
 });
 server.requestTimeout=0;server.headersTimeout=0;server.timeout=0;server.on('secureConnection',socket=>socket.prependOnceListener('data',()=>{socket.testFirstByte=clock();}));return server;
}
