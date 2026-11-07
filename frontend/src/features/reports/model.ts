export type Row=Record<string,unknown>;
export const record=(value:unknown):Row=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Row:{};
export const rows=(value:unknown):Row[]=>Array.isArray(value)?value.map(record):[];
export const number=(value:unknown):number=>typeof value==='number'&&Number.isFinite(value)?value:0;
export const text=(value:unknown):string=>value===null||value===undefined?'—':String(value);
export const REPORTS:Record<string,string>={'/':'overview','/anomalies':'anomalies','/trends':'trends','/categories':'categories','/merchants':'merchants','/movers':'movers','/compare':'compare','/sankey':'sankey','/calendar':'calendar','/habits':'habits','/pace':'pace','/recurring':'recurring','/currency':'currency','/inflation':'inflation','/taxes':'taxes','/credits':'credits','/float':'float','/future':'future','/installments':'installments','/bank':'bank','/super':'super','/super/products':'super-products','/super/categories':'super-categories'};
export type Scope={basis:'purchase'|'billed';value:'real'|'nominal'|'usd';tax:'incl'|'excl';granularity:'month'|'quarter'|'year'|'all';period:string|null};
export type Account={id:string;parentId:string|null;type:string;labelKey:string|null;customName:string|null};
export type Evidence=Row&{id:string;kind:string;currency:'ARS'|'USD';minor:number;effectiveDate:string;description?:string;merchant:string|null;accountId:string|null;sourceLineId:string|null;statementId:string|null;receiptIds?:number[];journalId?:string;purchaseId:string|null};
export type Projection={data:unknown;meta:{report:string;nativePurpose?:{from:string;to:string;measures:{cardId:string;currency:'ARS'|'USD';rows:{purposeId:string|null;expenseMinor:string;debtMinor:string;repaymentMinor:string}[]}[]};scope:Scope;months:string[];periods:string[];controls:{title:string;toggles?:{spend?:boolean;tax?:boolean};granularities?:string[];period?:string;basisCaption?:boolean};cards:{id:string;displayName:string}[];accounts:Account[];empty:boolean;references?:{cpiLatestMonth:string;mepLatestMonth:string;mepLatestRate?:number;stale:boolean};evidence?:Evidence[];evidenceCount?:number;alertVersions:Record<string,string>}};
export function formatMoney(value:unknown,mode:'real'|'nominal'|'usd'='nominal',cents=false):string{
 if(typeof value!=='number'||!Number.isFinite(value))return '—';const amount=cents?value/100:value;
 return mode==='usd'?`US$ ${amount.toFixed(2)}`:new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS',minimumFractionDigits:cents?2:0,maximumFractionDigits:cents?2:0}).format(amount);
}
export function percent(value:unknown):string{return typeof value==='number'&&Number.isFinite(value)?`${value<0?'−':'+'}${Math.abs(value).toFixed(1).replace('.',',')}%`:'—';}
