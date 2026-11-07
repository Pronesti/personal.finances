import {test} from 'node:test';
import assert from 'node:assert/strict';
import {uploadEnvelope} from './upload-envelope.mjs';
const boundary='tarjetas-synthetic-boundary';
function multipart(parts){return Buffer.concat([...parts.map(([name,value,file])=>Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"${file?'; filename="synthetic.pdf"':''}\r\n\r\n`),Buffer.isBuffer(value)?value:Buffer.from(value),Buffer.from('\r\n')])),Buffer.from(`--${boundary}--\r\n`)]);}
const check=(parts,path='/api/v1/receipts')=>uploadEnvelope('POST',path,`multipart/form-data; boundary=${boundary}`,multipart(parts));
test('single PDF limits stay inclusive and framing has an independent exact 1 MiB ceiling',()=>{
 for(const [route,size] of [['statements',10*1024*1024],['receipts',40*1024*1024]]){
  const parts=[['file',Buffer.alloc(size),true],['cardId','synthetic-visa-a']];
  assert.equal(check(parts,'/api/v1/'+route+'/import'),null);
  assert.deepEqual(check([['file',Buffer.alloc(size+1),true]],'/api/v1/'+route),{status:400,code:'too_large'});
 }
 const base=[['file','%PDF-1.4',true],['extra','']];
 const framing=multipart(base).length-8;
 base[1][1]='a'.repeat(1024*1024-framing);assert.equal(check(base),null);
 base[1][1]+='a';assert.deepEqual(check(base),{status:413,code:'too_large'});
});
test('extra/duplicate/nested file parts and excessive field counts fail before PHP truncation',()=>{
 for(const parts of [[['file','a',true],['extra','b',true]],[['file','a',true],['file','b',true]],[['file[]','a',true]],Array.from({length:33},(_,i)=>['field'+i,'x'])])assert.deepEqual(check(parts),{status:400,code:'invalid_upload_envelope'});
 assert.equal(check([['file','%PDF-1.4\r\n--'+boundary+'not-a-boundary',true]]),null);
 assert.deepEqual(uploadEnvelope('POST','/api/v1/%72eceipts','multipart/form-data; boundary=missing',multipart([['file','x',true]])),{status:400,code:'invalid_upload_envelope'});
 assert.equal(uploadEnvelope('POST','/api/v1/receipts/corrections','application/json',Buffer.from('{}')),null);
});
