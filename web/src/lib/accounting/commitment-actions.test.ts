import {beforeEach,expect,it,vi} from "vitest";
import {createMemoryLedger} from "./memory";
import {createMemoryReader} from "./read-model";
import {createMemoryDocuments} from "./documents";
import type {AccountingContext} from "../backend";
const state=vi.hoisted(()=>({context:null as unknown as AccountingContext,ready:new Set<string>(),sqlite:vi.fn(),work:vi.fn()}));
vi.mock("@/lib/backend",()=>({selectedBackend:()=>"postgres",POSTGRES_READY_PAGES:state.ready,withAccounting:async<T>(work:(context:AccountingContext)=>Promise<T>)=>{state.work();return work(state.context);}}));
vi.mock("@/lib/db",async original=>({...await original<object>(),getDb:state.sqlite}));
vi.mock("next/cache",()=>({revalidatePath:vi.fn()}));
vi.mock("@/lib/cpi",async original=>({...await original<object>(),loadCpi:()=>({"2026-01":100})}));
vi.mock("@/lib/mep",async original=>({...await original<object>(),loadMep:()=>({"2026-01":1000})}));
import {reviewAlert} from "@/app/anomalies/actions";
const source={kind:"balance_mismatch",message:"Preserved source observation",expected:100,actual:99,legacyKey:"balance:2026-01"};
beforeEach(async()=>{
 vi.clearAllMocks();state.ready.clear();state.sqlite.mockImplementation(()=>{throw Error("SQLITE_BOUNDARY_VIOLATION");});
 const ledger=Object.assign(createMemoryLedger(),{close:async()=>{}});await ledger.transaction(tx=>tx.appendReviewSubject({kind:"alert",id:"retained-alert",state:"open",source}));
 state.context={ledger,reader:createMemoryReader({inspection:{journals:[],cards:[],accounts:[],alertStates:[{id:"retained-alert",state:"open",source}]}}),documents:createMemoryDocuments(),documentRoot:"/unused",appRevision:"synthetic:test"};
});
const form=(stateValue:string,key="retained-alert")=>{const form=new FormData();form.set("key",key);form.set("state",stateValue);return form;};
it("refuses stale unready actions without opening either writer",async()=>{await reviewAlert(form("reviewed"));expect(state.work).not.toHaveBeenCalled();expect(state.sqlite).not.toHaveBeenCalled();});
it("persists reviewed, dismissed and reopened PostgreSQL history while preserving original alert evidence",async()=>{
 state.ready.add("/anomalies");
 for(const value of ["reviewed","dismissed","open"] as const){await reviewAlert(form(value));expect(await state.context.ledger.transaction(tx=>tx.reviewSubject("alert","retained-alert"))).toMatchObject({state:value,source});}
 const events=await state.context.ledger.transaction(tx=>tx.reviewDecisions("retained-alert"));expect(events).toHaveLength(3);expect(events[2].priorDecisionId).toBe(events[1].id);expect(state.sqlite).not.toHaveBeenCalled();
});
it("ignores forged or invalid alert state requests",async()=>{state.ready.add("/anomalies");await reviewAlert(form("reviewed","forged"));await reviewAlert(form("invalid"));expect(await state.context.ledger.transaction(tx=>tx.reviewEvents("retained-alert"))).toEqual([]);expect(state.sqlite).not.toHaveBeenCalled();});
