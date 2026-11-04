import {deriveOpeningProof,type DerivedOpeningProof} from "./reconstruction-opening-proof";
import {registerOpeningObligationTx} from "./opening-obligations";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { Pool } from "pg";
import { accountingSchema, createPostgresLedger, migrateAccounting } from "./postgres";
import { seedActualCatalogCards } from "./catalog-service";
import { createLocalDocuments } from "./documents";
import { importStatement } from "./statement-import";
import { postJournalTx } from "./use-cases";
import { validDate } from "./journal";
import { sourceAmountMinor } from "./evidence";
import type { StatementJson } from "../integrity";
import { validateIdentityApproval } from "./reconstruction-approval";
import { reconstructionParity } from "./reconstruction-parity";
import { migrateLegacyOperations } from "./reconstruction-operations";
import type { Journal } from "./model";

export const LEGACY_TABLES = ["statements","transactions","upcoming_installments","alerts","alert_reviews","category_rules","category_proposals","rejected_merchants","merchant_aliases","receipts","receipt_items","receipt_discounts","receipt_transcripts","products","product_codes","product_rules","product_matches","receipt_charge_links"] as const;
export type CardRegistry = { cards: { id: string; displayName: string; statementFiles: string[] }[] };
export type ReconstructionInput = { sourceRoot: string; targetUrl: string; cutoffDate: string; mode: "historical"|"opening"; cardRegistry: CardRegistry; documentRoot: string; mappingPath?: string; productApprovalPath?:string; productProposalPath?:string; openingProofPath?:string; schema?: string; appRevision: string; openingEvidence?: {cardId:string;currency:"ARS"|"USD";observationDate:string;billedMinor:number;unbilledMinor:number;evidencePaths:string[]}[] };
export type ReconstructionReport = {
 sourceCounts: Record<string,number>; retainedCounts: Record<string,number>; postedCounts: Record<string,number>; reviewCounts: Record<string,number>;
 missingObjects: string[]; ambiguousIds: string[];
 unexplainedDifferences: {report:string;period:string;nativeMinor:number;reason:string}[];
 approvedDifferences: {decision:string;report:string;reason:string}[]; complete:boolean;
 runId:string; schema:string; sourceDigest:string; retentionDigest:string; objectDigest:string;
 sourceNativeTotals: Record<string,number>; retainedNativeTotals:Record<string,number>; journalNativeTotals:Record<string,number>;
 openingProof?:DerivedOpeningProof; sourceTableHashes:Record<string,string>; retainedTableHashes:Record<string,string>; unresolved: {id:string;code:string;currency?:string}[];
 nativeReportParity?:Awaited<ReturnType<typeof reconstructionParity>>; reportParityProven:boolean; reconciliation:{cardId:string;currency:string;issuerDate:string;issuerBilledMinor:number|null;ledgerBilledMinor:number;residualMinor:number|null;futureScheduleMinor:number;futurePrincipalSupported:boolean;ledgerUnbilledMinor:number;supportedUnbilledMinor:number;futureAggregateMinor:number;unsupportedFutureRemainderMinor:number;completeFuturePrincipalKnown:false}[];
 limitations:string[]; operationalCounts:Record<string,number>;
};
type Row = Record<string,unknown>;
const canonical = (v:unknown):string => JSON.stringify(order(v));
function order(v:unknown):unknown {return Array.isArray(v)?v.map(order):v!==null && typeof v==="object"?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,order(x)])):v;}
const sha=(bytes:Buffer|string):string=>createHash("sha256").update(bytes).digest("hex");
export function openingFromEvidence(input:{billedMinor:number;unbilledMinor:number;evidenceIds:string[]}):{billedMinor:number;unbilledMinor:number;expenseMinor:0} {
 if(![input.billedMinor,input.unbilledMinor,input.billedMinor+input.unbilledMinor].every(n=>Number.isSafeInteger(n)&&n>=0)||!input.evidenceIds.length||input.evidenceIds.some(id=>!id.trim())) throw Error("unsupported_opening_evidence");
 return {billedMinor:input.billedMinor,unbilledMinor:input.unbilledMinor,expenseMinor:0};
}
function files(root:string,relative=""):string[] {return fs.readdirSync(path.join(root,relative),{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).flatMap(e=>{const name=path.join(relative,e.name);if(e.isSymbolicLink())throw Error("source_symlink_rejected");return e.isDirectory()?files(root,name):e.isFile()?[name]:[];});}
function sumNative(rows:{table:string;id:string;payload:Row;hash:string}[], statements:Map<unknown,Row>):Record<string,number> {
 const totals:Record<string,number>={};
 for(const r of rows.filter(r=>r.table==="transactions")) for(const [field,currency] of [["ars","ARS"],["usd","USD"]] as const) {
  if(r.payload[field]===null || r.payload[field]===undefined)continue;
  const minor=sourceAmountMinor(Number(r.payload[field]));const period=String(statements.get(r.payload.statement_id)?.cycle_month??"unknown");const key=`${period}/${String(r.payload.section)}/${currency}`;
  totals[key]=(totals[key]??0)+minor;if(!Number.isSafeInteger(totals[key]))throw Error("unsafe_native_total");
 }
 return totals;
}
export async function reconstruct(input:ReconstructionInput):Promise<ReconstructionReport> {
 if(!validDate(input.cutoffDate)||!["opening","historical"].includes(input.mode)||!input.appRevision.trim())throw Error("invalid_reconstruction_configuration");
 const root=fs.realpathSync(input.sourceRoot);const objects=path.resolve(input.documentRoot);
 if(objects===root||objects.startsWith(`${root}${path.sep}`))throw Error("target_documents_must_be_outside_source");
 const sourceFiles=files(root);const dbFile=path.join(root,"data/app.db");
 if(!sourceFiles.includes("data/app.db"))throw Error("copied_database_required");
 if(input.openingEvidence && new Set(input.openingEvidence.map(e=>`${e.cardId}:${e.currency}`)).size!==input.openingEvidence.length)throw Error("ambiguous_opening_evidence");
 const db=new Database(dbFile,{readonly:true,fileMustExist:true});
 const rows:{table:string;id:string;payload:Row;hash:string}[]=[];
 const tableHashes:Record<string,string>={},counts:Record<string,number>={};
 try {
  db.pragma("query_only = ON");
  const found=(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as {name:string}[]).map(t=>t.name);
  if(canonical([...found].sort())!==canonical([...LEGACY_TABLES].sort()))throw Error("source_schema_inventory_changed");
  for(const table of LEGACY_TABLES) {
   const columns=db.prepare(`PRAGMA table_info("${table}")`).all() as {name:string;pk:number}[];
   const keys=columns.filter(c=>c.pk).sort((a,b)=>a.pk-b.pk).map(c=>c.name);
   const values=db.prepare(`SELECT rowid AS __legacy_rowid__, * FROM "${table}" ORDER BY rowid`).all() as Row[];
   counts[table]=values.length;
   for(const value of values) {const {__legacy_rowid__,...payload}=value;const id=canonical(keys.length?keys.map(k=>payload[k]):[__legacy_rowid__]);rows.push({table,id,payload,hash:sha(canonical(payload))});}
   tableHashes[table]=sha(canonical(rows.filter(r=>r.table===table).map(r=>[r.id,r.hash])));
  }
 } finally {db.close();}
 const manifest=sourceFiles.map(name=>{const bytes=fs.readFileSync(path.join(root,name));return {name,sha256:sha(bytes),byteLength:bytes.length};});
 const sourceDigest=sha(canonical({tables:tableHashes,files:manifest}));
 const assigned=new Map<string,string>();const cardIds=new Set<string>();
 for(const card of input.cardRegistry.cards) {
  if(!card.id.trim()||!card.displayName.trim()||cardIds.has(card.id))throw Error("invalid_card_registry");cardIds.add(card.id);
  for(const name of card.statementFiles) {if(assigned.has(name)||path.basename(name)!==name)throw Error("ambiguous_card_registry");assigned.set(name,card.id);}
 }
 const statements=rows.filter(r=>r.table==="statements");
 for(const s of statements)if(!assigned.has(String(s.payload.file)))throw Error(`statement_missing_explicit_card_identity:${String(s.payload.file)}`);
 const schema=accountingSchema(input.schema??`acct_test_${randomBytes(12).toString("hex")}`);
 const registryBytes=Buffer.from(canonical(input.cardRegistry));
 const mapping=input.mappingPath?fs.readFileSync(input.mappingPath):Buffer.from("null");
 const approvalBytes=input.productApprovalPath?fs.readFileSync(input.productApprovalPath):undefined;
 const proposalBytes=input.productProposalPath?fs.readFileSync(input.productProposalPath):undefined;
 if(!!approvalBytes!==!!proposalBytes)throw Error("migration_approval_requires_proposal");
 const identityApproval=approvalBytes&&proposalBytes?validateIdentityApproval(approvalBytes,proposalBytes,sourceDigest):undefined;
 const openingProofBytes=input.openingProofPath?fs.readFileSync(input.openingProofPath):undefined;
 if(openingProofBytes&&input.mode!=="opening")throw Error("opening_proof_requires_opening_mode");
 const openingProof=openingProofBytes?deriveOpeningProof({bytes:openingProofBytes,sourceRoot:root,rows,assignedCards:assigned,cutoffDate:input.cutoffDate}):undefined;
 const openingEvidence=[...(input.openingEvidence??[]),...(openingProof?.openings??[])];
 if(new Set(openingEvidence.map(e=>`${e.cardId}:${e.currency}`)).size!==openingEvidence.length)throw Error("ambiguous_opening_evidence");
 const configurationDigest=sha(canonical({sourceDigest,cutoffDate:input.cutoffDate,mode:input.mode,cards:input.cardRegistry,mapping:sha(mapping),revision:input.appRevision,openingEvidence,openingProofSha256:openingProofBytes?sha(openingProofBytes):null,identityApproval:approvalBytes?sha(approvalBytes):null}));
 const runId=`reconstruction:${configurationDigest}`;
 const pool=new Pool({connectionString:input.targetUrl,connectionTimeoutMillis:5000});
 try {
  const exists=await pool.query("SELECT to_regnamespace($1) AS name",[schema]);
  if(exists.rows[0].name) {
   const r=await pool.query(`SELECT r.configuration_digest,p.payload FROM "${schema}".reconstruction_runs r LEFT JOIN "${schema}".reconstruction_reports p ON p.run_id=r.id`);
   if(r.rows.length===1&&r.rows[0].configuration_digest===configurationDigest&&r.rows[0].payload)return r.rows[0].payload as ReconstructionReport;
   throw Error("target_not_fresh_or_incomplete_reconstruction");
  }
  await migrateAccounting(input.targetUrl,schema);
  const client=await pool.connect();
  const documents=createLocalDocuments(objects);
  try {
   await client.query("BEGIN");await client.query(`SET LOCAL search_path TO "${schema}",pg_catalog`);
   await client.query("INSERT INTO reconstruction_runs(id,source_digest,configuration_digest,cutoff_date,mode) VALUES($1,$2,$3,$4,$5)",[runId,sourceDigest,configurationDigest,input.cutoffDate,input.mode]);
   for(const row of rows)await client.query("INSERT INTO legacy_rows VALUES($1,$2,$3,$4,$5,$6,$7)",[runId,row.table,row.id,row.hash,row.payload,["transactions","category_rules","category_proposals","receipts","receipt_charge_links"].includes(row.table)?"review":"retained","Retained original source; financial/operational acceptance is separate"]);
   for(const file of manifest) {const ref=await documents.put(fs.readFileSync(path.join(root,file.name)));await client.query("INSERT INTO legacy_objects VALUES($1,$2,$3,$4,$5)",[runId,file.name,file.sha256,file.byteLength,ref.relativePath]);}
   const mapRef=await documents.put(mapping);await client.query("INSERT INTO legacy_objects VALUES($1,$2,$3,$4,$5)",[runId,"@mapping/proposal-review.json",mapRef.sha256,mapping.length,mapRef.relativePath]);
   for(const [name,bytes] of [["@mapping/card-registry.json",registryBytes],["@review/identity-approval.json",approvalBytes],["@review/identity-proposal.json",proposalBytes],["@opening/receipt-principal-proof.json",openingProofBytes]] as const)if(bytes){const ref=await documents.put(bytes);await client.query("INSERT INTO legacy_objects VALUES($1,$2,$3,$4,$5)",[runId,name,ref.sha256,bytes.length,ref.relativePath]);}
   await client.query("COMMIT");
  }catch(e){await client.query("ROLLBACK");throw e;}finally{client.release();}
  const port=createPostgresLedger(input.targetUrl,schema);
  const report:ReconstructionReport={runId,schema,sourceDigest,sourceCounts:counts,retainedCounts:{},postedCounts:{},reviewCounts:{},missingObjects:[],ambiguousIds:[],unexplainedDifferences:[],approvedDifferences:[],complete:false,retentionDigest:"",objectDigest:sha(canonical(manifest)),sourceNativeTotals:{},retainedNativeTotals:{},journalNativeTotals:{},sourceTableHashes:tableHashes,retainedTableHashes:{},unresolved:[],openingProof,reportParityProven:false,reconciliation:[],operationalCounts:{},limitations:["No live cutover date/mode or hosted runtime is selected by this rehearsal."]};
  try {
   await seedActualCatalogCards(port,input.cardRegistry.cards);
   const jsonSources=new Map<string,{json:StatementJson;raw:Buffer}>();
   for(const name of sourceFiles.filter(f=>f.startsWith("json/")&&f.endsWith(".json"))) {const raw=fs.readFileSync(path.join(root,name));const json=JSON.parse(raw.toString()) as StatementJson;if(jsonSources.has((path.basename(name,".json")+".pdf").replace(".upload.pdf",".pdf")))throw Error("duplicate_statement_json");jsonSources.set((path.basename(name,".json")+".pdf").replace(".upload.pdf",".pdf"),{json,raw});}
   const runRecordedAt=(await pool.query(`SELECT created_at FROM "${schema}".reconstruction_runs WHERE id=$1`,[runId])).rows[0].created_at as Date;
   const recordedAt=runRecordedAt.toISOString();
   {
    for(const statement of [...statements].sort((a,b)=>String(a.payload.closing_date).localeCompare(String(b.payload.closing_date))||a.id.localeCompare(b.id))) {
     if(String(statement.payload.closing_date)>input.cutoffDate)continue;
     const filename=String(statement.payload.file),source=jsonSources.get(filename.replace(".upload.pdf",".pdf")),pdf=sourceFiles.includes(`pdfs/${filename}`)?`pdfs/${filename}`:`pdfs/${filename.replace(".upload.pdf",".pdf")}`;
     if(!source||!sourceFiles.includes(pdf)){report.missingObjects.push(!source?`json:${filename}`:pdf);continue;}
     const result=await importStatement(port,documents,{key:`reconstruction:${statement.id}`,cardId:assigned.get(filename)!,filename,pdf:fs.readFileSync(path.join(root,pdf)),json:source.json,rawJson:source.raw,recordedAt,appRevision:input.appRevision,observationOnly:input.mode==="opening"});
     await pool.query(`INSERT INTO "${schema}".legacy_id_map VALUES($1,'statements',$2,'source_revision',$3) ON CONFLICT DO NOTHING`,[runId,statement.id,result.sourceRevisionId]);
     const legacyTx=rows.filter(r=>r.table==="transactions"&&r.payload.statement_id===statement.payload.id);
     const sourceLines=await pool.query(`SELECT id,occurrence,payload FROM "${schema}".source_lines WHERE revision_id=$1 ORDER BY occurrence`,[result.sourceRevisionId]);
     if(legacyTx.length!==sourceLines.rows.length) report.ambiguousIds.push(`statement:${statement.id}:line_count`);
     for(let i=0;i<legacyTx.length;i++) {const target=sourceLines.rows[i],legacy=legacyTx[i];if(!target||["description","date","ars","usd","installment_number","installment_count","section"].some(key=>(legacy.payload[key]??null)!==(target.payload[key]??null))) {report.ambiguousIds.push(`transactions:${legacy.id}`);continue;}await pool.query(`INSERT INTO "${schema}".legacy_id_map VALUES($1,'transactions',$2,'source_line',$3)`,[runId,legacy.id,target.id]);}
     for(const review of result.reviews){report.reviewCounts[review.code]=(report.reviewCounts[review.code]??0)+1;for(const id of review.sourceLineIds.length?review.sourceLineIds:[result.sourceRevisionId])report.unresolved.push({id,code:review.code,currency:typeof review.params.currency==="string"?review.params.currency:undefined});}
    }
   }
   if(input.mode==="opening") {
    // Latest issuer observation on/before cutoff only. A sum of old statement balances would duplicate debt.
    for(const card of input.cardRegistry.cards) {
     const latest=statements.filter(s=>assigned.get(String(s.payload.file))===card.id&&String(s.payload.closing_date)<=input.cutoffDate).sort((a,b)=>String(b.payload.closing_date).localeCompare(String(a.payload.closing_date)))[0];
     if(!latest){report.ambiguousIds.push(`card:${card.id}:missing_cutoff_statement`);continue;}
     const source=jsonSources.get(String(latest.payload.file).replace(".upload.pdf",".pdf"));
     if(!source){report.missingObjects.push(`json:${latest.payload.file}`);continue;}
     for(const [field,currency] of [["balance_ars","ARS"],["balance_usd","USD"]] as const) {
      const amount=latest.payload[field];if(amount===null||amount===undefined){report.ambiguousIds.push(`card:${card.id}:${currency}:unsupported_balance`);continue;}
      const explicit=openingEvidence.find(e=>e.cardId===card.id&&e.currency===currency);
      if(explicit && (explicit.observationDate!==String(latest.payload.closing_date)||explicit.billedMinor!==sourceAmountMinor(Number(amount))||!explicit.evidencePaths.length||explicit.evidencePaths.some(p=>!sourceFiles.includes(p))))throw Error("unsupported_opening_evidence");
      const billed=explicit?.billedMinor??sourceAmountMinor(Number(amount));
      const unbilled=explicit?.unbilledMinor??0;
      if(String(latest.payload.closing_date)!==input.cutoffDate)report.ambiguousIds.push(`card:${card.id}:${currency}:cutoff_activity_not_reconciled`);
      // Issuer monthly future totals are retained, but do not establish principal (may contain unknown costs).
      const schedule=rows.filter(r=>r.table==="upcoming_installments"&&r.payload.statement_id===latest.payload.id);
      if(currency==="ARS"&&schedule.reduce((sum,r)=>sum+sourceAmountMinor(Number(r.payload.amount_ars)),0)>unbilled)report.ambiguousIds.push(`card:${card.id}:unbilled_principal_requires_review`);
      if(billed<0){report.ambiguousIds.push(`card:${card.id}:${currency}:credit_balance_requires_review`);continue;}
      if(!billed&&!unbilled)continue;
      const evidenceId=`opening:${sha(`${runId}:${card.id}:${currency}`)}`;
      await pool.query(`INSERT INTO "${schema}".evidence VALUES($1,'statement',$2)`,[evidenceId,{legacyStatementId:latest.id,sourceFile:latest.payload.file,cutoffDate:input.cutoffDate,observationDate:explicit?.observationDate??latest.payload.closing_date,supportedEvidencePaths:explicit?.evidencePaths??[],openingProofSha256:openingProofBytes?sha(openingProofBytes):null}]);
      const supported=openingFromEvidence({billedMinor:billed,unbilledMinor:unbilled,evidenceIds:[evidenceId]});
      const journal:Journal={id:evidenceId,commandKey:evidenceId,cardId:card.id,currency,effectiveDate:explicit?.observationDate??String(latest.payload.closing_date),recordedAt,kind:"opening",reversesId:null,evidenceIds:[evidenceId],lines:[{accountId:"equity:opening",debitMinor:supported.billedMinor+supported.unbilledMinor,creditMinor:0,purchaseId:null,purposeId:null},...([{accountId:`${card.id}:${currency}:billed`,debitMinor:0,creditMinor:supported.billedMinor,purchaseId:null,purposeId:null},{accountId:`${card.id}:${currency}:unbilled`,debitMinor:0,creditMinor:supported.unbilledMinor,purchaseId:null,purposeId:null}].filter(l=>l.creditMinor>0))]};
      await port.transaction(async tx=>{
       await postJournalTx(tx,journal,sha(canonical(journal)));
       if(supported.billedMinor>0)await tx.appendBilling({id:journal.id,journalId:journal.id,purchaseId:null,origin:"opening_balance",cardId:card.id,currency,installment:1,amountMinor:supported.billedMinor,effectiveDate:journal.effectiveDate,purchaseDate:journal.effectiveDate,components:[{id:`${journal.id}:billed`,purposeId:null,minor:supported.billedMinor}]});
      });
     }
    }
    report.limitations.push("Opening billed balance is supported only at its issuer observation date; activity between that date and cutoff requires reconciliation. Future schedule totals are not assumed principal.");
   }
   const operations=await migrateLegacyOperations({rows,root,files:sourceFiles,schema,runId,pool,port,documents,recordedAt,appRevision:input.appRevision,identityApproval,approvalSha256:approvalBytes?sha(approvalBytes):undefined,sourceDigest});
   if(openingProof)await port.transaction(async tx=>{
    for(const component of openingProof.components) {
     const receipt=rows.find(r=>r.table==="receipts"&&r.payload.id===component.legacyReceiptId);
     if(!receipt)throw Error("opening_component_receipt_missing");
     const receiptMap=await pool.query(`SELECT target_id FROM "${schema}".legacy_id_map WHERE run_id=$1 AND table_name='receipts' AND source_id=$2 AND target_kind='receipt_revision'`,[runId,receipt.id]);
     if(receiptMap.rows.length!==1)throw Error("opening_component_receipt_mapping_missing");
     const evidenceIds=[String(receiptMap.rows[0].target_id)];
     for(const legacyId of component.legacyTransactionIds) {
      const row=rows.find(r=>r.table==="transactions"&&r.payload.id===legacyId);
      const map=row?await pool.query(`SELECT target_id FROM "${schema}".legacy_id_map WHERE run_id=$1 AND table_name='transactions' AND source_id=$2 AND target_kind='source_line'`,[runId,row.id]):null;
      if(map?.rows.length!==1)throw Error("opening_component_statement_mapping_missing");evidenceIds.push(String(map.rows[0].target_id));
     }
     await registerOpeningObligationTx(tx,{id:`opening-obligation:${sourceDigest}:receipt:${component.legacyReceiptId}:ARS`,cardId:component.cardId,currency:component.currency,openingJournalId:`opening:${sha(`${runId}:${component.cardId}:${component.currency}`)}`,evidenceIds,originalPrincipalMinor:component.originalPrincipalMinor,alreadyBilledMinor:component.alreadyBilledMinor,remainingMinor:component.remainingMinor,purchaseDate:component.purchaseDate,lastBilledInstallment:component.lastBilledInstallment,installmentCount:component.installmentCount,allocations:[{purposeId:"unallocated",minor:component.remainingMinor}]});
    }
   });
   report.operationalCounts=operations.counts;report.unresolved.push(...operations.issues);
   for(const issue of operations.issues)report.reviewCounts[issue.code]=(report.reviewCounts[issue.code]??0)+1;
   const retained=await pool.query(`SELECT table_name,source_id,row_hash,payload FROM "${schema}".legacy_rows WHERE run_id=$1 ORDER BY table_name,source_id`,[runId]);
   for(const table of LEGACY_TABLES) {const actual=retained.rows.filter(r=>r.table_name===table);report.retainedCounts[table]=actual.length;const source=rows.filter(r=>r.table===table);report.retainedTableHashes[table]=sha(canonical(source.map(s=>{const r=actual.find(r=>r.source_id===s.id);return [r?.source_id,r?sha(canonical(r.payload)):null];})));if(report.retainedTableHashes[table]!==tableHashes[table])report.ambiguousIds.push(`table:${table}:retention_hash`);}
   report.retentionDigest=sha(canonical(report.retainedTableHashes));
   const statementMap=new Map(statements.map(s=>[s.payload.id,s.payload]));
   report.sourceNativeTotals=sumNative(rows,statementMap);
   report.retainedNativeTotals=sumNative(retained.rows.map(r=>({table:r.table_name,id:r.source_id,hash:r.row_hash,payload:r.payload})),statementMap);
   const journalTotals=await pool.query(`SELECT j.currency,j.kind,to_char(j.effective_date,'YYYY-MM') AS period,sum(l.debit_minor)::text AS debits,count(DISTINCT j.id)::int AS count FROM "${schema}".journals j JOIN "${schema}".journal_lines l ON l.journal_id=j.id WHERE j.status='posted' GROUP BY j.currency,j.kind,period ORDER BY j.currency,j.kind,period`);
   for(const r of journalTotals.rows) {report.journalNativeTotals[`${r.period}/${r.kind}/${r.currency}`]=Number(r.debits);report.postedCounts[r.kind]=(report.postedCounts[r.kind]??0)+r.count;}
   const objectRows=await pool.query(`SELECT * FROM "${schema}".legacy_objects WHERE run_id=$1`,[runId]);
   for(const object of objectRows.rows)try {const bytes=await documents.read({sha256:object.sha256,relativePath:object.object_path});if(bytes.length!==Number(object.byte_length))report.missingObjects.push(object.source_path);}catch{report.missingObjects.push(object.source_path);}
   for(const card of input.cardRegistry.cards) {
    const latest=statements.filter(s=>assigned.get(String(s.payload.file))===card.id&&String(s.payload.closing_date)<=input.cutoffDate).sort((a,b)=>String(b.payload.closing_date).localeCompare(String(a.payload.closing_date)))[0];
    if(!latest)continue;
    for(const [field,currency] of [["balance_ars","ARS"],["balance_usd","USD"]] as const) {
     const issuerBilledMinor=latest.payload[field]===null||latest.payload[field]===undefined?null:sourceAmountMinor(Number(latest.payload[field]));
     const balance=await pool.query(`SELECT coalesce(sum(l.credit_minor-l.debit_minor),0)::text AS minor FROM "${schema}".journal_lines l JOIN "${schema}".journals j ON j.id=l.journal_id WHERE j.status='posted' AND l.account_id=$1 AND j.effective_date<=$2`,[`${card.id}:${currency}:billed`,latest.payload.closing_date]);
     const ledgerBilledMinor=Number(balance.rows[0].minor);
     const unbilled=await pool.query(`SELECT coalesce(sum(l.credit_minor-l.debit_minor),0)::text AS minor FROM "${schema}".journal_lines l JOIN "${schema}".journals j ON j.id=l.journal_id WHERE j.status='posted' AND l.account_id=$1 AND j.effective_date<=$2`,[`${card.id}:${currency}:unbilled`,latest.payload.closing_date]);
     const ledgerUnbilledMinor=Number(unbilled.rows[0].minor),supportedUnbilledMinor=openingEvidence.find(e=>e.cardId===card.id&&e.currency===currency)?.unbilledMinor??0;
     if(input.mode==="opening"&&ledgerUnbilledMinor!==supportedUnbilledMinor)report.unexplainedDifferences.push({report:`supported-unbilled/${card.id}/${currency}`,period:String(latest.payload.closing_date),nativeMinor:ledgerUnbilledMinor-supportedUnbilledMinor,reason:"Posted opening unbilled liability differs from supported evidence"});
     const schedule=rows.filter(r=>r.table==="upcoming_installments"&&r.payload.statement_id===latest.payload.id);
     const futureScheduleMinor=currency==="ARS"?schedule.reduce((sum,r)=>sum+sourceAmountMinor(Number(r.payload.amount_ars)),0):0;
     report.reconciliation.push({cardId:card.id,currency,issuerDate:String(latest.payload.closing_date),issuerBilledMinor,ledgerBilledMinor,residualMinor:issuerBilledMinor===null?null:issuerBilledMinor-ledgerBilledMinor,futureScheduleMinor,futurePrincipalSupported:false,ledgerUnbilledMinor,supportedUnbilledMinor,futureAggregateMinor:futureScheduleMinor,unsupportedFutureRemainderMinor:Math.max(0,futureScheduleMinor-(openingEvidence.find(e=>e.cardId===card.id&&e.currency===currency)?.unbilledMinor??0)),completeFuturePrincipalKnown:false});
     if(issuerBilledMinor!==null && issuerBilledMinor!==ledgerBilledMinor)report.unexplainedDifferences.push({report:`issuer-billed/${card.id}/${currency}`,period:String(latest.payload.closing_date),nativeMinor:ledgerBilledMinor-issuerBilledMinor,reason:"Partial historical postings do not reconstruct supported opening debt, unsupported principal or credits. Requires separately scoped opening reconciliation; not waived by pending review."});
    }
   }
   // Review does not exempt any report difference. This compares retained historical analytics only.
   for(const key of new Set([...Object.keys(report.sourceNativeTotals),...Object.keys(report.retainedNativeTotals)]))if(report.sourceNativeTotals[key]!==report.retainedNativeTotals[key])report.unexplainedDifferences.push({report:key,period:key.split('/')[0],nativeMinor:(report.retainedNativeTotals[key]??0)-(report.sourceNativeTotals[key]??0),reason:"retained_source_native_amount_drift"});
   report.nativeReportParity=await reconstructionParity({rows,runId,schema,url:input.targetUrl,pool});
   for(const key of report.nativeReportParity.result.unexplained) {const clean=key.replace(/:coverage$/,"");report.unexplainedDifferences.push({report:clean,period:clean.split("/")[1]??"all",nativeMinor:(report.nativeReportParity.after.values[clean]??0)-(report.nativeReportParity.before.values[clean]??0),reason:key.endsWith(":coverage")?"Canonical report coverage differs from original source identities":"Canonical native report value differs from original source"});}
   for(const check of [report.nativeReportParity.economic.acquisitions,report.nativeReportParity.economic.associations])for(const key of check.result.unexplained) {const clean=key.replace(/:coverage$/,"");report.unexplainedDifferences.push({report:clean,period:clean.split("/")[1]??"all",nativeMinor:(check.after.values[clean]??0)-(check.before.values[clean]??0),reason:"Canonical economic acquisition or historical association coverage/value differs from retained evidence; no blanket policy exemption"});}
   report.limitations.push("Native billed/charge/payment and latest-issuer-schedule snapshots are tested directly. Full economic purchase recognition remains incomplete for unsupported principal/financial nature; no blanket Q8 numerical exemptions apply.");
   report.reportParityProven=report.nativeReportParity.result.unexplained.length===0&&report.unexplainedDifferences.length===0&&report.unresolved.length===0&&report.ambiguousIds.length===0;
   const finalFiles=files(root);
   if(canonical(finalFiles)!==canonical(sourceFiles)||manifest.some(file=>sha(fs.readFileSync(path.join(root,file.name)))!==file.sha256))throw Error("source_changed_during_reconstruction");
   report.complete=report.reportParityProven&&report.missingObjects.length===0&&report.ambiguousIds.length===0&&report.unexplainedDifferences.length===0&&report.unresolved.length===0;
   await pool.query(`INSERT INTO "${schema}".reconstruction_reports VALUES($1,$2)`,[runId,report]);
   return report;
  } finally {await port.close();}
 }finally{await pool.end();}
}
