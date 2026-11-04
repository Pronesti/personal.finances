import {describe,it,expect} from 'vitest';
import {createMemoryLedger} from './memory';import {baseCatalog,cardAccounts} from './catalog';import {createMemoryDocuments} from './documents';import {importStatement} from './statement-import';import {sourceLineId} from './evidence';import {postJournal} from './use-cases';import {withTestLedger} from './test-support';import {seedActualCatalogCards} from './catalog-service';import {createPostgresReader} from './reader-postgres';import {postHistoricalRefund} from './historical-refunds';import type {LedgerPort} from './port';
const recordedAt='2026-10-25T20:00:00Z';
async function fixture(port:LedgerPort,refundMinor=28750000){
 const docs=createMemoryDocuments();
 const original={file:'original.pdf',brand:'mercadopago',period:{closing_date:'2026-04-18'},transactions:[{section:'purchases',date:'2026-03-20',description:'TUENTRADA COM',ars:287500,usd:null,installment_number:null,installment_count:null}]};
 const first=await importStatement(port,docs,{key:'original',cardId:'card-a',filename:original.file,pdf:Buffer.from('%PDF-original-ticket'),json:original,rawJson:Buffer.from(JSON.stringify(original)),recordedAt,appRevision:'synthetic:test',observationOnly:true});
 await postJournal(port,{id:'opening',commandKey:'opening',cardId:'card-a',currency:'ARS',effectiveDate:'2026-09-18',recordedAt,kind:'opening',reversesId:null,evidenceIds:[first.sourceRevisionId],lines:[{accountId:'equity:opening',debitMinor:63112008,creditMinor:0,purchaseId:null,purposeId:null},{accountId:'card-a:ARS:billed',debitMinor:0,creditMinor:63112008,purchaseId:null,purposeId:null}]},'opening-test');
 const refund={file:'refund.pdf',brand:'mercadopago',period:{closing_date:'2026-10-18',previous_closing_date:'2026-09-18'},balances:{current_ars:343620.08},transactions:[{section:'payments',date:'2026-09-24',description:'Reembolso de TUENTRADA COM',ars:-refundMinor/100,usd:null,installment_number:null,installment_count:null}]};
 const second=await importStatement(port,docs,{key:'refund',cardId:'card-a',filename:refund.file,pdf:Buffer.from('%PDF-refund-ticket'),json:refund,rawJson:Buffer.from(JSON.stringify(refund)),recordedAt,appRevision:'synthetic:test'});
 return {input:{key:'full-refund',cardId:'card-a',currency:'ARS' as const,originalSourceLineId:sourceLineId(first.sourceRevisionId,1),refundSourceLineId:sourceLineId(second.sourceRevisionId,1),accountId:'expense:entertainment:events',purposeId:'entertainment',confirmedFullRefund:true,recordedAt},refundRevisionId:second.sourceRevisionId};
}
async function prove(port:LedgerPort){
 const f=await fixture(port),before=await port.transaction(tx=>tx.sourceLine(f.input.originalSourceLineId));
 const first=await postHistoricalRefund(port,f.input);expect(first.status).toBe('posted');
 expect((await postHistoricalRefund(port,{...f.input,key:'another-key'})).status).toBe('duplicate');
 const journals=await port.journals('card-a');expect(journals.filter(j=>j.kind==='credit')).toHaveLength(1);expect(journals.filter(j=>j.kind==='purchase')).toEqual([]);
 const credit=journals.find(j=>j.kind==='credit')!;expect(credit.effectiveDate).toBe('2026-09-24');expect(credit.evidenceIds).toEqual(expect.arrayContaining([f.input.originalSourceLineId,f.input.refundSourceLineId]));expect(credit.lines).toMatchObject([{accountId:'card-a:ARS:billed',debitMinor:28750000,creditMinor:0},{accountId:'expense:entertainment:events',debitMinor:0,creditMinor:28750000}]);
 expect(await port.transaction(tx=>tx.sourceLine(f.input.originalSourceLineId))).toEqual(before);
 const reviews=await port.transaction(tx=>tx.reviewEvents(f.refundRevisionId));expect(reviews.filter(e=>e.state==='open'&&!reviews.some(c=>c.priorDecisionId===e.id))).toEqual([]);
 return {f,credit};
}
it('links one full refund to retained pre-opening acquisition evidence without reconstructing a purchase',()=>prove(createMemoryLedger({accounts:[...baseCatalog(),...cardAccounts('card-a','Card')],cardIds:['card-a']})));
it('rejects partial-refund confirmation without posting or closing the review',async()=>{
 const p=createMemoryLedger({accounts:[...baseCatalog(),...cardAccounts('card-a','Card')],cardIds:['card-a']}),f=await fixture(p),before=await p.journals('card-a');
 await expect(postHistoricalRefund(p,{...f.input,confirmedFullRefund:false})).rejects.toThrow('full_refund_confirmation_required');expect(await p.journals('card-a')).toEqual(before);
});
describe.skipIf(process.env.ACCOUNTING_PG_TESTS!=='1')('PostgreSQL historical refund',()=>{
 it('posts exact native balance and reports one credit alongside the unchanged March acquisition',async()=>withTestLedger(async(p,ctx)=>{
  await seedActualCatalogCards(p,[{id:'card-a',displayName:'Card'}]);const {f,credit}=await prove(p);const reader=createPostgresReader(ctx.connectionString,ctx.schema);
  try{const facts=await reader.facts();expect(facts.filter(r=>r.kind==='credit'&&r.sourceLineId===f.input.refundSourceLineId)).toMatchObject([{origin:'ledger',minor:-28750000,accountId:'expense:entertainment:events',effectiveDate:'2026-09-24'}]);expect(facts.find(r=>r.origin==='historical_acquisition'&&r.sourceLineId===f.input.originalSourceLineId)).toMatchObject({minor:28750000,effectiveDate:'2026-03-20',accountId:'expense:entertainment:events'});const inspection=await reader.inspection!();expect(inspection.journals.flatMap(j=>j.lines).filter(l=>l.accountId==='card-a:ARS:billed').reduce((n,l)=>n+l.creditMinor-l.debitMinor,0)).toBe(34362008);expect(inspection.journals.filter(j=>j.kind==='credit').map(j=>j.id)).toEqual([credit.id]);}finally{await reader.close();}
 },{seed:false}));
});
it('rejects a nonmatching refund amount without changing journals or review state',async()=>{
 const p=createMemoryLedger({accounts:[...baseCatalog(),...cardAccounts('card-a','Card')],cardIds:['card-a']}),f=await fixture(p,28749999),before=await p.journals('card-a'),reviews=await p.transaction(tx=>tx.reviewEvents(f.refundRevisionId));
 await expect(postHistoricalRefund(p,f.input)).rejects.toThrow('full_refund_amount_mismatch');expect(await p.journals('card-a')).toEqual(before);expect(await p.transaction(tx=>tx.reviewEvents(f.refundRevisionId))).toEqual(reviews);
});
it.each([{cardId:'other-card'},{currency:'USD' as const}])('rejects wrong card/currency: %j',async overrides=>{
 const p=createMemoryLedger({accounts:[...baseCatalog(),...cardAccounts('card-a','Card')],cardIds:['card-a']}),f=await fixture(p),before=await p.journals('card-a');
 await expect(postHistoricalRefund(p,{...f.input,...overrides})).rejects.toThrow();expect(await p.journals('card-a')).toEqual(before);
});
it('does not allow a second full refund of the same retained purchase through a different source',async()=>{
 const p=createMemoryLedger({accounts:[...baseCatalog(),...cardAccounts('card-a','Card')],cardIds:['card-a']}),{f}=await prove(p);
 const json={file:'second-refund.pdf',brand:'mercadopago',period:{closing_date:'2026-11-18'},transactions:[{section:'payments',date:'2026-10-24',description:'Reembolso de TUENTRADA COM',ars:-287500,usd:null,installment_number:null,installment_count:null}]};
 const r=await importStatement(p,createMemoryDocuments(),{key:'second-refund',cardId:'card-a',filename:json.file,pdf:Buffer.from('%PDF-second-refund'),json,rawJson:Buffer.from(JSON.stringify(json)),recordedAt,appRevision:'synthetic:test',observationOnly:true});const before=await p.journals('card-a');
 await expect(postHistoricalRefund(p,{...f.input,key:'different-source',refundSourceLineId:sourceLineId(r.sourceRevisionId,1)})).rejects.toThrow('historical_purchase_already_refunded');expect(await p.journals('card-a')).toEqual(before);
});
