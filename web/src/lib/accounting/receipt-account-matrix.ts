import type { ReceiptAllocationFact, ReceiptFact } from "./read-model";
import { AccountingError } from "./model";
import { valueCents } from "@/lib/receipts/value";
import { latestMonth } from "@/lib/cpi";
import type { ValueOpts } from "@/lib/queries";
export function receiptAccountMatrix(receipts:ReceiptFact[],allocations:ReceiptAllocationFact[],opts:ValueOpts) {
  const base=opts.value==="real"?latestMonth(opts.cpi):"",rows=new Map<string,{accountId:string;byReceipt:Record<number,number>;total:number;reviewed:boolean}>();
  const add=(accountId:string,receipt:ReceiptFact,minor:number,reviewed:boolean)=>{
    const value=valueCents(minor,receipt.date.slice(0,7),opts,base),row=rows.get(accountId)??{accountId,byReceipt:{},total:0,reviewed:true};
    row.byReceipt[receipt.id]=(row.byReceipt[receipt.id]??0)+value;row.total+=value;row.reviewed&&=reviewed;rows.set(accountId,row);
  };
  for(const receipt of receipts){
    const items=allocations.filter(a=>a.receiptId===receipt.id),seen=new Set<string>();let assigned=0;
    for(const item of items){if(seen.has(item.itemId)||!Number.isSafeInteger(item.netMinor)||item.netMinor<0)throw new AccountingError("invalid_receipt_allocation");seen.add(item.itemId);assigned+=item.netMinor;add(item.accountId??"expense:unallocated",receipt,item.netMinor,item.reviewed);}
    if(assigned>receipt.totalCents)throw new AccountingError("receipt_allocation_exceeds_total");
    if(assigned<receipt.totalCents)add("expense:unallocated",receipt,receipt.totalCents-assigned,true);
  }
  return [...rows.values()].sort((a,b)=>b.total-a.total||a.accountId.localeCompare(b.accountId));
}
