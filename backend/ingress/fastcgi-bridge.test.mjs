import {test} from 'node:test';
import assert from 'node:assert/strict';
import {params} from './fastcgi-bridge.mjs';
function decode(bytes){let offset=0;const length=()=>{if(bytes[offset]&128){const result=bytes.readUInt32BE(offset)&0x7fffffff;offset+=4;return result;}return bytes[offset++];};const result={};while(offset<bytes.length){const a=length(),b=length();const name=bytes.subarray(offset,offset+a).toString();offset+=a;result[name]=bytes.subarray(offset,offset+b).toString();offset+=b;}return result;}
test('FastCGI name/value framing preserves long cookies, UTF-8 and empty values',()=>{const values={HTTP_COOKIE:'x'.repeat(2048),REQUEST_URI:'/api/v1/receipts',CONTENT_LENGTH:'41943040',['L'.repeat(128)]:'á'.repeat(200),EMPTY:''};assert.deepEqual(decode(params(values)),values);});
