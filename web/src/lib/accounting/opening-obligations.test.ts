import {describe,it,expect} from "vitest";
import {createMemoryLedger} from "./memory";
import {balancedJournal,syntheticSeed,totals,paymentInput,withTestLedger} from "./test-support";
import {postJournal,recordRepayment} from "./use-cases";
import {registerOpeningObligation,billOpeningInstallment} from "./opening-obligations";
import type {LedgerPort} from "./port";
import type {OpeningObligation,OpeningBillingInput} from "./model";
const proof:OpeningObligation={id:"opening-plan",cardId:"card-a",currency:"ARS",openingJournalId:"opening",evidenceIds:["synthetic:e1"],originalPrincipalMinor:60000,alreadyBilledMinor:30000,remainingMinor:30000,purchaseDate:"2025-12-01",lastBilledInstallment:1,installmentCount:2,allocations:[{purposeId:"food",minor:30000}]};
const bill:OpeningBillingInput={key:"actual-second",openingObligationId:proof.id,cardId:"card-a",currency:"ARS",installment:2,amountMinor:30000,effectiveDate:"2026-02-01",recordedAt:"2026-02-02T12:00:00Z",evidenceIds:["synthetic:e1"]};
async function seed(port:LedgerPort){await postJournal(port,balancedJournal({id:"opening",commandKey:"opening",kind:"opening",lines:[{accountId:"equity:opening",debitMinor:30000,creditMinor:0,purchaseId:null,purposeId:null},{accountId:"card-a:ARS:unbilled",debitMinor:0,creditMinor:30000,purchaseId:null,purposeId:null}]}),"proof");await registerOpeningObligation(port,proof);}
async function continuity(port:LedgerPort){await seed(port);await registerOpeningObligation(port,{...proof,allocations:[...proof.allocations]});expect((await billOpeningInstallment(port,bill)).status).toBe("posted");expect(await totals(port,"card-a","ARS")).toMatchObject({expenseMinor:0,unbilledMinor:0,billedMinor:30000});expect((await billOpeningInstallment(port,bill)).status).toBe("duplicate");expect((await billOpeningInstallment(port,{...bill,key:"another"})).status).toBe("duplicate");expect((await port.journals("card-a")).length).toBe(2);await recordRepayment(port,paymentInput({amountMinor:10000,effectiveDate:"2026-02-03"}));expect(await totals(port,"card-a","ARS")).toMatchObject({expenseMinor:0,unbilledMinor:0,billedMinor:20000});expect(await port.transaction(tx=>tx.openingObligation(proof.id))).toEqual(proof);}
describe("opening obligations",()=>{
it("bills supported remainder once without historical expense",()=>continuity(createMemoryLedger(syntheticSeed())));
it("refuses overbilling and previous installments",async()=>{const p=createMemoryLedger(syntheticSeed());await seed(p);expect((await billOpeningInstallment(p,{...bill,amountMinor:30001})).reviewCode).toBe("billing_exceeds_opening_remaining");expect((await billOpeningInstallment(p,{...bill,key:"past",installment:1})).reviewCode).toBe("unsupported_opening_installment");expect((await p.journals("card-a")).length).toBe(1);});
it("retains immutable proof and rolls back failed billing",async()=>{const p=createMemoryLedger(syntheticSeed());await seed(p);await expect(registerOpeningObligation(p,{...proof,remainingMinor:20000})).rejects.toMatchObject({code:"opening_obligation_conflict"});await expect(billOpeningInstallment(p,{...bill,evidenceIds:["missing"]})).rejects.toBeDefined();expect(await p.transaction(tx=>tx.openingBillings(proof.id))).toEqual([]);expect((await p.journals("card-a")).length).toBe(1);expect((await billOpeningInstallment(p,bill)).status).toBe("posted");});
it("payments cannot reduce opening unbilled",async()=>{const p=createMemoryLedger(syntheticSeed());await seed(p);await recordRepayment(p,paymentInput());expect((await totals(p,"card-a","ARS")).unbilledMinor).toBe(30000);expect((await p.transaction(tx=>tx.attributionState("card-a","ARS"))).attributions).toEqual([]);});
});
describe.skipIf(process.env.ACCOUNTING_PG_TESTS!=="1")("PostgreSQL opening obligations",()=>{it("retains opening continuity",()=>withTestLedger(continuity));
it("rolls back reference failures atomically",()=>withTestLedger(async p=>{await seed(p);await expect(billOpeningInstallment(p,{...bill,evidenceIds:["absent"]})).rejects.toBeDefined();expect(await p.transaction(tx=>tx.openingBillings(proof.id))).toEqual([]);expect((await p.journals("card-a")).length).toBe(1);expect((await billOpeningInstallment(p,bill)).status).toBe("posted");}));});

async function whollyUnbilledOpening(port:LedgerPort){
 await postJournal(port,balancedJournal({id:'opening',commandKey:'opening',kind:'opening',lines:[{accountId:'equity:opening',debitMinor:30000,creditMinor:0,purchaseId:null,purposeId:null},{accountId:'card-a:ARS:unbilled',debitMinor:0,creditMinor:30000,purchaseId:null,purposeId:null}]}),'wholly-unbilled-proof');
 const obligation={...proof,originalPrincipalMinor:30000,alreadyBilledMinor:0,remainingMinor:30000,lastBilledInstallment:0};
 await registerOpeningObligation(port,obligation);
 expect((await billOpeningInstallment(port,{...bill,key:'actual-first',installment:1,amountMinor:15000})).status).toBe('posted');
 expect(await totals(port,'card-a','ARS')).toMatchObject({expenseMinor:0,billedMinor:15000,unbilledMinor:15000});
 await expect(registerOpeningObligation(port,{...obligation,id:'invalid-zero-billed',lastBilledInstallment:1})).rejects.toMatchObject({code:'invalid_opening_obligation'});
}
it('retains fully unbilled receipt principal at opening and recognizes its first later bill without new expense',()=>whollyUnbilledOpening(createMemoryLedger(syntheticSeed())));
it.skipIf(process.env.ACCOUNTING_PG_TESTS!=='1')('persists fully unbilled opening principal and first billing in PostgreSQL',()=>withTestLedger(whollyUnbilledOpening));
