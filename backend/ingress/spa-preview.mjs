import https from 'node:https';
import {readFileSync,realpathSync,lstatSync,statSync,existsSync} from 'node:fs';
import path from 'node:path';
/** Local production-artifact acceptance only; no global proxy or production hosting choice. */
const filename=process.argv[2];
if(!filename||realpathSync(filename)!==filename||(lstatSync(filename).mode&0o077))throw new Error('Private absolute preview configuration required');
const config=JSON.parse(readFileSync(filename,'utf8'));const root=realpathSync(config.root);const origin=new URL(config.origin);const api=new URL(config.apiOrigin);
if(root!==config.root||origin.protocol!=='https:'||api.protocol!=='https:')throw new Error('Invalid preview configuration');
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.ico':'image/x-icon'};
https.createServer({key:readFileSync(config.tlsKey),cert:readFileSync(config.tlsCert)},(request,response)=>{
 const headers={'X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin','Cross-Origin-Opener-Policy':'same-origin','Content-Security-Policy':`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src ${api.origin}; img-src 'self' data:; font-src 'self'; frame-src 'self' blob:; object-src blob:; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`};
 if(request.headers.host!==origin.host||!['GET','HEAD'].includes(request.method)){response.writeHead(400,headers).end();return;}
 let pathname;try{pathname=decodeURIComponent(new URL(request.url,origin).pathname);}catch{response.writeHead(400,headers).end();return;}
 let file=path.resolve(root,'.'+pathname);if(!file.startsWith(root+path.sep)&&file!==root){response.writeHead(404,headers).end();return;}
 for(let segment=root;segment!==file;){const relative=path.relative(segment,file).split(path.sep)[0];segment=path.join(segment,relative);if(existsSync(segment)&&lstatSync(segment).isSymbolicLink()){response.writeHead(404,headers).end();return;}if(!existsSync(segment))break;}
 if(!existsSync(file)||!statSync(file).isFile()){if(path.extname(file)){response.writeHead(404,headers).end();return;}file=path.join(root,'index.html');}
 const type=mime[path.extname(file)];if(!type){response.writeHead(404,headers).end();return;}const bytes=readFileSync(file);response.writeHead(200,{...headers,'Content-Type':type,'Content-Length':bytes.length,'Cache-Control':path.extname(file)==='.html'?'no-store':'public, max-age=31536000, immutable'}).end(request.method==='HEAD'?undefined:bytes);
}).listen(config.port,'127.0.0.1',()=>process.stdout.write(`Local built SPA preview on 127.0.0.1:${config.port}\n`));
