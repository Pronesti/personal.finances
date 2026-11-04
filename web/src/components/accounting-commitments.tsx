import {backendForPage,POSTGRES_READY_PAGES,selectedBackend} from "@/lib/backend";
import {getLocale} from "@/lib/locale";
import {loadCpi} from "@/lib/cpi";
import {loadMep} from "@/lib/mep";
import {parseGranularity,parseModes,type SP} from "@/lib/scope";
import {resolveLabel} from "@/lib/accounting/catalog";
import {commitmentsData} from "@/lib/accounting/reports/commitments";
import {commitmentEnglish,commitmentSpanish} from "@/lib/accounting/commitment-messages";
import type {Locale} from "@/lib/i18n";
export async function loadAccountingCommitments(page:string,sp:SP={}) {
 if(selectedBackend()!=="postgres"||!POSTGRES_READY_PAGES.has(page))return null;
 const backend=await backendForPage(page);if(backend.kind!=="postgres"){await backend.close();throw new Error("accounting_page_not_ready");}
 try {
  const locale=await getLocale(),modes=parseModes(sp),inspection=await backend.reader.inspection();
  const scope={basis:modes.spend==="cash"?"billed" as const:"purchase" as const,value:modes.value,tax:modes.tax,granularity:parseGranularity(sp),period:null};
  const data=commitmentsData({facts:backend.facts,statements:await backend.reader.statements(),schedules:await backend.reader.schedules(),inspection,scope,rates:{cpi:loadCpi(),mep:loadMep()},locale});
  return {...data,locale,accountLabels:Object.fromEntries(inspection.accounts.map(a=>[a.id,resolveLabel(a,locale)])),cardLabels:Object.fromEntries(inspection.cards.map(c=>[c.id,c.displayName]))};
 }finally{await backend.close();}
}
export function AccountingCommitmentCoverage({data}:{data:Awaited<ReturnType<typeof loadAccountingCommitments>>}) {
 if(!data)return null;
 return <CommitmentCoverage locale={data.locale} coverage={data.coverage}/>;
}
export function CommitmentCoverage({locale,coverage}:{locale:Locale;coverage:{cards:number;scheduleCards:number;uncertain:number}}){
 const text=locale==="es"?commitmentSpanish:commitmentEnglish;
 return <aside className="mb-6 rounded-xl border border-line bg-surface p-4 text-sm" aria-label={text["accounting.commitment.coverage"]}>
  <h2 className="font-semibold">{text["accounting.commitment.coverage"]}</h2>
  <p className="mt-2 text-ink-muted">{text["accounting.commitment.observations"]}</p>
  <p className="mt-2 text-ink-muted">{text["accounting.commitment.forecast"]}</p>
  <p className="mt-2">{text["accounting.commitment.schedule"]}: {coverage.scheduleCards}/{coverage.cards} · {text["accounting.commitment.uncertain"]}: {coverage.uncertain}</p>
 </aside>;
}
