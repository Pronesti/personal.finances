import {recordHistoricalAssociation} from "./historical-links";
import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";
import type {LedgerPort} from "./port";
import type {DocumentStore} from "./documents";
import type {MigrationIdentityApproval} from "./reconstruction-approval";
import {createProductTx,reviewReceiptItem,type ReviewSubject,type MatchSubject} from "./review";
import {importReceipt} from "./receipt-import";
import {parseRows} from "../receipts/parse";
import {parseRowsText} from "../receipts/rows";
import {verify} from "../receipts/verify";
import {isProductCategory} from "../receipts/categories";
import type {Pool} from "pg";
type Row={table:string;id:string;payload:Record<string,unknown>;hash:string};
const hash=(text:string)=>createHash("sha256").update(text).digest("hex");
/** Translates retained source identities into the actual operational schema; never posts from guessed categories. */
export async function migrateLegacyOperations(input:{rows:Row[];root:string;files:string[];schema:string;runId:string;pool:Pool;port:LedgerPort;documents:DocumentStore;recordedAt:string;appRevision:string;identityApproval?:MigrationIdentityApproval;approvalSha256?:string;sourceDigest:string}):Promise<{counts:Record<string,number>;issues:{id:string;code:string}[]}> {
 const {rows,root,files,schema,runId,pool,port,documents,recordedAt,appRevision}=input;
 const mappedRows=new Set<string>();
 const counts:Record<string,number>={},issues:{id:string;code:string}[]=[];
 const select=(table:string)=>rows.filter(r=>r.table===table);
 const mapped=async(row:Row,kind:string,id:string)=>{await pool.query(`INSERT INTO "${schema}".legacy_id_map VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,[runId,row.table,row.id,kind,id]);if(!mappedRows.has(`${row.table}:${row.id}`)){counts[row.table]=(counts[row.table]??0)+1;mappedRows.add(`${row.table}:${row.id}`);}};
 const productMap=new Map<unknown,string>();
 for(const row of select("products")) {
  const p=row.payload;
  if(!isProductCategory(p.category)||!["un","kg"].includes(String(p.unit))) {issues.push({id:row.id,code:"legacy_product_shape_review"});continue;}
  const id=await port.transaction(tx=>createProductTx(tx,{name:String(p.name),category:p.category as Parameters<typeof createProductTx>[1]["category"],unit:p.unit as "un"|"kg",reviewed:p.needs_review===0}));
  productMap.set(p.id,id);await mapped(row,"product",id);
 }
 const append=async(subject:ReviewSubject)=>port.transaction(async tx=>{
  const existing=await tx.reviewSubject(subject.kind,subject.id);
  if(subject.kind==="merchant"&&existing?.kind==="merchant")subject={...existing,...subject,redirectId:subject.redirectId??existing.redirectId};
  await tx.appendReviewSubject(subject);
 });
 for(const row of select("product_codes")) {
  const p=row.payload,id=JSON.stringify([p.chain,p.sku]),productId=productMap.get(p.product_id);
  if(!productId){issues.push({id:row.id,code:"legacy_product_reference_missing"});continue;}
  await append({kind:"code",id,chain:String(p.chain),sku:String(p.sku),productId,...{ean:p.ean===null?null:String(p.ean),legacySourceId:row.id}});await mapped(row,"code",id);
 }
 for(const row of select("product_rules")) {
  const p=row.payload,productId=productMap.get(p.product_id),id=`legacy:product-rule:${row.id}`;
  if(!productId){issues.push({id:row.id,code:"legacy_product_reference_missing"});continue;}
  await append({kind:"product_rule",id,chain:String(p.chain),match:String(p.match),productId,position:Number(p.position)});await mapped(row,"product_rule",id);
 }
 // Original ordered aliases are represented as authored identities/redirects, independent of translations.
 for(const row of select("merchant_aliases")) {
  const p=row.payload,normalizedName=String(p.match).toUpperCase(),alias=String(p.alias).toUpperCase(),target=hash(alias),id=hash(normalizedName);
  await append({kind:"merchant",id:target,normalizedName:alias,redirectId:null,displayName:String(p.alias)});
  await append({kind:"merchant",id,normalizedName,redirectId:id===target?null:target,displayName:String(p.alias),position:Number(p.position)});await mapped(row,"merchant",id);
 }
 // Old taxonomy is evidence; its rule order stays available, but cannot authorize a new chart account.
 for(const row of select("category_rules")) {
  const p=row.payload,id=`legacy:category-rule:${row.id}`;
  await append({kind:"rule",id,match:String(p.match).toUpperCase(),accountId:"expense:unallocated",purposeId:"unallocated",position:Number(p.position),enabled:false,...{legacyCategory:p.category,legacySubcategory:p.subcategory}});await mapped(row,"rule",id);
 }
 for(const row of select("category_proposals")) {
  const p=row.payload,merchant=String(p.merchant).toUpperCase(),merchantId=hash(merchant),id=`legacy:proposal:${row.id}`;
  await append({kind:"merchant",id:merchantId,normalizedName:merchant,redirectId:null});
  await append({kind:"proposal",id,merchantId,sanitizedMerchant:String(p.sent),state:"pending",evidence:{sent:String(p.sent),confidence:p.confidence==="high"?"high":"low",legacyCategory:String(p.category),legacySubcategory:p.subcategory===null?undefined:String(p.subcategory)}});await mapped(row,"proposal",id);
 }
 for(const row of select("rejected_merchants")) {const merchant=String(row.payload.merchant),merchantId=hash(merchant.toUpperCase());await append({kind:"merchant",id:merchantId,normalizedName:merchant.toUpperCase(),redirectId:null});await append({kind:"rejection",id:merchant,merchantId});await mapped(row,"rejection",merchant);}
 for(const row of select("alert_reviews")) {const p=row.payload,id=String(p.key);if(!["open","reviewed","dismissed"].includes(String(p.state))){issues.push({id:row.id,code:"legacy_alert_state_review"});continue;}await append({kind:"alert",id,state:p.state as "open"|"reviewed"|"dismissed"});await mapped(row,"alert",id);}
 const receiptLines=new Map<unknown,{revisionId:string;lineId:string}>();
 for(const row of select("receipts")) {
  const p=row.payload,pdf=files.find(f=>f.endsWith(`/${p.file_sha256}.pdf`));
  const transcripts=select("receipt_transcripts").filter(t=>t.payload.receipt_id===p.id),original=transcripts.find(t=>t.payload.kind==="ocr"),corrected=transcripts.find(t=>t.payload.kind==="corrected");
  if(!pdf||!original){issues.push({id:row.id,code:!pdf?"legacy_receipt_pdf_missing":"legacy_receipt_transcript_missing"});continue;}
  const rowsText=String(original.payload.text),parsed=parseRows(parseRowsText(rowsText));
  const legacyItems=select("receipt_items").filter(i=>i.payload.receipt_id===p.id).sort((a,b)=>Number(a.payload.position)-Number(b.payload.position));
  const effective=parseRows(parseRowsText(corrected?String(corrected.payload.text):rowsText));
  if(effective.items.length!==legacyItems.length || effective.items.some((item,i)=>item.lineTotalCents!==legacyItems[i].payload.line_total_cents||item.descPrinted!==legacyItems[i].payload.desc_printed)){issues.push({id:row.id,code:"legacy_receipt_line_identity_drift"});continue;}
  const legacyProductMatches=legacyItems.map((item,i)=>{const match=select("product_matches").find(m=>m.payload.item_id===item.payload.id);const productId=match?productMap.get(match.payload.product_id):undefined;if(!match||!productId)throw Error("legacy_receipt_product_reference_missing");return {occurrence:i+1,productId,method:match.payload.method as MatchSubject["method"],reviewed:false};});
  const result=await importReceipt(port,documents,{key:`legacy:${row.id}`,bytes:fs.readFileSync(path.join(root,pdf)),extraction:{rowsText,parsed,report:verify(parsed),scale:Number(p.ocr_scale)},correctedRowsText:corrected?String(corrected.payload.text):null,recordedAt,appRevision,legacyProductMatches});
  await mapped(row,"receipt_revision",result.sourceRevisionId);
  const facts=await port.transaction(tx=>tx.receiptFacts(result.sourceRevisionId));
  if(facts)await mapped(row,"receipt",String(facts.receiptId));
  for(const t of transcripts)await mapped(t,"receipt_revision",result.sourceRevisionId);
  const items=select("receipt_items").filter(i=>i.payload.receipt_id===p.id).sort((a,b)=>Number(a.payload.position)-Number(b.payload.position));
  const target=await port.transaction(tx=>tx.sourceLines(result.sourceRevisionId));
  if(items.length!==target.length){issues.push({id:row.id,code:"legacy_receipt_line_count_drift"});continue;}
  for(let i=0;i<items.length;i++) {
   const old=items[i],line=target[i];
   if(old.payload.line_total_cents!==line.payload.lineTotalCents || old.payload.desc_printed!==line.payload.descPrinted) {issues.push({id:old.id,code:"legacy_receipt_line_identity_drift"});continue;}
   receiptLines.set(old.payload.id,{revisionId:result.sourceRevisionId,lineId:line.id});await mapped(old,"source_line",line.id);
   const discounts=select("receipt_discounts").filter(d=>d.payload.item_id===old.payload.id).sort((a,b)=>Number(a.payload.position)-Number(b.payload.position));
   for(let j=0;j<discounts.length;j++)await mapped(discounts[j],"receipt_discount",`${line.id}:discount:${j}`);
  }
  for(const review of result.reviews)issues.push({id:row.id,code:review.code});
 }
 for(const row of select("product_matches")) {
  const p=row.payload,line=receiptLines.get(p.item_id),productId=productMap.get(p.product_id);
  if(!line||!productId){issues.push({id:row.id,code:"legacy_match_reference_missing"});continue;}
  const subject:MatchSubject={kind:"match",id:line.lineId,receiptRevisionId:line.revisionId,sourceLineId:line.lineId,productId,method:p.method as MatchSubject["method"],reviewed:false};
  await append(subject);await mapped(row,"match",subject.id);
 }
 for(const oldId of input.identityApproval?.approvedLegacyItemIds??[]) {
  const item=select("receipt_items").find(r=>r.payload.id===oldId),match=select("product_matches").find(r=>r.payload.item_id===oldId),line=receiptLines.get(oldId),productId=match?productMap.get(match.payload.product_id):undefined;
  if(!item||!match||!line||!productId)throw Error("migration_approved_item_missing");
  const key=`migration:${input.approvalSha256}:${oldId}`;
  await reviewReceiptItem(port,{key,receiptRevisionId:line.revisionId,sourceLineId:line.lineId,productId,recordedAt:input.identityApproval!.recordedAt});
  await port.transaction(async tx=>{
   const previous=(await tx.reviewDecisions(line.lineId)).at(-1),id=`migration:identity-provenance:${input.approvalSha256}:${oldId}`;
   await tx.appendReview({id,key:id,digest:input.approvalSha256!,subjectId:line.lineId,kind:"product_match",payload:{approvalSha256:input.approvalSha256,sourceDigest:input.sourceDigest,reviewer:input.identityApproval!.reviewer,scope:input.identityApproval!.scope,legacyItemId:oldId,productId},priorDecisionId:previous?.id??null,recordedAt:input.identityApproval!.recordedAt,affectedIds:[line.lineId]});
  });
 }
 for(const row of select("product_matches"))if(!input.identityApproval?.approvedLegacyItemIds.includes(Number(row.payload.item_id)))issues.push({id:`receipt-item:${row.payload.item_id}`,code:"legacy_product_identity_pending"});
 // Exact old links attach accepted receipt evidence to the uniquely mapped statement line without financial recognition.
 for(const row of select("receipt_charge_links")) {
  const receipt=select("receipts").find(r=>r.payload.id===row.payload.receipt_id);
  const revision=receipt?await pool.query(`SELECT target_id FROM "${schema}".legacy_id_map WHERE run_id=$1 AND table_name='receipts' AND source_id=$2 AND target_kind='receipt_revision'`,[runId,receipt.id]):null;
  const matches=select("transactions").filter(r=>r.payload.fingerprint===row.payload.fingerprint);
  const mappedCandidates=await pool.query(`SELECT DISTINCT s.id FROM "${schema}".legacy_id_map m JOIN "${schema}".source_lines s ON s.id=m.target_id WHERE m.run_id=$1 AND m.table_name='transactions' AND m.target_kind='source_line' AND m.source_id=ANY($2::text[]) AND s.legacy_fingerprint=$3`,[runId,matches.map(r=>r.id),row.payload.fingerprint]);
  if(!revision?.rows[0]||matches.length!==1||mappedCandidates.rows.length!==1){
   issues.push({id:row.id,code:"legacy_receipt_link_requires_review"});
   if(revision?.rows[0])await port.transaction(tx=>tx.appendReviewEvent({id:`legacy-association-review:${runId}:${row.id}`,subjectId:revision.rows[0].target_id,priorDecisionId:null,code:"legacy_receipt_link_requires_review",params:{legacyFingerprint:String(row.payload.fingerprint),candidateCount:mappedCandidates.rows.length},sourceLineIds:mappedCandidates.rows.map(r=>String(r.id)),state:"open",recordedAt}));
   continue;
  }
  const decision=await recordHistoricalAssociation(port,{key:`legacy:${runId}:${row.id}`,receiptRevisionId:revision.rows[0].target_id,sourceLineId:mappedCandidates.rows[0].id,action:"link",expectedPreviousDecisionId:null,method:row.payload.method as "auto"|"manual",recordedAt:String(row.payload.created_at),legacyFingerprint:String(row.payload.fingerprint),provenance:{runId,legacyTable:row.table,legacySourceId:row.id,legacyReceiptId:row.payload.receipt_id,legacyTransactionId:matches[0].payload.id,originalCreatedAt:row.payload.created_at,sourceRowHash:row.hash}});
  await mapped(row,"historical_receipt_association",decision.id);
 }

 return {counts,issues};
}
