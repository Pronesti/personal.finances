import { expect, it } from "vitest";
import { createMemoryLedger } from "./memory";
import { classificationForMerchantTx } from "./review";
it("retains suffix evidence unless an accepted merchant alias explicitly redirects it",async()=>{
 const port=createMemoryLedger();
 await port.transaction(async tx=>{
  await tx.appendReviewSubject({kind:"merchant",id:"shop",normalizedName:"SHOP",redirectId:null});
  await tx.appendReviewSubject({kind:"rule",id:"extra",match:"EXTRA",accountId:"expense:unallocated",purposeId:"unallocated",position:0,enabled:true});
  expect(await classificationForMerchantTx(tx,"SHOP EXTRA")).toMatchObject({id:"extra"});
 });
});
