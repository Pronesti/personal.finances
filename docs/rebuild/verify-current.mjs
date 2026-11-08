#!/usr/bin/env node
// Runs synthetic contracts without .env loading, a server, PostgreSQL, OCR, or network calls.
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
const temp=fs.mkdtempSync(path.join(os.tmpdir(),"tarjetas-rebuild-verify-"));
try {
  const output=path.join(temp,"verify.cjs");
  await build({entryPoints:[path.join(directory,"verify-current.ts")],outfile:output,bundle:true,platform:"node",format:"cjs",packages:"external",alias:{"@":path.join(web,"src")},tsconfig:path.join(web,"tsconfig.json"),logLevel:"warning"});
  const result=spawnSync(process.execPath,[output,directory],{stdio:"inherit",env:{...process.env,NODE_PATH:path.join(web,"node_modules")}});
  if(result.error)throw result.error;
  process.exitCode=result.status??1;
} finally { fs.rmSync(temp,{recursive:true,force:true}); }
