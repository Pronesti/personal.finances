import { describe, expect, it } from "vitest";
import { journalCommandPayload, validateJournal } from "./journal";
import { balancedJournal, syntheticSeed } from "./test-support";
import { createMemoryLedger } from "./memory";
import { postJournal } from "./use-cases";
describe("native journal",()=>{
  it("canonical retry inputs exclude generated identity and actual recording time",()=>{expect(journalCommandPayload(balancedJournal())).toBe(journalCommandPayload(balancedJournal({id:"another-id",recordedAt:"2026-02-01T01:00:00Z"})));expect(journalCommandPayload(balancedJournal())).not.toBe(journalCommandPayload(balancedJournal({effectiveDate:"2026-01-14"})));});
  it("rejects unsafe accumulated totals",()=>{const j=balancedJournal();j.lines=[{...j.lines[0],debitMinor:Number.MAX_SAFE_INTEGER},{...j.lines[0],debitMinor:1}, {...j.lines[1],creditMinor:Number.MAX_SAFE_INTEGER},{...j.lines[1],creditMinor:1}];expect(()=>validateJournal(j)).toThrow("invalid_minor_units");});
  it("rejects posting to a parent account",async()=>{const seed=syntheticSeed();seed.accounts.push({...seed.accounts[0],id:"child",parentId:"expense:unallocated"});await expect(postJournal(createMemoryLedger(seed),balancedJournal(),"d")).rejects.toThrow("invalid_posting_account");});
  it("rejects one cent imbalance and fractional minor units",()=>{const j=balancedJournal();j.lines[1].creditMinor=59999;expect(()=>validateJournal(j)).toThrow("unbalanced_journal");j.lines[1].creditMinor=60000;j.lines[0].debitMinor=.5;expect(()=>validateJournal(j)).toThrow("invalid_minor_units");});
  it("rejects invalid dates, unsafe totals, missing evidence and invalid sides",()=>{
    expect(()=>validateJournal(balancedJournal({effectiveDate:"2026-02-30"}))).toThrow("invalid_date");
    expect(()=>validateJournal(balancedJournal({evidenceIds:[]}))).toThrow("missing_evidence");
    const j=balancedJournal();j.lines[0].creditMinor=1;expect(()=>validateJournal(j)).toThrow("invalid_journal_line");
    j.lines[0].creditMinor=0;j.lines[0].debitMinor=Number.MAX_SAFE_INTEGER+1;expect(()=>validateJournal(j)).toThrow("invalid_minor_units");
  });
  it("serializes retries and returns original IDs",async()=>{const p=createMemoryLedger(syntheticSeed());const results=await Promise.all([postJournal(p,balancedJournal(),"digest"),postJournal(p,balancedJournal({id:"retry-id",recordedAt:"2026-01-17T12:00:00Z"}),"digest")]);expect(results.map(r=>r.status)).toEqual(["posted","duplicate"]);expect(results[1].journalIds).toEqual(["synthetic:j1"]);expect(await p.journals("card-a")).toHaveLength(1);await expect(postJournal(p,balancedJournal(),"changed")).rejects.toThrow("command_conflict");});
  it("rolls back both journal and receipt after failure",async()=>{const p=createMemoryLedger(syntheticSeed());await expect(p.transaction(async tx=>{await tx.appendJournal(balancedJournal());await tx.appendCommand({key:"x",digest:"x",result:{status:"posted",journalIds:["synthetic:j1"],reviewCode:null}});throw Error("forced");})).rejects.toThrow("forced");expect(await p.journals("card-a")).toEqual([]);expect(await p.transaction(tx=>tx.command("x"))).toBeNull();});
  it("rejects USD on ARS accounts and disabled or parent accounts",async()=>{const p=createMemoryLedger(syntheticSeed());await expect(postJournal(p,balancedJournal({currency:"USD"}),"d")).rejects.toThrow("account_currency_mismatch");const s=syntheticSeed();s.accounts[0].enabled=false;await expect(postJournal(createMemoryLedger(s),balancedJournal(),"d")).rejects.toThrow("invalid_posting_account");});
  it("keeps returned records detached",async()=>{const p=createMemoryLedger(syntheticSeed());await postJournal(p,balancedJournal(),"d");const rows=await p.journals("card-a");rows[0].lines[0].debitMinor=1;expect((await p.journals("card-a"))[0].lines[0].debitMinor).toBe(60000);});
});
