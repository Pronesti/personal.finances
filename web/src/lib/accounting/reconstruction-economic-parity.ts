import {validDate} from "./journal";
import {sourceAmountMinor} from "./evidence";
import {ordinaryPurchaseNature} from "./purchase-nature";
import {compareParity,type ReportSnapshot} from "./parity";
import {currentHistoricalAssociations,type HistoricalReceiptAssociation} from "./historical-links";
import type {ReportFact} from "./read-model";
type Row={table:string;id:string;payload:Record<string,unknown>};
export function retainedEconomicParity(input:{rows:Row[];facts:ReportFact[];sourceLines:Map<string,string>;receiptIds:Map<string,number>;receiptRevisions:Map<string,string>;associations:HistoricalReceiptAssociation[]}) {
 const before:ReportSnapshot={values:{},coverage:{}},after:ReportSnapshot={values:{},coverage:{}},used=new Set<string>();
 const add=(snapshot:ReportSnapshot,key:string,minor:number,id:string)=>{snapshot.values[key]=(snapshot.values[key]??0)+minor;if(!Number.isSafeInteger(snapshot.values[key]))throw Error("unsafe_native_total");(snapshot.coverage[key]??=[]).push(id);};
 const compare=(lineId:string|undefined,currency:"ARS"|"USD",minor:number,date:string,id:string,receiptId?:number)=>{
  const key=`known-acquisition/${date.slice(0,7)}/${currency}`;add(before,key,minor,id);
  const facts=input.facts.filter(f=>f.kind==="purchase"&&f.sourceLineId===lineId&&f.currency===currency&&(receiptId===undefined||f.receiptIds?.includes(receiptId)));
  if(!facts.length||new Set(facts.map(f=>f.purchaseId??"historical-evidence")).size!==1)return;
  for(const f of facts)used.add(f.id);
  const dates=new Set(facts.map(f=>f.effectiveDate));if(dates.size!==1)return;
  add(after,`known-acquisition/${facts[0].effectiveDate.slice(0,7)}/${currency}`,facts.reduce((sum,f)=>sum+f.minor,0),id);
 };
 for(const row of input.rows.filter(r=>r.table==="transactions")) {
  const p=row.payload;
  if(p.section!=="purchases"||typeof p.date!=="string"||!validDate(p.date)||typeof p.description!=="string"||!ordinaryPurchaseNature(p.description)||p.installment_count!=null&&p.installment_count!==1||p.installment_number!=null&&p.installment_number!==1)continue;
  const fields=(["ars","usd"] as const).filter(k=>typeof p[k]==="number"&&p[k]!==0);if(fields.length!==1)continue;
  const field=fields[0];if(Number(p[field])<=0)continue;
  const currency=field==="ars"?"ARS":"USD";compare(input.sourceLines.get(row.id),currency,sourceAmountMinor(Number(p[field])),p.date,`transactions:${row.id}:${currency}`);
 }
 const links=currentHistoricalAssociations(input.associations),linkBefore:ReportSnapshot={values:{},coverage:{}},linkAfter:ReportSnapshot={values:{},coverage:{}};
 for(const row of input.rows.filter(r=>r.table==="receipt_charge_links")) {
  const receipt=input.rows.find(r=>r.table==="receipts"&&r.payload.id===row.payload.receipt_id),transactions=input.rows.filter(r=>r.table==="transactions"&&r.payload.fingerprint===row.payload.fingerprint),transaction=transactions.length===1?transactions[0]:undefined;
  const lineId=transaction?input.sourceLines.get(transaction.id):undefined,receiptId=receipt?input.receiptIds.get(receipt.id):undefined,key=`receipt-association/${row.id}`,coverage=`receipt_charge_links:${row.id}`;
  add(linkBefore,key,1,coverage);
  const linked=links.filter(l=>l.sourceLineId===lineId&&l.receiptRevisionId===(receipt?input.receiptRevisions.get(receipt.id):undefined)&&input.facts.some(f=>f.sourceLineId===lineId&&f.receiptIds?.includes(receiptId??-1)));
  if(linked.length===1)add(linkAfter,key,1,coverage);
  if(!receipt||!transaction||receiptId===undefined||!lineId||(Number(transaction.payload.installment_count)||1)<=1)continue;
  compare(lineId,"ARS",Number(receipt.payload.total_cents),String(receipt.payload.date),`receipts:${receipt.id}:ARS`,receiptId);
 }
 for(const f of input.facts.filter(f=>f.kind==="purchase"&&!used.has(f.id)))add(after,`extra-acquisition/${f.effectiveDate.slice(0,7)}/${f.currency}`,f.minor,`unexpected:${f.id}`);
 for(const [left,right] of [[before,after],[linkBefore,linkAfter]])for(const key of new Set([...Object.keys(left.values),...Object.keys(right.values)])){left.values[key]??=0;right.values[key]??=0;left.coverage[key]??=[];right.coverage[key]??=[];}
 return {acquisitions:{before,after,result:compareParity(before,after,[]),actualFactCount:input.facts.filter(f=>f.kind==="purchase").length,expectedAcquisitionCount:Object.values(before.coverage).reduce((sum,ids)=>sum+ids.length,0)},associations:{before:linkBefore,after:linkAfter,result:compareParity(linkBefore,linkAfter,[]),currentCount:links.length}};
}
