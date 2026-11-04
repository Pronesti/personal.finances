import {expect,it} from "vitest";
import {resolveLabel} from "../catalog";
import {accountingMessage,receiptAllocationMatrix,supermarketModel} from "./supermarket";
it("keeps custom names literal while rendering one structured retained error in either language",()=>{
 const name={customName:"Mi casa",labelKey:"accounting.account.household"};
 expect(resolveLabel(name,"en")).toBe("Mi casa");expect(resolveLabel(name,"es")).toBe("Mi casa");
 const error={code:"unbalanced_journal",messageKey:"accounting.error.unbalanced" as const,params:{debit:"100,00",credit:"99,99"}};
 expect(accountingMessage(error,"en")).toContain("99,99");expect(accountingMessage(error,"es")).toContain("99,99");expect(accountingMessage(error,"es")).not.toBe(accountingMessage(error,"en"));
});
it("reconciles separate new account allocations without promoting product departments",()=>{
 const input=[{accountId:"groceries",netMinor:7000},{accountId:"household",netMinor:2000},{accountId:"pets",netMinor:1000}].map((row,i)=>({...row,receiptId:1,itemId:String(i),purposeId:null,reviewed:true}));
 const rows=receiptAllocationMatrix(input);expect(rows.reduce((s,r)=>s+r.totalMinor,0)).toBe(10000);expect(rows.map(r=>r.accountId)).toEqual(["groceries","household","pets"]);
 expect(()=>receiptAllocationMatrix([...input,input[0]])).toThrow("invalid_receipt_allocation");
});
it("retains all raw receipt savings without admitting an unreviewed item to trusted prices",()=>{
 const result=supermarketModel([{id:1,date:"2026-01-15",time:null,subtotalCents:10000,discountsCents:-2000,totalCents:8000}],[],[{sourceLineId:"raw:1",receiptId:1,qtyMilli:1000,grossCents:10000,discountCents:-2000,hasM:false,hasA:true}]);
 expect(result.periods[0]).toMatchObject({nItems:1,cotoCents:-2000,totalCents:8000});expect(result.products).toEqual([]);
});
