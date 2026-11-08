import {test} from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import http from 'node:http';
import {readFileSync,mkdirSync,readdirSync,rmdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {createIngress} from './server.mjs';
const filename=process.env.TARJETAS_INGRESS_TEST_CONFIG;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(condition){const deadline=Date.now()+3000;while(!condition()){if(Date.now()>deadline)throw new Error('Ingress cleanup did not complete');await sleep(10);}}
test('cancelled request with an upstream early response releases its context without a PHP middleware acknowledgement',{skip:!filename},async()=>{
 const base=JSON.parse(readFileSync(filename,'utf8'));const root=base.root+'/lifecycle-'+randomUUID();mkdirSync(root,{mode:0o700});let dispatched;const ready=new Promise(resolve=>{dispatched=resolve;});const backend=http.createServer((request,response)=>{request.resume();request.on('end',()=>{dispatched();setTimeout(()=>response.writeHead(204).end(),100);});});await new Promise(resolve=>backend.listen(0,'127.0.0.1',resolve));const config={...base,root,origin:'https://api.tarjetas-browser.test:0',upstreamPort:backend.address().port};const edge=createIngress(config);await new Promise(resolve=>edge.listen(0,'127.0.0.1',resolve));config.origin='https://api.tarjetas-browser.test:'+edge.address().port;
 try{const request=https.request(config.origin+'/early',{method:'OPTIONS',ca:readFileSync(base.ca),headers:{'Content-Length':0}});request.on('error',()=>{});request.end();await ready;assert.equal(readdirSync(root).length,1);request.destroy();await until(()=>readdirSync(root).length===0);}finally{edge.closeAllConnections();backend.closeAllConnections();await Promise.all([new Promise(resolve=>edge.close(resolve)),new Promise(resolve=>backend.close(resolve))]);rmdirSync(root);}
});
