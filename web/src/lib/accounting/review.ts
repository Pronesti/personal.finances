import {applySourceClassificationTx} from "./source-classification";
import {createHash,randomUUID} from "node:crypto";
import {validDate} from "./journal";
import {AccountingError,type PurchaseInput} from "./model";
import {isProductCategory,type ProductCategory} from "@/lib/receipts/categories";
import {hasPackagedMass,receiptItemUnit} from "@/lib/receipts/parse";
import {purposeGroups} from "./catalog";
import {wireName} from "@/lib/llm";
import {correctPurchaseTx} from "./use-cases";
import type {LedgerPort,LedgerTx} from "./port";
export type ProductSubject={kind:"product";id:string;name:string;category:ProductCategory;unit:"un"|"kg";reviewed:boolean;redirectId:string|null};
export type CodeSubject={kind:"code";id:string;chain:string;sku:string;productId:string;ean?:string|null};
export type MatchSubject={kind:"match";id:string;receiptRevisionId:string;sourceLineId:string;productId:string;method:"code"|"rule"|"manual"|"auto";reviewed:boolean;unitCorrection?:{from:"kg";to:"un";reason:"packaged_mass"}};
export type MerchantSubject={kind:"merchant";id:string;normalizedName:string;redirectId:string|null;displayName?:string;position?:number};
export type MerchantPurchaseSubject={kind:"merchant_purchase";id:string;purchaseId:string;cardId:string;merchantId:string;sourceLineId:string};
export type RuleSubject={kind:"rule";id:string;match:string;accountId:string;purposeId:string;position:number;enabled:boolean};
export type ProductRuleSubject={kind:"product_rule";id:string;chain:string;match:string;productId:string;position:number};
export type ProposalSubject={kind:"proposal";id:string;merchantId:string;sanitizedMerchant:string;state:"pending"|"accepted"|"rejected";evidence?:{sent:string;confidence:"high"|"low";legacyCategory?:string;legacySubcategory?:string}};
export type AlertSubject={kind:"alert";id:string;state:"open"|"reviewed"|"dismissed";source?:{kind:string;message:string;expected:number|null;actual:number|null;legacyKey:string}};
export type RejectionSubject={kind:"rejection";id:string;merchantId:string};
export type ReviewSubject=ProductSubject|CodeSubject|MatchSubject|MerchantSubject|MerchantPurchaseSubject|RuleSubject|ProductRuleSubject|ProposalSubject|AlertSubject|RejectionSubject;
export type ReviewKind="historical_refund"|"source_classification"|"product_match"|"product_update"|"product_merge"|"move_code"|"merchant_merge"|"alert_state"|"proposal_accept"|"proposal_reject";
export type ReviewDecision={id:string;key:string;digest:string;subjectId:string;kind:ReviewKind;payload:Record<string,unknown>;priorDecisionId:string|null;recordedAt:string;affectedIds:string[]};
export interface ReviewTx {
 nextProductId():Promise<string>;
 reviewSubject(kind:ReviewSubject["kind"],id:string):Promise<ReviewSubject|null>;
 reviewSubjects(kind:ReviewSubject["kind"]):Promise<ReviewSubject[]>;
 appendReviewSubject(subject:ReviewSubject):Promise<void>;
 reviewDecisions(subjectId:string):Promise<ReviewDecision[]>;
 reviewCommand(key:string):Promise<ReviewDecision|null>;
 appendReview(decision:ReviewDecision):Promise<void>;
}
const text=(value:unknown):string=>{if(typeof value!=="string"||!value.trim())throw new AccountingError("invalid_review_payload");return value;};
const hash=(value:unknown):string=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
const timestamp=(value:string):void=>{if(!validDate(value.slice(0,10))||!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)||!Number.isFinite(Date.parse(value)))throw new AccountingError("invalid_date");};
async function subject<K extends ReviewSubject["kind"]>(tx:ReviewTx,kind:K,id:string):Promise<Extract<ReviewSubject,{kind:K}>>{const s=await tx.reviewSubject(kind,id);if(!s)throw new AccountingError("missing_review_subject",{kind,id});return s as Extract<ReviewSubject,{kind:K}>;}
export async function createProductTx(tx:LedgerTx,input:{name:string;category:ProductCategory;unit:"un"|"kg";reviewed:boolean}):Promise<string>{
 text(input.name);if(!isProductCategory(input.category)||!["un","kg"].includes(input.unit))throw new AccountingError("invalid_review_payload");const id=await tx.nextProductId();await tx.appendReviewSubject({kind:"product",id,...input,redirectId:null});return id;
}
export async function registerMerchantPurchaseTx(tx:LedgerTx,input:{purchaseId:string;cardId:string;normalizedName:string;sourceLineId:string}):Promise<string>{
 const normalizedName=text(input.normalizedName).trim().toUpperCase();if(!await tx.purchase(input.purchaseId))throw new AccountingError("missing_supported_purchase");
 const merchantId=hash(normalizedName);if(!await tx.reviewSubject("merchant",merchantId)){const alias=(await tx.reviewSubjects("merchant") as MerchantSubject[]).filter(m=>m.redirectId&&normalizedName.startsWith(m.normalizedName)).sort((a,b)=>b.normalizedName.length-a.normalizedName.length)[0];await tx.appendReviewSubject({kind:"merchant",id:merchantId,normalizedName,redirectId:alias?.redirectId??null});}
 await tx.appendReviewSubject({kind:"merchant_purchase",id:input.purchaseId,purchaseId:input.purchaseId,cardId:input.cardId,merchantId,sourceLineId:input.sourceLineId});return merchantId;
}
export async function registerProposalTx(tx:LedgerTx,proposal:ProposalSubject):Promise<boolean>{
 if(wireName(proposal.sanitizedMerchant)!==proposal.sanitizedMerchant)throw new AccountingError("unsafe_merchant_payload");
 if(proposal.evidence && (proposal.evidence.sent!==proposal.sanitizedMerchant || !["high","low"].includes(proposal.evidence.confidence)))throw new AccountingError("unsafe_proposal_evidence");
 if(await tx.reviewSubject("rejection",proposal.sanitizedMerchant))return false;await subject(tx,"merchant",proposal.merchantId);await tx.appendReviewSubject(proposal);return true;
}
export async function classificationForMerchantTx(tx:LedgerTx,normalizedName:string):Promise<RuleSubject|null>{
 const alias=(await tx.reviewSubjects("merchant") as MerchantSubject[]).filter(m=>m.redirectId && normalizedName.toUpperCase().startsWith(m.normalizedName)).sort((a,b)=>b.normalizedName.length-a.normalizedName.length)[0];const name=alias?await merchantName(tx,alias.id):normalizedName;
 const rules=(await tx.reviewSubjects("rule")) as RuleSubject[];return rules.filter(r=>r.enabled).sort((a,b)=>a.position-b.position||a.id.localeCompare(b.id)).find(r=>name.toUpperCase().includes(r.match))??null;
}
export type ClassificationInput={key:string;cardId:string;purchaseId:string;accountId:string;purposeId:string;scope:"selected"|"future_rule"|"matching_history";match:string|null;recordedAt:string;confirmedPurchaseIds?:string[]};
async function merchantName(tx:LedgerTx,id:string):Promise<string>{let merchant=await subject(tx,"merchant",id);const seen=new Set<string>();while(merchant.redirectId){if(seen.has(merchant.id))throw new AccountingError("merchant_alias_cycle");seen.add(merchant.id);merchant=await subject(tx,"merchant",merchant.redirectId);}return merchant.normalizedName;}
export async function previewClassificationTx(tx:LedgerTx,input:Pick<ClassificationInput,"cardId"|"match">):Promise<string[]>{
 const match=text(input.match).trim().toUpperCase();if(match.length<3)throw new AccountingError("invalid_rule_match");const found:string[]=[];
 for(const s of await tx.reviewSubjects("merchant_purchase") as MerchantPurchaseSubject[])if(s.cardId===input.cardId&&(await merchantName(tx,s.merchantId)).includes(match))found.push(s.purchaseId);return found.sort();
}
export async function previewClassification(port:LedgerPort,input:Pick<ClassificationInput,"cardId"|"match">):Promise<string[]>{return port.transaction(tx=>previewClassificationTx(tx,input));}
export async function classifyPurchase(port:LedgerPort,input:ClassificationInput):Promise<{affectedPurchaseIds:string[];ruleId:string|null}>{return port.transaction(tx=>classifyPurchaseTx(tx,input));}
export async function classifyPurchaseTx(tx:LedgerTx,input:ClassificationInput,fromProposal=false):Promise<{affectedPurchaseIds:string[];ruleId:string|null}>{
 timestamp(input.recordedAt);const key=`review:classification:${encodeURIComponent(input.key)}`,digest=hash({...input,recordedAt:undefined}),saved=await tx.reviewCommand(key);if(saved){if(saved.digest!==digest)throw new AccountingError("command_conflict");return {affectedPurchaseIds:saved.affectedIds,ruleId:typeof saved.payload.ruleId==="string"?saved.payload.ruleId:null};}
 if(!["unallocated",...purposeGroups().map(g=>g.id)].includes(input.purposeId))throw new AccountingError("invalid_primary_purpose");
 const target=await tx.account(input.accountId);if(!target||!target.enabled||!target.posting||!['expense','asset'].includes(target.type)||await tx.hasChildAccounts(target.id))throw new AccountingError("invalid_posting_account");if(target.primaryPurposeId!==null&&target.primaryPurposeId!==input.purposeId)throw new AccountingError("invalid_primary_purpose");
 let ids=input.scope==="future_rule"?[]:[input.purchaseId],ruleId:string|null=null;
 if(!["selected","future_rule","matching_history"].includes(input.scope))throw new AccountingError("invalid_classification_scope");
 if(input.scope!=="selected"){
  const match=text(input.match).trim().toUpperCase();if(match.length<3)throw new AccountingError("invalid_rule_match");
  const rules=await tx.reviewSubjects("rule") as RuleSubject[];const owned=rules.find(r=>r.match===match&&r.enabled);if(fromProposal&&owned&&(owned.accountId!==input.accountId||owned.purposeId!==input.purposeId))throw new AccountingError("owned_rule_conflict");
  if(input.scope==="matching_history"){ids=await previewClassificationTx(tx,input);if(JSON.stringify([...new Set(input.confirmedPurchaseIds??[])].sort())!==JSON.stringify(ids))throw new AccountingError("history_confirmation_required");}
  ruleId=owned?.id??randomUUID();if(!owned||owned.accountId!==input.accountId||owned.purposeId!==input.purposeId){
   if(!fromProposal){let position=1;for(const r of rules.filter(r=>r.id!==ruleId).sort((a,b)=>a.position-b.position))await tx.appendReviewSubject({...r,position:position++});}
   await tx.appendReviewSubject({kind:"rule",id:ruleId,match,accountId:input.accountId,purposeId:input.purposeId,position:fromProposal?rules.length:0,enabled:true});
  }
 }
 for(const id of ids){const current=await tx.purchase(id);if(!current||current.cardId!==input.cardId)throw new AccountingError("missing_supported_purchase");const replacement:PurchaseInput={...current,key:input.key,allocations:[{accountId:input.accountId,purposeId:input.purposeId,minor:current.principalMinor}]};const result=await correctPurchaseTx(tx,{key:`classification:${input.key}:${id}`,cardId:input.cardId,purchaseId:id,expectedVersion:current.version,replacement,recordedAt:input.recordedAt,reason:"explicit classification correction"});if(result.status==="review")throw new AccountingError(result.reviewCode??"classification_review_required");}
 await tx.appendReview({id:randomUUID(),key,digest,subjectId:input.purchaseId,kind:"proposal_accept",payload:{...input,ruleId},priorDecisionId:null,recordedAt:input.recordedAt,affectedIds:ids});return {affectedPurchaseIds:ids,ruleId};
}
export async function reviewReceiptItem(port:LedgerPort,input:{key:string;receiptRevisionId:string;sourceLineId:string;productId:string;recordedAt:string}):Promise<void>{return port.transaction(async tx=>{
 timestamp(input.recordedAt);const key=`review:item:${encodeURIComponent(input.key)}`,digest=hash({...input,recordedAt:undefined}),saved=await tx.reviewCommand(key);if(saved){if(saved.digest!==digest)throw new AccountingError("command_conflict");return;}
 const product=await subject(tx,"product",input.productId);if(!product.reviewed||product.redirectId)throw new AccountingError("product_identity_unreviewed");
 const facts=await tx.receiptFacts(input.receiptRevisionId),lines=await tx.sourceLines(input.receiptRevisionId),line=lines.find(l=>l.id===input.sourceLineId);if(!facts||!line||!facts.parsed.items[line.occurrence-1]||typeof line.payload.descPrinted!=="string")throw new AccountingError("missing_receipt_item");
 let unitCorrection:MatchSubject["unitCorrection"];
 if(line.payload.unit!==product.unit){
  const item=line.payload,code=typeof item.sku==="string"?await tx.reviewSubject("code",JSON.stringify([facts.chain,item.sku])) as CodeSubject|null:null;
  if(item.unit!=="kg"||product.unit!=="un"||typeof item.qtyMilli!=="number"||!Number.isSafeInteger(item.qtyMilli)||item.qtyMilli<=0||item.qtyMilli%1000!==0||typeof item.ean!=="string"||!/^\d{12,14}$/.test(item.ean)||/^0?2/.test(item.ean)||code?.productId!==product.id||!hasPackagedMass(item.descPrinted as string)||receiptItemUnit(item.descPrinted as string,item.qtyMilli)!=="un")throw new AccountingError("product_unit_mismatch");
  unitCorrection={from:"kg",to:"un",reason:"packaged_mass"};
 }
 const prior=(await tx.reviewEvents(input.sourceLineId)).at(-1);await tx.appendReviewSubject({kind:"match",id:input.sourceLineId,receiptRevisionId:input.receiptRevisionId,sourceLineId:input.sourceLineId,productId:product.id,method:"manual",reviewed:true,...(unitCorrection?{unitCorrection}:{})});
 await tx.appendReviewEvent({id:randomUUID(),subjectId:input.sourceLineId,code:"receipt_item_identity_reviewed",params:{productId:product.id},sourceLineIds:[input.sourceLineId],priorDecisionId:prior?.id??null,state:"reviewed",recordedAt:input.recordedAt});
 await tx.appendReview({id:randomUUID(),key,digest,subjectId:input.sourceLineId,kind:"product_match",payload:{productId:product.id,receiptRevisionId:input.receiptRevisionId,...(unitCorrection?{unitCorrection}:{})},priorDecisionId:(await tx.reviewDecisions(input.sourceLineId)).at(-1)?.id??null,recordedAt:input.recordedAt,affectedIds:[input.sourceLineId]});
 });}
async function invalidateMatches(tx:LedgerTx,matches:MatchSubject[],recordedAt:string):Promise<void>{for(const m of matches){await tx.appendReviewSubject({...m,reviewed:false});const prior=(await tx.reviewEvents(m.sourceLineId)).at(-1);await tx.appendReviewEvent({id:randomUUID(),subjectId:m.sourceLineId,code:"receipt_item_identity_reviewed",params:{productId:m.productId},sourceLineIds:[m.sourceLineId],priorDecisionId:prior?.id??null,state:"open",recordedAt});}}
export async function applyReview(port:LedgerPort,input:{key:string;subjectId:string;kind:ReviewKind;payload:Record<string,unknown>;recordedAt:string}):Promise<{decisionId:string;affectedIds:string[]}>{return port.transaction(tx=>applyReviewTx(tx,input));}
export async function applyReviewTx(tx:LedgerTx,input:{key:string;subjectId:string;kind:ReviewKind;payload:Record<string,unknown>;recordedAt:string}):Promise<{decisionId:string;affectedIds:string[]}>{
 timestamp(input.recordedAt);const key=`review:${encodeURIComponent(input.key)}`,digest=hash({...input,recordedAt:undefined}),saved=await tx.reviewCommand(key);if(saved){if(saved.digest!==digest)throw new AccountingError("command_conflict");return {decisionId:saved.id,affectedIds:saved.affectedIds};}const p=input.payload;let affectedIds:string[]=[];
 if(input.kind==="source_classification"){affectedIds=await applySourceClassificationTx(tx,{sourceLineId:input.subjectId,payload:input.payload,recordedAt:input.recordedAt});}
 else if(input.kind==="product_update"){
  const old=await subject(tx,"product",input.subjectId),name=text(p.name);if(!isProductCategory(p.category)||(p.unit!=="un"&&p.unit!=="kg"))throw new AccountingError("invalid_review_payload");await tx.appendReviewSubject({...old,name,category:p.category,unit:p.unit,reviewed:true});affectedIds=[old.id];await invalidateMatches(tx,(await tx.reviewSubjects("match") as MatchSubject[]).filter(m=>m.productId===old.id),input.recordedAt);
 }else if(input.kind==="product_merge"){
  const source=await subject(tx,"product",input.subjectId),target=await subject(tx,"product",text(p.targetId));if(source.id===target.id||source.redirectId||target.redirectId)throw new AccountingError("invalid_product_merge");
  await tx.appendReviewSubject({...source,redirectId:target.id});for(const code of await tx.reviewSubjects("code") as CodeSubject[])if(code.productId===source.id)await tx.appendReviewSubject({...code,productId:target.id});for(const rule of await tx.reviewSubjects("product_rule") as ProductRuleSubject[])if(rule.productId===source.id)await tx.appendReviewSubject({...rule,productId:target.id});const matches=(await tx.reviewSubjects("match") as MatchSubject[]).filter(m=>m.productId===source.id).map(m=>({...m,productId:target.id}));await invalidateMatches(tx,matches,input.recordedAt);affectedIds=[source.id,target.id,...matches.map(m=>m.id)];
 }else if(input.kind==="move_code"){
  const code=await subject(tx,"code",input.subjectId),target=await subject(tx,"product",text(p.targetId));if(target.redirectId)throw new AccountingError("invalid_product_merge");await tx.appendReviewSubject({...code,productId:target.id});const matches=(await tx.reviewSubjects("match") as MatchSubject[]).filter(m=>m.productId===code.productId);const selected:MatchSubject[]=[];for(const m of matches){const facts=await tx.receiptFacts(m.receiptRevisionId),line=(await tx.sourceLines(m.receiptRevisionId)).find(l=>l.id===m.sourceLineId);if(facts?.chain===code.chain&&line?.payload.sku===code.sku)selected.push({...m,productId:target.id,method:"code"});}await invalidateMatches(tx,selected,input.recordedAt);affectedIds=[code.id,...selected.map(m=>m.id)];
 }else if(input.kind==="merchant_merge"){
  const source=await subject(tx,"merchant",input.subjectId),name=text(p.targetName).trim().toUpperCase();if(source.normalizedName.length<3||name===source.normalizedName)throw new AccountingError("invalid_merchant_merge");const targetId=hash(name);let target=await tx.reviewSubject("merchant",targetId) as MerchantSubject|null;if(!target){target={kind:"merchant",id:targetId,normalizedName:name,redirectId:null};await tx.appendReviewSubject(target);}let cursor:MerchantSubject=target;const seen=new Set([source.id]);for(;;){if(seen.has(cursor.id))throw new AccountingError("merchant_alias_cycle");seen.add(cursor.id);if(!cursor.redirectId)break;cursor=await subject(tx,"merchant",cursor.redirectId);}const families=(await tx.reviewSubjects("merchant_purchase") as MerchantPurchaseSubject[]);for(const m of families)if((await merchantName(tx,m.merchantId)).startsWith(source.normalizedName))affectedIds.push(m.purchaseId);if(JSON.stringify([...(Array.isArray(p.confirmedPurchaseIds)?p.confirmedPurchaseIds:[])].sort())!==JSON.stringify(affectedIds.sort()))throw new AccountingError("history_confirmation_required");for(const m of await tx.reviewSubjects("merchant") as MerchantSubject[])if(m.normalizedName.startsWith(source.normalizedName))await tx.appendReviewSubject({...m,redirectId:targetId});
 }else if(input.kind==="alert_state"){
  if(!["open","reviewed","dismissed"].includes(String(p.state)))throw new AccountingError("invalid_review_payload");const old=await tx.reviewSubject("alert",input.subjectId),events=await tx.reviewEvents(input.subjectId);if(!old&&!events.length)throw new AccountingError("missing_review_subject");await tx.appendReviewSubject({...(old?.kind==="alert"?old:{}),kind:"alert",id:input.subjectId,state:p.state as AlertSubject["state"]});const previous=events.at(-1);if(previous)await tx.appendReviewEvent({id:randomUUID(),subjectId:input.subjectId,code:previous?.code??"alert_state",params:previous?.params??{},sourceLineIds:previous?.sourceLineIds??[],priorDecisionId:previous?.id??null,state:p.state as AlertSubject["state"],recordedAt:input.recordedAt});affectedIds=[input.subjectId];
 }else if(input.kind==="proposal_reject"||input.kind==="proposal_accept"){
  const proposal=await subject(tx,"proposal",input.subjectId);if(proposal.state!=="pending")throw new AccountingError("proposal_already_decided");
  if(input.kind==="proposal_reject"){if(text(p.sanitizedMerchant)!==proposal.sanitizedMerchant||wireName(proposal.sanitizedMerchant)!==proposal.sanitizedMerchant)throw new AccountingError("unsafe_merchant_payload");await tx.appendReviewSubject({kind:"rejection",id:proposal.sanitizedMerchant,merchantId:proposal.merchantId});await tx.appendReviewSubject({...proposal,state:"rejected"});affectedIds=[proposal.id];}
  else {const scope=text(p.scope);if(!["selected","future_rule","matching_history"].includes(scope))throw new AccountingError("invalid_classification_scope");
   if(scope==="future_rule"){
    await subject(tx,"merchant",proposal.merchantId);
    const accountId=text(p.accountId),purposeId=text(p.purposeId),target=await tx.account(accountId),match=text(p.match).trim().toUpperCase();
    if(match.length<3)throw new AccountingError("invalid_rule_match");
    if(!["unallocated",...purposeGroups().map(g=>g.id)].includes(purposeId))throw new AccountingError("invalid_primary_purpose");
    if(!target||!target.enabled||!target.posting||!["expense","asset"].includes(target.type)||await tx.hasChildAccounts(target.id))throw new AccountingError("invalid_posting_account");
    if(target.primaryPurposeId!==null&&target.primaryPurposeId!==purposeId)throw new AccountingError("invalid_primary_purpose");
    const rules=await tx.reviewSubjects("rule") as RuleSubject[],owned=rules.find(rule=>rule.enabled&&rule.match===match);
    if(owned&&(owned.accountId!==accountId||owned.purposeId!==purposeId))throw new AccountingError("owned_rule_conflict");
    if(!owned)await tx.appendReviewSubject({kind:"rule",id:randomUUID(),match,accountId,purposeId,position:rules.length,enabled:true});
    await tx.appendReviewSubject({...proposal,state:"accepted"});affectedIds=[];
   }else {const result=await classifyPurchaseTx(tx,{key:`proposal:${input.key}`,cardId:text(p.cardId),purchaseId:text(p.purchaseId),accountId:text(p.accountId),purposeId:text(p.purposeId),scope:scope as ClassificationInput["scope"],match:text(p.match),recordedAt:input.recordedAt,confirmedPurchaseIds:Array.isArray(p.confirmedPurchaseIds)?p.confirmedPurchaseIds.map(text):undefined},true);await tx.appendReviewSubject({...proposal,state:"accepted"});affectedIds=result.affectedPurchaseIds;}}
 }else throw new AccountingError("invalid_review_kind");
 const prior=(await tx.reviewDecisions(input.subjectId)).at(-1),decision:ReviewDecision={id:randomUUID(),key,digest,subjectId:input.subjectId,kind:input.kind,payload:input.payload,priorDecisionId:prior?.id??null,recordedAt:input.recordedAt,affectedIds};await tx.appendReview(decision);return {decisionId:decision.id,affectedIds};
}

export async function matchReceiptProductsTx(tx:LedgerTx,receiptRevisionId:string,rematch=false):Promise<void>{
 const facts=await tx.receiptFacts(receiptRevisionId);if(!facts)throw new AccountingError("missing_receipt");
 const rules=(await tx.reviewSubjects("product_rule") as ProductRuleSubject[]).filter(r=>r.chain===facts.chain).sort((a,b)=>a.position-b.position||a.id.localeCompare(b.id));
 for(const line of await tx.sourceLines(receiptRevisionId)){
  if(await tx.reviewSubject("match",line.id)&&!rematch)continue;
  const item=line.payload;if(typeof item.descPrinted!=="string"||!["un","kg"].includes(String(item.unit)))continue;
  const codeId=typeof item.sku==="string"?JSON.stringify([facts.chain,item.sku]):null;
  const code=codeId?await tx.reviewSubject("code",codeId) as CodeSubject|null:null;
  let productId=code?.productId??null,method:MatchSubject["method"]=code?"code":"auto";
  if(!productId){const rule=rules.find(r=>item.descPrinted!.toString().toUpperCase().includes(r.match.toUpperCase()));if(rule){productId=rule.productId;method="rule";}}
  if(!productId)productId=await createProductTx(tx,{name:item.descPrinted.trim(),category:"other",unit:item.unit as "un"|"kg",reviewed:false});
  let product=await subject(tx,"product",productId);const seen=new Set<string>();while(product.redirectId){if(seen.has(product.id))throw new AccountingError("product_redirect_cycle");seen.add(product.id);product=await subject(tx,"product",product.redirectId);}productId=product.id;
  if(codeId&&!code)await tx.appendReviewSubject({kind:"code",id:codeId,chain:facts.chain,sku:item.sku as string,productId});
  const match:MatchSubject={kind:"match",id:line.id,receiptRevisionId,sourceLineId:line.id,productId,method,reviewed:false};await tx.appendReviewSubject(match);
  if(rematch)await invalidateMatches(tx,[match],new Date().toISOString());
 }
}
export async function rematchReceiptProducts(port:LedgerPort,receiptRevisionId:string):Promise<void>{return port.transaction(tx=>matchReceiptProductsTx(tx,receiptRevisionId,true));}
