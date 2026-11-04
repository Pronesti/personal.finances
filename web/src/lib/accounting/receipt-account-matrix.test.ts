import { expect, it } from "vitest";
import { receiptAccountMatrix } from "./receipt-account-matrix";
import type { ValueOpts } from "@/lib/queries";
const receipt={id:1,date:"2026-01-15",time:null,subtotalCents:12000,discountsCents:-2000,totalCents:10000};
const opts={value:"nominal"} as ValueOpts;
it("keeps actual account allocations separate from product categories and shows the exact Unallocated remainder",()=>{
 expect(receiptAccountMatrix([receipt],[{receiptId:1,itemId:"source:item1",accountId:"expense:home:cleaning",purposeId:"home",netMinor:7000,reviewed:true}],opts)).toEqual([{accountId:"expense:home:cleaning",byReceipt:{1:7000},total:7000,reviewed:true},{accountId:"expense:unallocated",byReceipt:{1:3000},total:3000,reviewed:true}]);
});
it("retains previously allocated amounts flagged for product review without changing journal classification",()=>{
 const rows=receiptAccountMatrix([receipt],[{receiptId:1,itemId:"source:item1",accountId:"expense:home:cleaning",purposeId:"home",netMinor:7000,reviewed:false}],opts);expect(rows[0]).toMatchObject({accountId:"expense:home:cleaning",total:7000,reviewed:false});
 expect(()=>receiptAccountMatrix([receipt],[{receiptId:1,itemId:"x",accountId:null,purposeId:null,netMinor:10001,reviewed:true}],opts)).toThrow("receipt_allocation_exceeds_total");
});
