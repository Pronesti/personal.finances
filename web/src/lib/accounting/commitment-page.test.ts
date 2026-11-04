import {beforeEach,expect,it,vi} from "vitest";
import {createElement} from "react";
import {renderToPipeableStream} from "react-dom/server";
import {PassThrough} from "node:stream";
async function render(element: Parameters<typeof renderToPipeableStream>[0]): Promise<string> {
 return new Promise((resolve,reject)=>{const output=new PassThrough();let html="";output.on("data",chunk=>html+=chunk.toString());output.on("end",()=>resolve(html));const stream=renderToPipeableStream(element,{onAllReady(){stream.pipe(output);},onError:reject});});
}
import {createMemoryReader,type ReportFact,type StatementFact} from "./read-model";
import {baseCatalog,cardAccounts} from "./catalog";
import {I18nProvider} from "@/components/I18nProvider";
const state=vi.hoisted(()=>({locale:"en" as "en"|"es",ready:new Set<string>(),load:vi.fn(),sqlite:vi.fn()}));
vi.mock("next/navigation",()=>({useRouter:()=>({push:vi.fn(),refresh:vi.fn()}),useSearchParams:()=>new URLSearchParams()}));
vi.mock("next/cache",()=>({revalidatePath:vi.fn()}));
vi.mock("@/lib/backend",()=>({selectedBackend:()=>"postgres",POSTGRES_READY_PAGES:state.ready,backendForPage:state.load}));
vi.mock("@/lib/db",async original=>({...await original<object>(),getDb:state.sqlite}));
vi.mock("@/lib/locale",async()=>{const {translator}=await import("@/lib/i18n");return {getT:async()=>translator(state.locale),getLocale:async()=>state.locale};});
vi.mock("@/lib/cpi",async original=>({...await original<object>(),loadCpi:()=>({"2025-12":100,"2026-01":110,"2026-02":120,"2026-03":130})}));
vi.mock("@/lib/mep",async original=>({...await original<object>(),loadMep:()=>({"2025-12":1000,"2026-01":1100,"2026-02":1200,"2026-03":1300})}));
import Overview from "@/app/page";
import Anomalies from "@/app/anomalies/page";
import Recurring from "@/app/recurring/page";
import Inflation from "@/app/inflation/page";
import Taxes from "@/app/taxes/page";
import Credits from "@/app/credits/page";
import Float from "@/app/float/page";
import Future from "@/app/future/page";
import Installments from "@/app/installments/page";
import Bank from "@/app/bank/page";
const pages=[["/",Overview],["/anomalies",Anomalies],["/recurring",Recurring],["/inflation",Inflation],["/taxes",Taxes],["/credits",Credits],["/float",Float],["/future",Future],["/installments",Installments],["/bank",Bank]] as const;
const base:ReportFact={id:"purchase",purchaseId:"actual-purchase",cardId:"actual-card",kind:"purchase",merchant:"ACTUAL SHOP",accountId:"expense:food:groceries:dairy",purposeId:"food",currency:"ARS",minor:10000,effectiveDate:"2026-01-15",cycleMonth:"2026-02",sourceLineId:"source-line",statementId:"statement",coverage:"complete",description:"ACTUAL SOURCE"};
const statement:StatementFact={id:"statement",cardId:"actual-card",sourceRevisionId:"statement",current:true,closingDate:"2026-02-01",previousClosingDate:"2026-01-01",dueDate:"2026-02-10",cycleMonth:"2026-02",balanceArsMinor:10000,balanceUsdMinor:0,previousBalanceArsMinor:0,minimumPaymentArsMinor:1000,purchaseLimitArsMinor:100000,tnaPct:60,temPct:5};
beforeEach(()=>{state.locale="en";state.ready.clear();state.load.mockReset();state.sqlite.mockReset().mockImplementation(()=>{throw Error("SQLITE_BOUNDARY_VIOLATION");});});
it("renders every commitment route in both languages on PostgreSQL without opening SQLite",async()=>{
 for(const locale of ["en","es"] as const)for(const [route,Page] of pages){
  state.locale=locale;state.ready.add(route);
  const facts=[base,{...base,id:"billing",kind:"billing" as const,minor:2000},{...base,id:"cost",kind:"cost" as const,minor:100,description:"IVA"},{...base,id:"credit",kind:"credit" as const,minor:-500}],inspection={accounts:[...baseCatalog(),...cardAccounts("actual-card","Actual configured card")],cards:[{id:"actual-card",displayName:"Actual configured card"}],journals:[]};
  const reader=createMemoryReader({facts,inspection,statements:[statement],schedules:[{cardId:"actual-card",revisionId:"statement",current:true,month:"2026-03",amount:20}]}),close=vi.fn(async()=>{});
  state.load.mockResolvedValue({kind:"postgres",facts,reader,close});
  const content=await Page({searchParams:Promise.resolve({value:"nominal",g:"month"})});
  const html=await render(createElement(I18nProvider,{locale,children:content}));
  expect(html).toContain(locale==="en"?"Evidence and forecast coverage":"Cobertura de evidencia y proyección");
  expect(html).not.toContain("accounting.commitment.");expect(state.sqlite).not.toHaveBeenCalled();expect(close).toHaveBeenCalledOnce();state.ready.delete(route);
 }
});
