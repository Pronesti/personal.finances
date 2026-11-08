import {test} from 'node:test';
import assert from 'node:assert/strict';
import {exportStreamLength} from './export-stream.mjs';
test('only private owner-authorized fixed-length ZIP responses on the export route stream',()=>{
 const headers={'content-type':'application/zip','content-disposition':'attachment; filename=financial.zip','cache-control':'no-store, private','x-content-type-options':'nosniff','content-length':String(68*1024*1024)};
 assert.equal(exportStreamLength('GET','/api/v1/exports/ledger',200,headers),68*1024*1024);
 for(const [method,path,status,changed] of [['POST','/api/v1/exports/ledger',200,headers],['GET','/api/v1/documents/hash',200,headers],['GET','/api/v1/exports/ledger',401,headers],['GET','/api/v1/exports/ledger',200,{...headers,'content-type':'application/json'}],['GET','/api/v1/exports/ledger',200,{...headers,'cache-control':'public'}],['GET','/api/v1/exports/ledger',200,{...headers,'content-length':'9007199254740992'}]])assert.equal(exportStreamLength(method,path,status,changed),null);
});
