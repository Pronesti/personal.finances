#!/usr/bin/env node
// Explicit optional macOS smoke check. Reads only the synthetic receipt; no database/server.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {fileURLToPath} from "node:url";
import {createRequire} from "node:module";
import {spawnSync} from "node:child_process";
const directory=path.dirname(fileURLToPath(import.meta.url));
const web=path.resolve(directory,"../../web");
const require=createRequire(path.join(web,"package.json"));
const {build}=require("esbuild");
if(process.platform!=="darwin")throw new Error("apple_vision_requires_macos");
const pdf=path.join(directory,"fixtures/pdf/synthetic_coto.pdf");
const contents=`import fs from 'node:fs';import assert from 'node:assert/strict';import {extractReceipt} from './src/lib/receipts/ingest';import {renderPages} from './src/lib/receipts/pdf';import {ocrPages} from './src/lib/receipts/ocr';try{const x=await extractReceipt(fs.readFileSync(${JSON.stringify(pdf)}),{renderPages,ocr:ocrPages});assert.equal(x.report.ok,true);assert.equal(x.parsed.footer.totalCents,13000);assert.equal(x.parsed.items.length,2);console.log(JSON.stringify({ok:true,totalCents:13000,items:2,scale:x.scale}));}catch(e){console.error(JSON.stringify({ok:false,code:e.code??'ocr_rejected',message:e.message,report:e.payload?.report}));process.exitCode=1;}`;
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),"tarjetas-rebuild-ocr-"));
try{
 const output=path.join(temporary,"verify.mjs");
 await build({stdin:{contents,resolveDir:web,loader:"ts"},outfile:output,bundle:true,platform:"node",format:"esm",alias:{"@":path.join(web,"src")},tsconfig:path.join(web,"tsconfig.json"),plugins:[{name:"installed-packages",setup(builder){builder.onResolve({filter:/^[^./]/},args=>args.path.startsWith("node:")||args.path.startsWith("@/")?undefined:{path:require.resolve(args.path),external:true});}}],logLevel:"warning"});
 const result=spawnSync(process.execPath,[output],{cwd:web,stdio:"inherit",env:process.env,timeout:240000});
 if(result.error)throw result.error;
 process.exitCode=result.status??1;
}finally{fs.rmSync(temporary,{recursive:true,force:true});}
