import {expect,it} from "vitest";
import {openingFromEvidence} from "./reconstruction";
it("retains supported partial history without inventing purchase expense or prior payments",()=>{
 expect(openingFromEvidence({billedMinor:10000,unbilledMinor:30000,evidenceIds:["issuer:current","issuer:principal"]})).toEqual({billedMinor:10000,unbilledMinor:30000,expenseMinor:0});
});
it("rejects unsupported or unsafe opening balances",()=>{
 expect(()=>openingFromEvidence({billedMinor:10000,unbilledMinor:30000,evidenceIds:[]})).toThrow("unsupported_opening_evidence");
 expect(()=>openingFromEvidence({billedMinor:-1,unbilledMinor:30000,evidenceIds:["issuer"]})).toThrow();
 expect(()=>openingFromEvidence({billedMinor:Number.MAX_SAFE_INTEGER,unbilledMinor:1,evidenceIds:["issuer"]})).toThrow();
});
