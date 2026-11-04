import type {Account} from "./model";
import type {ReportFact,ReportScope,AccountingInspection} from "./read-model";
import {expenseObservation,valuedFacts,spendingModel,merchantModel,spendRows,type ReportRates} from "./reports/spending";
import {median} from "./reports/timing";
import {mepFor} from "../mep";
import {latestMonth,toReal} from "../cpi";
import {periodOf} from "../months";
export function topAccount(id:string,accounts:Account[]):string{const seen=new Set<string>();let account=accounts.find(a=>a.id===id);while(account?.parentId&&account.parentId!=="expense"&&!seen.has(account.id)){seen.add(account.id);const parent=accounts.find(a=>a.id===account!.parentId);if(!parent||parent.type!=="expense")break;account=parent;}return account?.id??id;}
export function descendantOf(id:string,parent:string,accounts:Account[]):boolean{let account=accounts.find(a=>a.id===id);const seen=new Set<string>();while(account&&!seen.has(account.id)){if(account.id===parent)return true;seen.add(account.id);account=accounts.find(a=>a.id===account!.parentId);}return false;}
export function spendingUiModel(facts:ReportFact[],inspection:AccountingInspection,scope:ReportScope,rates:ReportRates){
 const all={...scope,period:null},values=valuedFacts(facts,all,rates),periods=[...new Set(values.map(r=>r.period))].sort();
 const stacked=new Map<string,Record<string,number|string>>();for(const r of spendRows(facts,all,rates)){const p=stacked.get(r.period)??{period:r.period},id=topAccount(r.accountId,inspection.accounts);p[id]=Number(p[id]??0)+r.amount;stacked.set(r.period,p);}
 const compare=[...stacked].sort(([a],[b])=>a.localeCompare(b)).map(([period,row],i,rows)=>{const amount=Object.entries(row).filter(([key])=>key!=="period").reduce((sum,[,n])=>sum+Number(n),0);const previous=i?Object.entries(rows[i-1][1]).filter(([key])=>key!=="period").reduce((sum,[,n])=>sum+Number(n),0):0;return {period,amount,pctVsPrev:previous?(amount-previous)/previous*100:null};});
 const movers=periods.length<2?[]:[...new Set([...stacked.values()].flatMap(p=>Object.keys(p).filter(k=>k!=="period")))].map(category=>{const prev=Number(stacked.get(periods.at(-2)!)?.[category]??0),cur=Number(stacked.get(periods.at(-1)!)?.[category]??0);return {category,prev,cur,delta:cur-prev,pctChange:prev?(cur-prev)/prev*100:null};}).sort((a,b)=>b.delta-a.delta);
 return {periods,stacked:[...stacked.values()],accounts:[...new Set([...stacked.values()].flatMap(r=>Object.keys(r).filter(k=>k!=="period")))].sort(),compare,movers,spending:spendingModel(facts,scope,rates),merchants:merchantModel(facts,scope,rates)};
}
export function accountingDrill(facts:ReportFact[],accounts:Account[],scope:ReportScope,rates:ReportRates,path:{account:string|null;merchant:string|null}){
 const selected=facts.filter(f=>(!path.account||f.accountId&&descendantOf(f.accountId,path.account,accounts))&&(!path.merchant||f.merchant===path.merchant));
 const selectedIds=new Set(selected.map(f=>f.id)),values=valuedFacts(facts,scope,rates).filter(row=>selectedIds.has(row.fact.id)),parent=path.account?accounts.find(a=>a.id===path.account):null;
 const children=accounts.filter(a=>a.parentId===(parent?.id??"expense"));const level:"category"|"merchant"=children.length?"category":"merchant";
 const groups=new Map<string,number>();for(const {fact,amount} of values){const key=level==="merchant"?fact.merchant??"":children.find(a=>fact.accountId&&descendantOf(fact.accountId,a.id,accounts))?.id??fact.accountId??"expense:unallocated";groups.set(key,(groups.get(key)??0)+amount);}
 const rows=selected.filter(f=>expenseObservation(f)&&(f.kind==="credit"||f.kind===(scope.basis==="purchase"?"purchase":"billing"))&&(!scope.period||scope.period==="all"||periodOf(scope.basis==="purchase"?f.effectiveDate.slice(0,7):f.cycleMonth??f.effectiveDate.slice(0,7),scope.granularity)===scope.period));
 return {level,groups:[...groups].map(([key,amount])=>({key,amount})).sort((a,b)=>b.amount-a.amount),rows,values};
}
export function timingUiModel(facts:ReportFact[],scope:ReportScope,rates:ReportRates){
 const values=valuedFacts(facts,{...scope,basis:"purchase",period:null},rates),days=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"] as const;
 const weekdays=days.map(day=>({day,count:0,total:0,byAccount:{} as Record<string,number>,ids:new Set<string>()}));
 const dates=new Map<string,{date:string;amount:number;count:number;categories:{category:string;amount:number;count:number}[];charges:{brand:string;month:string;description:string;merchant:string;category:string;subcategory:null;amount:number|null;usd:number|null;installmentCount:number|null;receiptId:number|null}[];ids:Set<string>}>(),tickets=new Map<string,Map<string,number>>();
 for(const {fact,amount,period} of values){const id=fact.purchaseId??fact.id,account=fact.accountId??"expense:unallocated",day=new Date(fact.effectiveDate+"T00:00:00Z").getUTCDay(),w=weekdays[day];w.total+=amount;w.byAccount[account]=(w.byAccount[account]??0)+amount;if(fact.kind==="purchase"){w.ids.add(id);const p=tickets.get(period)??new Map();p.set(id,(p.get(id)??0)+amount);tickets.set(period,p);}
  const d=dates.get(fact.effectiveDate)??{date:fact.effectiveDate,amount:0,count:0,categories:[],charges:[],ids:new Set<string>()};d.amount+=amount;if(fact.kind==="purchase")d.ids.add(id);let c=d.categories.find(c=>c.category===account);if(!c){c={category:account,amount:0,count:0};d.categories.push(c);}c.amount+=amount;if(fact.kind==="purchase")c.count++;
  d.charges.push({brand:fact.cardId,month:fact.cycleMonth??fact.effectiveDate.slice(0,7),description:fact.description??fact.merchant??"",merchant:fact.merchant??"",category:account,subcategory:null,amount,usd:fact.currency==="USD"?fact.minor/100:null,installmentCount:fact.installmentCount??null,receiptId:fact.receiptIds?.[0]??null});dates.set(d.date,d);
 }
 // Native USD purchases remain inspectable on their calendar dates in ordinary peso modes.
 if(scope.value!=="usd")for(const f of facts.filter(f=>expenseObservation(f)&&f.currency==="USD"&&(f.kind==="purchase"||f.kind==="credit")&&f.origin!=="issuer_observation")){
  const account=f.accountId??"expense:unallocated",d=dates.get(f.effectiveDate)??{date:f.effectiveDate,amount:0,count:0,categories:[],charges:[],ids:new Set<string>()};if(f.kind==="purchase")d.ids.add(f.purchaseId??f.id);let c=d.categories.find(c=>c.category===account);if(!c){c={category:account,amount:0,count:0};d.categories.push(c);}if(f.kind==="purchase")c.count++;d.charges.push({brand:f.cardId,month:f.cycleMonth??f.effectiveDate.slice(0,7),description:f.description??f.merchant??"",merchant:f.merchant??"",category:account,subcategory:null,amount:null,usd:f.minor/100,installmentCount:f.installmentCount??null,receiptId:f.receiptIds?.[0]??null});dates.set(d.date,d);
 }
 const orderedWeekdays=[...weekdays.slice(1),weekdays[0]];
 return {weekdays:orderedWeekdays.map(w=>({day:w.day,count:w.ids.size,...w.byAccount})),weekdayTotals:orderedWeekdays.map(w=>({day:w.day,count:w.ids.size,total:w.total})),calendar:[...dates.values()].sort((a,b)=>a.date.localeCompare(b.date)).map(d=>({date:d.date,amount:d.amount,count:d.ids.size,categories:d.categories,charges:d.charges})),tickets:[...tickets].sort(([a],[b])=>a.localeCompare(b)).map(([period,t])=>{const amounts=[...t.values()];return {period,count:t.size,total:amounts.reduce((s,n)=>s+n,0),avgTicket:amounts.reduce((s,n)=>s+n,0)/amounts.length,medianTicket:median(amounts)??0};}),accounts:[...new Set(values.map(v=>v.fact.accountId??"expense:unallocated"))].sort()};
}
export function currencyUiModel(facts:ReportFact[],scope:ReportScope,rates:ReportRates){
 const grouped=new Map<string,{period:string;arsBilled:number;usdBilled:number}>();
 for(const row of valuedFacts(facts,{...scope,value:"usd",period:null},rates)){
  const p=grouped.get(row.period)??{period:row.period,arsBilled:0,usdBilled:0};let amount=row.amount;
  if(scope.value!=="usd"){amount*=mepFor(row.month,rates.mep);if(scope.value==="real")amount=toReal(amount,row.month,latestMonth(rates.cpi),rates.cpi);}
  p[row.fact.currency==="ARS"?"arsBilled":"usdBilled"]+=amount;grouped.set(p.period,p);
 }
 return [...grouped.values()].sort((a,b)=>a.period.localeCompare(b.period));
}
export function reportDateRange(period:string,granularity:ReportScope["granularity"],dates:string[]):{from:string;to:string}{
 const sorted=dates.slice().sort();if(period==="all"||!period||granularity==="all")return {from:sorted[0]??"0001-01-01",to:sorted.at(-1)??"9999-12-31"};
 const year=Number(period.slice(0,4)),firstMonth=granularity==="year"?1:granularity==="quarter"?(Number(period.slice(-1))-1)*3+1:Number(period.slice(-2)),length=granularity==="year"?12:granularity==="quarter"?3:1;
 return {from:`${year}-${String(firstMonth).padStart(2,"0")}-01`,to:new Date(Date.UTC(year,firstMonth-1+length,0)).toISOString().slice(0,10)};
}
