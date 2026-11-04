import {beforeEach,expect,it,vi} from "vitest";
import type {AccountingContext} from "../backend";
import {createMemoryLedger} from "./memory";
import {createMemoryReader} from "./read-model";
import {createMemoryDocuments} from "./documents";
import {baseCatalog,cardAccounts} from "./catalog";
import {importReceipt} from "./receipt-import";
import {receiptExtraction} from "./receipt-test-support";
import {reconcileReceipt} from "./linking";
import type {MerchantPurchaseSubject,ProposalSubject} from "./review";
const state=vi.hoisted(()=>({locale:"en" as "en"|"es",fail:false,context:null as unknown as AccountingContext,requests:[] as unknown[]}));
vi.mock("@/lib/backend",()=>({selectedBackend:()=>"postgres",withAccounting:async<T>(work:(context:AccountingContext)=>Promise<T>)=>work(state.context)}));
vi.mock("@/lib/locale",async()=>{const {translator}=await import("../i18n");return {getT:async()=>translator(state.locale)};});
vi.mock("next/cache",()=>({revalidatePath:vi.fn()}));
vi.mock("@/lib/llm",async original=>{
 const actual=await original<typeof import("../llm")>();
 return {...actual,classifyMerchants:(names:string[])=>actual.classifyMerchants(names,{messages:{create:async request=>{
  if(state.fail)throw Error("PRIVATE_DATABASE_OR_PROVIDER_DETAIL");
  state.requests.push(request);
  const wire=request as unknown as {tools:{input_schema:{properties:{items:{items:{properties:{merchant:{enum:string[]}}}}}}}[]};
  return {content:[{type:"tool_use",id:"test",name:"categorize",caller:{type:"direct"},input:{items:wire.tools[0].input_schema.properties.items.items.properties.merchant.enum.map(merchant=>({merchant,category:"food",subcategory:"groceries",confidence:"high"}))}}]};
 }}})};
});
import {proposeCategories} from "@/app/review/actions";
import {proposeAccountingMerchantCategories,acceptAccountingProposalAction,rejectAccountingProposalAction} from "@/app/review/accounting-actions";
beforeEach(async()=>{
 state.requests=[];state.fail=false;state.locale="en";const ledger=Object.assign(createMemoryLedger({accounts:[...baseCatalog(),...cardAccounts("card-a","Actual card")],cardIds:["card-a"]}),{close:async()=>{}}),documents=createMemoryDocuments();
 state.context={ledger,documents,reader:createMemoryReader(),documentRoot:"/unused",appRevision:"synthetic:test"};
 const receipt=await importReceipt(ledger,documents,{key:"receipt",bytes:Buffer.from("%PDF-PRIVATE_SYNTHETIC_DOCUMENT"),extraction:receiptExtraction(),correctedRowsText:null,recordedAt:"2026-01-16T12:00:00Z",appRevision:"synthetic:test"});
 await reconcileReceipt(ledger,{key:"post",receiptRevisionId:receipt.sourceRevisionId,cardId:"card-a",paymentVerified:true,purchaseId:null,allocation:null,recordedAt:"2026-01-16T12:01:00Z"});
 await ledger.transaction(async tx=>{await tx.appendReviewSubject({kind:"merchant",id:"osde",normalizedName:"OSDE 000012345678901",redirectId:null});const association=(await tx.reviewSubjects("merchant_purchase"))[0] as MerchantPurchaseSubject;await tx.appendReviewSubject({...association,merchantId:"osde"});});
});
const form=(values:Record<string,string>)=>{const data=new FormData();for(const [key,value] of Object.entries(values))data.set(key,value);return data;};
it("sends sanitized merchant names only and keeps returned classifications as unposted human proposals",async()=>{
 const before=await state.context.ledger.journals("card-a");expect(await proposeAccountingMerchantCategories()).toBe(1);
 const wire=JSON.stringify(state.requests);expect(wire).toContain("OSDE");for(const value of ["000012345678901","PRIVATE_SYNTHETIC_DOCUMENT","2026-01-15","8000","SYNTHETIC ITEM"])expect(wire).not.toContain(value);
 expect(await state.context.ledger.journals("card-a")).toEqual(before);
 const proposal=(await state.context.ledger.transaction(tx=>tx.reviewSubjects("proposal")))[0] as ProposalSubject;expect(proposal).toMatchObject({state:"pending",sanitizedMerchant:"OSDE",evidence:{sent:"OSDE",confidence:"high"}});
 await acceptAccountingProposalAction(form({proposalId:proposal.id,purchaseId:"receipt-purchase:1",cardId:"card-a",accountId:"expense:food:groceries:pantry",scope:"selected",match:"OSDE"}));
 expect(await state.context.ledger.transaction(tx=>tx.purchase("receipt-purchase:1"))).toMatchObject({version:2,allocations:[{accountId:"expense:food:groceries:pantry",minor:8000}]});
});
it("persists rejection and prevents a future classifier request for that sanitized merchant",async()=>{
 await proposeAccountingMerchantCategories();const proposal=(await state.context.ledger.transaction(tx=>tx.reviewSubjects("proposal")))[0] as ProposalSubject;
 await rejectAccountingProposalAction(form({proposalId:proposal.id,sanitizedMerchant:proposal.sanitizedMerchant}));expect(await proposeAccountingMerchantCategories()).toBe(0);expect(state.requests).toHaveLength(1);
});

it("localizes unexpected proposal failures without disclosing provider details",async()=>{
 state.fail=true;const messages=[];for(const locale of ["en","es"] as const){state.locale=locale;const message=await proposeCategories(null);expect(JSON.stringify(message)).not.toContain("PRIVATE_DATABASE");messages.push(message?.message);}
 expect(messages[0]).toBeTruthy();expect(messages[1]).toBeTruthy();expect(messages[0]).not.toBe(messages[1]);
});
it("proposes from actual historical source evidence and accepts only a future rule without inventing a posted purchase",async()=>{
 const ledger=Object.assign(createMemoryLedger({accounts:[...baseCatalog(),...cardAccounts("card-a","Actual card")],cardIds:["card-a"]}),{close:async()=>{}}),documents=createMemoryDocuments();
 const imported=await importReceipt(ledger,documents,{key:"historical-source",bytes:Buffer.from("%PDF-historical-source"),extraction:receiptExtraction(),correctedRowsText:null,recordedAt:"2026-01-16T12:00:00Z",appRevision:"synthetic:test"});
 const line=await ledger.transaction(async tx=>(await tx.sourceLines(imported.sourceRevisionId))[0]);
 state.context={ledger,documents,documentRoot:"/unused",appRevision:"synthetic:test",reader:createMemoryReader({facts:[{id:"historical",origin:"historical_acquisition",purchaseId:null,kind:"purchase",cardId:"card-a",merchant:"OSDE 000012345678901",accountId:"expense:unallocated",purposeId:"unallocated",currency:"ARS",minor:8000,effectiveDate:"2026-01-15",cycleMonth:"2026-01",sourceLineId:line.id,statementId:imported.sourceRevisionId,coverage:"complete"}]})};
 expect(await ledger.journals("card-a")).toEqual([]);expect(await proposeAccountingMerchantCategories()).toBe(1);
 const proposal=(await ledger.transaction(tx=>tx.reviewSubjects("proposal")))[0] as ProposalSubject;
 const data=form({key:"future-command",proposalId:proposal.id,accountId:"expense:food:groceries:pantry",scope:"future_rule",match:"OSDE"});
 await acceptAccountingProposalAction(data);await acceptAccountingProposalAction(data);
 expect(await ledger.journals("card-a")).toEqual([]);expect(await ledger.transaction(tx=>tx.purchase("historical"))).toBeNull();
 expect(await ledger.transaction(tx=>tx.reviewSubject("proposal",proposal.id))).toMatchObject({state:"accepted",evidence:{legacyCategory:"food"}});
 expect(await ledger.transaction(tx=>tx.reviewSubjects("rule"))).toMatchObject([{match:"OSDE",accountId:"expense:food:groceries:pantry",purposeId:"food"}]);expect(await ledger.transaction(tx=>tx.reviewDecisions(proposal.id))).toHaveLength(1);
});
it("rejects an invalid future-rule target atomically while retaining the original proposal",async()=>{
 await proposeAccountingMerchantCategories();const proposal=(await state.context.ledger.transaction(tx=>tx.reviewSubjects("proposal")))[0] as ProposalSubject,before=await state.context.ledger.journals("card-a");
 await expect(acceptAccountingProposalAction(form({key:"bad-target",proposalId:proposal.id,accountId:"expense:food",scope:"future_rule",match:"OSDE"}))).rejects.toThrow("invalid_posting_account");
 expect(await state.context.ledger.transaction(tx=>tx.reviewSubject("proposal",proposal.id))).toMatchObject({state:"pending"});expect(await state.context.ledger.transaction(tx=>tx.reviewSubjects("rule"))).toEqual([]);expect(await state.context.ledger.transaction(tx=>tx.reviewDecisions(proposal.id))).toEqual([]);expect(await state.context.ledger.journals("card-a")).toEqual(before);
});
it("does not propose or register a merchant when historical source identity is missing",async()=>{
 const ledger=Object.assign(createMemoryLedger(),{close:async()=>{}});state.context={...state.context,ledger,reader:createMemoryReader({facts:[{id:"not-source",origin:"historical_acquisition",purchaseId:null,kind:"purchase",cardId:"a",merchant:"MISSING SOURCE",accountId:null,purposeId:null,currency:"ARS",minor:100,effectiveDate:"2026-01-15",cycleMonth:null,sourceLineId:"absent",statementId:null,coverage:"complete"}]})};
 expect(await proposeAccountingMerchantCategories()).toBe(0);expect(state.requests).toEqual([]);expect(await ledger.transaction(tx=>tx.reviewSubjects("merchant"))).toEqual([]);
});
