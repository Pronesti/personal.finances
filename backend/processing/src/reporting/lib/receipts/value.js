import {latestMonth,toReal} from '../cpi';
import {mepFor} from '../mep';
// Display-only receipt restatement; printed native cents remain unchanged in PostgreSQL.
export function valueFacts(facts,value,rates){
 if(value==='nominal')return facts;
 const base=value==='real'?latestMonth(rates.cpi):'';
 const convert=(amount,month)=>Math.round(value==='real'?toReal(amount,month,base,rates.cpi):amount/mepFor(month,rates.mep));
 const months=new Map(facts.receipts.map(receipt=>[receipt.id,receipt.date.slice(0,7)]));
 return {receipts:facts.receipts.map(receipt=>{const month=receipt.date.slice(0,7);return {...receipt,subtotalCents:convert(receipt.subtotalCents,month),discountsCents:convert(receipt.discountsCents,month),totalCents:convert(receipt.totalCents,month)};}),items:facts.items.map(item=>({...item,grossCents:convert(item.grossCents,months.get(item.receiptId)),discountCents:convert(item.discountCents,months.get(item.receiptId))})),rawItems:facts.rawItems?.map(item=>({...item,grossCents:convert(item.grossCents,months.get(item.receiptId)),discountCents:convert(item.discountCents,months.get(item.receiptId))}))};
}
