import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import https from 'node:https';
import {createBridge} from './fastcgi-bridge.mjs';
import {createIngress} from './server.mjs';
const enabled=process.env.TARJETAS_FPM_LOCAL_ACCEPTANCE==='1';const backend=fileURLToPath(new URL('..',import.meta.url)).replace(/\/$/,'');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check){const end=Date.now()+5000;while(!check()){if(Date.now()>end)throw new Error('Private FPM readiness timeout');await sleep(20);}}
async function listen(server){await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return server.address().port;}
test('real TLS FastCGI stateless liveness and credentialed CORS survive an unavailable database',{skip:!enabled,timeout:15000},async()=>{
 execFileSync('php',['artisan','tarjetas:test-target:check','--env=fpm-browser-testing'],{cwd:backend,stdio:'pipe'});
 const config=JSON.parse(readFileSync('/Users/pronestivm/.local/share/tarjetas-rebuild-acceptance/browser/temp/fpm/ingress.json','utf8'));
 const directory='/Users/pronestivm/.local/share/tarjetas-rebuild-acceptance/browser/temp/h-'+randomBytes(3).toString('hex');mkdirSync(directory,{mode:0o700});for(const part of ['uploads','tmp','contexts'])mkdirSync(directory+'/'+part,{mode:0o700});
 const cfg=Object.fromEntries(readFileSync(backend+'/.env.fpm-browser-testing','utf8').split('\n').filter(line=>line.includes('=')&&!line.startsWith('#')).map(line=>{const i=line.indexOf('=');return [line.slice(0,i),line.slice(i+1)];}));
 const key=randomBytes(32).toString('hex');const pool=readFileSync(backend+'/ingress/php-fpm.pool.example.conf','utf8').replaceAll('/absolute/private/runtime',directory).replaceAll('/absolute/private/uploads',directory+'/uploads').replaceAll('/absolute/private/temp',directory+'/tmp').replace('php-fpm.sock','f.sock');writeFileSync(directory+'/pool.conf',pool,{flag:'wx',mode:0o600});
 const env=Object.fromEntries(['PATH','HOME','USER','LOGNAME','LANG','LC_ALL','TMPDIR'].filter(name=>process.env[name]).map(name=>[name,process.env[name]]));
 // An unreachable DB endpoint in a private local fault pool exercises application failure, not disposable-target guard validation.
 const php=spawn('/Users/pronestivm/Library/Application Support/io.yerd.Yerd/php/php-8.5/sbin/php-fpm',['-F','-y',directory+'/pool.conf'],{cwd:backend,env:{...env,...cfg,APP_ENV:'local',DB_PORT:'1',TARJETAS_INGRESS_KEY:key,TARJETAS_INGRESS_ROOT:directory+'/contexts'},stdio:['ignore','pipe','pipe']});let bridge,edge;
 try{
  await until(()=>existsSync(directory+'/f.sock'));bridge=createBridge({socket:directory+'/f.sock',script:backend+'/public/index.php',publicRoot:backend+'/public'});const port=await listen(bridge);const settings={...config,key,root:directory+'/contexts',upstreamPort:port,origin:'https://api.tarjetas-browser.test:0'};edge=createIngress(settings);settings.origin='https://api.tarjetas-browser.test:'+await listen(edge);
  const ca=readFileSync('/Users/pronestivm/Library/Application Support/io.yerd.Yerd/ca.cert.pem');const origin='https://app.tarjetas-browser.test:8450';
  const request=(path,method='GET',headers={})=>new Promise((resolve,reject)=>{const req=https.request(settings.origin+path,{method,ca,headers:{Origin:origin,...headers}},response=>{let body='';response.on('data',bytes=>body+=bytes);response.on('end',()=>resolve({status:response.statusCode,headers:response.headers,body}));});req.on('error',reject);req.end();});
  const health=await request('/api/v1/health','GET',{Cookie:'tarjetas_browser_session=invalid; XSRF-TOKEN=invalid'});assert.equal(health.status,200);assert.deepEqual(JSON.parse(health.body),{status:'ok',service:'tarjetas-api',api_version:'v1'});assert.equal(health.headers['set-cookie'],undefined);assert.equal(health.headers['access-control-allow-origin'],origin);assert.equal(health.headers['access-control-allow-credentials'],'true');
  const options=await request('/api/v1/health','OPTIONS',{'Access-Control-Request-Method':'GET','Access-Control-Request-Headers':'X-XSRF-TOKEN'});assert.equal(options.status,204);assert.equal(options.headers['set-cookie'],undefined);assert.equal(options.headers['access-control-allow-origin'],origin);
  const protectedRoute=await request('/api/v1/bootstrap');assert.equal(protectedRoute.status,503);assert.equal(JSON.parse(protectedRoute.body).error.code,'database_unavailable');
 }finally{for(const server of [edge,bridge]){if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}}php.kill('SIGTERM');await until(()=>php.exitCode!==null||php.signalCode!==null);}
});
