import { expect,it } from "vitest";
import { compareParity,releaseGate,type ReleaseGateInput } from "./parity";
const before={values:{"billed/2026-01/ARS":100},coverage:{"billed/2026-01/ARS":["fixture:1"]}};
const after={...before,values:{"billed/2026-01/ARS":90}};
it("requires accepted decision, exact key, coverage and delta",()=>{
 const explanation={key:"billed/2026-01/ARS",decision:"Q8",reason:"recognition timing",expectedDelta:-10};
 expect(compareParity(before,after,[]).unexplained).toHaveLength(1);
 expect(compareParity(before,after,[explanation]).unexplained).toHaveLength(1);
 expect(compareParity(before,after,[explanation],[{id:"Q8",key:explanation.key,expectedDelta:-10,coverage:["fixture:1"]}]).approved).toEqual([explanation.key]);
 expect(compareParity(before,after,[explanation],[{id:"Q8",key:explanation.key,expectedDelta:-11,coverage:["fixture:1"]}]).unexplained).toHaveLength(1);
});
it("does not exempt changed coverage or null observations",()=>{
 expect(compareParity(before,{...after,coverage:{"billed/2026-01/ARS":["other"]}},[]).unexplained).toContain("billed/2026-01/ARS:coverage");
 expect(compareParity(before,{...before,values:{"billed/2026-01/ARS":null}},[]).unexplained).toHaveLength(1);
});
function ready():ReleaseGateInput {return {unexplainedDifferenceCount:0,missingObjectCount:0,unbalancedJournalCount:0,preservationScenariosPassed:27,targetScenariosPassed:19,bilingualChecksPassed:true,hostedOcrPassed:true,restorePassed:true,cutoverModeSelected:true,scenarios:[...[...Array(27)].map((_,i)=>`P${String(i+1).padStart(2,"0")}`),...[...Array(19)].map((_,i)=>`T${String(i+1).padStart(2,"0")}`)].map(id=>({id,passed:true,artifact:`private/${id}.json`})),artifacts:{parity:"p",objects:"o",journals:"j",bilingual:"b",ocr:"o",restore:"r",cutover:"c"}};}
it("cannot cut over without passing restore rehearsal",()=>{expect(releaseGate({...ready(),restorePassed:false}).failures).toContain("restore_not_proven");});
it("requires every scenario ID and proof artifact rather than counts",()=>{
 expect(releaseGate(ready()).ready).toBe(true);
 expect(releaseGate({...ready(),scenarios:[]}).failures).toContain("P01");
 for(const key of ["unexplainedDifferenceCount","missingObjectCount","unbalancedJournalCount"] as const) expect(releaseGate({...ready(),[key]:1}).ready).toBe(false);
 expect(releaseGate({...ready(),bilingualChecksPassed:false,cutoverModeSelected:false}).failures).toEqual(expect.arrayContaining(["bilingual_not_proven","cutover_mode_unselected"]));
 expect(releaseGate({} as ReleaseGateInput).ready).toBe(false);
});

it("requires exact accepted known-to-unknown transition without coercing null to zero",()=>{
 const before={values:{plans:3},coverage:{plans:["source:a","source:b"]}},after={values:{plans:null},coverage:{plans:["source:a","source:b"]}};
 const explanation={key:"plans",decision:"Q8/T12",reason:"Historical bills do not establish unique acquisition identity",expectedBefore:3,expectedAfter:null};
 expect(compareParity(before,after,[explanation]).unexplained).toEqual(["plans"]);
 const accepted={id:"Q8/T12",key:"plans",coverage:["source:a","source:b"],expectedBefore:3,expectedAfter:null};
 expect(compareParity(before,after,[explanation],[accepted])).toEqual({approved:["plans"],unexplained:[]});
 for(const invalid of [{...accepted,expectedBefore:4},{...accepted,expectedAfter:0},{...accepted,coverage:["source:a"]}])expect(compareParity(before,after,[explanation],[invalid]).unexplained).toEqual(["plans"]);
 expect(compareParity(before,after,[{...explanation,expectedBefore:4}],[accepted]).unexplained).toEqual(["plans"]);
 expect(compareParity({...before,values:{plans:3.5}},after,[explanation],[accepted]).unexplained).toEqual(["plans:invalid_value"]);
});
