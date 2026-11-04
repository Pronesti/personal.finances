import {describe,expect,it} from 'vitest';
import {createMemoryLedger} from './memory';
import {syntheticSeed,withTestLedger} from './test-support';
import {createMemoryDocuments} from './documents';
import {receiptExtraction} from './receipt-test-support';
import {retainSourceTx,sourceLineId} from './evidence';
import {createProductTx,reviewReceiptItem,type MatchSubject} from './review';
import {accountingReceiptDetail} from './receipt-ui';
import {verify} from '../receipts/verify';
import type {LedgerPort} from './port';
import type {AccountingContext} from '../backend';
const now='2026-10-25T20:00:00Z';
async function legacyItem(port:LedgerPort,changes:Record<string,unknown>={}){
 const docs=createMemoryDocuments(),extraction=receiptExtraction(),parsed=structuredClone(extraction.parsed);
 Object.assign(parsed.items[0],{descPrinted:'ARROZ DOBLE CAROLINA GALLO CJA 1 KGM',sku:'0000568491',ean:'07790070431578',unit:'kg',...changes});
 const pdf=await docs.put(Buffer.from('%PDF-synthetic-legacy-unit')),raw=await docs.put(Buffer.from(JSON.stringify(parsed))),rows=await docs.put(Buffer.from(extraction.rowsText));
 return port.transaction(async tx=>{
  for(const ref of [pdf,raw,rows])await tx.appendSourceObject({...ref,byteLength:(await docs.read(ref)).length});
  const {revisionId}=await retainSourceTx(tx,{key:'legacy-unit',kind:'receipt',cardId:null,documentHash:pdf.sha256,objectPath:pdf.relativePath,rawPayload:{parsed},previousRevisionId:null,recordedAt:now,fiscalId:null,closingDate:null,rawObject:raw,appRevision:'synthetic:legacy-parser'});
  const receiptId=await tx.ensureReceiptEntity('coto',null,pdf.sha256);
  await tx.appendReceiptFacts({revisionId,receiptId,chain:'coto',fiscalId:null,date:parsed.header.date,totalMinor:parsed.footer.totalCents,parsed,report:verify(parsed),scale:3,originalRowsObject:rows,correctedRowsObject:null,productReviewed:false});
  const lineId=sourceLineId(revisionId,1);await tx.appendSourceLine({id:lineId,revisionId,occurrence:1,payload:{...parsed.items[0]},legacyFingerprint:null});
  const productId=await createProductTx(tx,{name:'Arroz Gallo 1 kg',category:'pantry',unit:'un',reviewed:true});
  await tx.appendReviewSubject({kind:'code',id:JSON.stringify(['coto',parsed.items[0].sku]),chain:'coto',sku:parsed.items[0].sku!,productId});
  await tx.appendReviewSubject({kind:'match',id:lineId,receiptRevisionId:revisionId,sourceLineId:lineId,productId,method:'code',reviewed:false});
  return {input:{key:'normalize-unit',receiptRevisionId:revisionId,sourceLineId:lineId,productId,recordedAt:now},docs,receiptId,original:structuredClone(parsed.items[0])};
 });
}
async function provesCorrection(port:LedgerPort){
 const f=await legacyItem(port),journals=await port.journals('card-a');
 await reviewReceiptItem(port,f.input);await reviewReceiptItem(port,f.input);
 expect(await port.transaction(tx=>tx.reviewSubject('match',f.input.sourceLineId))).toMatchObject({reviewed:true,unitCorrection:{from:'kg',to:'un',reason:'packaged_mass'}});
 expect(await port.transaction(tx=>tx.reviewDecisions(f.input.sourceLineId))).toMatchObject([{payload:{unitCorrection:{from:'kg',to:'un',reason:'packaged_mass'}}}]);
 expect((await port.transaction(tx=>tx.sourceLine(f.input.sourceLineId)))?.payload).toEqual(f.original);
 expect(await port.journals('card-a')).toEqual(journals);
 const detail=await accountingReceiptDetail({ledger:port,documents:f.docs,appRevision:'synthetic:test'} as AccountingContext,f.receiptId);
 expect(detail?.detail.items[0]).toMatchObject({unit:'un',qty_milli:1000,line_total_cents:f.original.lineTotalCents});
 expect(detail?.facts.parsed.items[0].unit).toBe('kg');
}
it('audits a legacy packaged-weight interpretation once without rewriting evidence or posting money',async()=>provesCorrection(createMemoryLedger(syntheticSeed())));
describe.skipIf(process.env.ACCOUNTING_PG_TESTS!=='1')('PostgreSQL packaged-unit correction',()=>{
 it('persists the same audited correction with immutable receipt evidence',async()=>withTestLedger(provesCorrection));
});
it.each([{descPrinted:'ARROZ X KG'},{qtyMilli:500},{ean:'02500726002466'},{ean:null}])('rejects unsafe unit reinterpretation: %j',async changes=>{
 const port=createMemoryLedger(syntheticSeed()),f=await legacyItem(port,changes);
 await expect(reviewReceiptItem(port,f.input)).rejects.toThrow('product_unit_mismatch');
 expect((await port.transaction(tx=>tx.reviewSubject('match',f.input.sourceLineId)) as MatchSubject).reviewed).toBe(false);
 expect(await port.transaction(tx=>tx.reviewDecisions(f.input.sourceLineId))).toEqual([]);
});
