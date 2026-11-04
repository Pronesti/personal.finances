import {expect,it} from "vitest";
import {withTestLedger} from "./test-support";
import {historicalLinkFixture} from "./historical-links-test-support";
import {recordHistoricalAssociation,currentHistoricalAssociations} from "./historical-links";
const pgIt=process.env.ACCOUNTING_PG_TESTS==="1"?it:it.skip;
pgIt("persists canonical evidence-only associations atomically under the ledger writer lock",async()=>{
 if(!process.env.ACCOUNTING_TEST_DATABASE_URL)throw Error("missing_explicit_test_database_url");
 await withTestLedger(async port=>{
  const {input,receipts}=await historicalLinkFixture(port),link=await recordHistoricalAssociation(port,input);
  await expect(recordHistoricalAssociation(port,{...input,key:"owner-conflict",receiptRevisionId:receipts[1].sourceRevisionId})).rejects.toThrow("source_charge_already_linked");
  await expect(recordHistoricalAssociation(port,{...input,key:"stale"})).rejects.toThrow("stale_historical_association");
  expect(await recordHistoricalAssociation(port,input)).toEqual(link);
  const unlink=await recordHistoricalAssociation(port,{...input,key:"unlink",action:"unlink",sourceLineId:null,method:"manual",expectedPreviousDecisionId:link.id});
  expect(unlink.previousDecisionId).toBe(link.id);expect(await port.transaction(tx=>tx.historicalAssociations())).toHaveLength(2);
  expect(currentHistoricalAssociations(await port.transaction(tx=>tx.historicalAssociations()))).toEqual([]);expect(await port.journals("card-a")).toEqual([]);
 });
});
pgIt("serializes competing receipt owners for one statement source line",async()=>{
 if(!process.env.ACCOUNTING_TEST_DATABASE_URL)throw Error("missing_explicit_test_database_url");
 await withTestLedger(async port=>{
  const {input,receipts}=await historicalLinkFixture(port);
  const results=await Promise.allSettled([recordHistoricalAssociation(port,input),recordHistoricalAssociation(port,{...input,key:"competing",receiptRevisionId:receipts[1].sourceRevisionId})]);
  expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);expect(results.filter(r=>r.status==="rejected")).toHaveLength(1);
  expect(currentHistoricalAssociations(await port.transaction(tx=>tx.historicalAssociations()))).toHaveLength(1);expect(await port.journals("card-a")).toEqual([]);
 });
});
