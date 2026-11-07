import http from 'node:http';
import net from 'node:net';
import {readFileSync,realpathSync,lstatSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const MAX=48*1024*1024;
function record(type,payload=Buffer.alloc(0)){const header=Buffer.alloc(8);header[0]=1;header[1]=type;header.writeUInt16BE(1,2);header.writeUInt16BE(payload.length,4);return Buffer.concat([header,payload]);}
function length(size){if(size<128)return Buffer.from([size]);const value=Buffer.alloc(4);value.writeUInt32BE((size|0x80000000)>>>0);return value;}
export function params(values){return Buffer.concat(Object.entries(values).map(([name,value])=>{const a=Buffer.from(name),b=Buffer.from(String(value));return Buffer.concat([length(a.length),length(b.length),a,b]);}));}
export function createBridge(config){
 const script=realpathSync(config.script),publicRoot=realpathSync(config.publicRoot);
 if(script!==config.script||publicRoot!==config.publicRoot||lstatSync(config.socket).isSymbolicLink()||!lstatSync(config.socket).isSocket())throw new Error('Private FPM socket and canonical script required');
 return http.createServer({maxHeaderSize:16384},(request,response)=>{
  if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(request.socket.remoteAddress)){response.writeHead(403).end();return;}
  let size=0;const body=[];let socket;let done=false;
  function fail(status,code){if(done)return;done=true;socket?.destroy();if(!response.headersSent)response.writeHead(status,{'Content-Type':'application/json','Cache-Control':'private, no-store'}).end(JSON.stringify({error:{code}}));else response.destroy();}
  request.on('data',chunk=>{size+=chunk.length;if(size>MAX){fail(413,'too_large');request.resume();return;}if(!done)body.push(chunk);});
  request.on('aborted',()=>{done=true;socket?.destroy();});request.on('error',()=>fail(400,'upload_failed'));
  request.on('end',()=>{
   if(done)return;const url=new URL(request.url,'http://127.0.0.1');
   const environment={GATEWAY_INTERFACE:'CGI/1.1',SERVER_SOFTWARE:'tarjetas-private-fastcgi',SERVER_PROTOCOL:request.httpVersion==='1.1'?'HTTP/1.1':'HTTP/1.0',REQUEST_METHOD:request.method,REQUEST_URI:request.url,QUERY_STRING:url.search.slice(1),SCRIPT_FILENAME:script,SCRIPT_NAME:'/index.php',DOCUMENT_ROOT:publicRoot,REMOTE_ADDR:'127.0.0.1',REMOTE_PORT:String(request.socket.remotePort),SERVER_ADDR:'127.0.0.1',SERVER_NAME:request.headers.host??'localhost',SERVER_PORT:'443',HTTPS:'on',CONTENT_LENGTH:String(size)};
   for(const [name,value] of Object.entries(request.headers)){if(value===undefined)continue;const key=name==='content-type'?'CONTENT_TYPE':name==='content-length'?'CONTENT_LENGTH':'HTTP_'+name.toUpperCase().replaceAll('-','_');environment[key]=Array.isArray(value)?value.join(', '):value;}
   socket=net.createConnection(config.socket);socket.setTimeout(745000,()=>fail(504,'upstream_timeout'));let pending=Buffer.alloc(0),stdout=[],outSize=0,errSize=0;
   socket.on('connect',()=>{const begin=Buffer.alloc(8);begin.writeUInt16BE(1);socket.write(record(1,begin));const encoded=params(environment);for(let start=0;start<encoded.length;start+=65535)socket.write(record(4,encoded.subarray(start,start+65535)));socket.write(record(4));const input=Buffer.concat(body);body.length=0;for(let start=0;start<input.length;start+=65535)socket.write(record(5,input.subarray(start,start+65535)));socket.write(record(5));});
   socket.on('data',bytes=>{if(done)return;pending=Buffer.concat([pending,bytes]);while(pending.length>=8){if(pending[0]!==1||pending.readUInt16BE(2)!==1){fail(502,'invalid_fastcgi_response');return;}const count=pending.readUInt16BE(4),padding=pending[6],type=pending[1];if(pending.length<8+count+padding)return;const payload=pending.subarray(8,8+count);pending=pending.subarray(8+count+padding);
     if(type===6){outSize+=payload.length;if(outSize>64*1024*1024){fail(502,'upstream_response_limit');return;}stdout.push(payload);}
     if(type===7){errSize+=payload.length;if(errSize>65536){fail(502,'upstream_error_limit');return;}}
     if(type===3){if(payload.length<8||payload.readUInt32BE(0)!==0||payload[4]!==0){fail(502,'fastcgi_failure');return;}const result=Buffer.concat(stdout);const boundary=result.indexOf('\r\n\r\n');if(boundary<0||boundary>65536){fail(502,'invalid_fastcgi_headers');return;}const headers={};let status=200;for(const line of result.subarray(0,boundary).toString('latin1').split('\r\n')){const index=line.indexOf(':');if(index<1){fail(502,'invalid_fastcgi_headers');return;}const name=line.slice(0,index).toLowerCase(),value=line.slice(index+1).trim();if(name==='status'){status=Number.parseInt(value,10);}else if(name==='set-cookie'){(headers[name]??=[]).push(value);}else if(!['connection','transfer-encoding'].includes(name)){headers[name]=value;}}if(!Number.isInteger(status)||status<100||status>599){fail(502,'invalid_fastcgi_status');return;}done=true;socket.end();response.writeHead(status,headers).end(result.subarray(boundary+4));return;}
   }});socket.on('error',()=>fail(502,'upstream_unavailable'));socket.on('end',()=>{if(!done)fail(502,'upstream_incomplete');});
  });
 });
}
if(process.argv[1]===fileURLToPath(import.meta.url)){const filename=process.argv[2];if(!filename||realpathSync(filename)!==filename||(lstatSync(filename).mode&0o077))throw new Error('Private bridge config required');const config=JSON.parse(readFileSync(filename,'utf8'));const server=createBridge(config);server.requestTimeout=0;server.headersTimeout=0;server.timeout=0;server.listen(config.port,'127.0.0.1',()=>process.stdout.write(`Private FastCGI bridge on 127.0.0.1:${config.port}\n`));}
