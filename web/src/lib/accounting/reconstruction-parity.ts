import {retainedEconomicParity} from "./reconstruction-economic-parity";
import type {Pool} from "pg";
import {createPostgresReader} from "./reader-postgres";
import {sourceAmountMinor} from "./evidence";
import {compareParity,type ReportSnapshot,type ParityResult} from "./parity";
type Row={table:string;id:string;payload:Record<string,unknown>};
/** Actual canonical report facts compared against original native observations, never translated/group labels. */
export async function reconstructionParity(input:{rows:Row[];runId:string;schema:string;url:string;pool:Pool}):Promise<{before:ReportSnapshot;after:ReportSnapshot;result:ParityResult;economic:ReturnType<typeof retainedEconomicParity>}> {
 const {rows,runId,schema,url,pool}=input,reader=createPostgresReader(url,schema);
 const before:ReportSnapshot={values:{},coverage:{}},after:ReportSnapshot={values:{},coverage:{}};
 const add=(snapshot:ReportSnapshot,key:string,minor:number,id:string)=>{snapshot.values[key]=(snapshot.values[key]??0)+minor;if(!Number.isSafeInteger(snapshot.values[key]))throw Error("unsafe_native_total");(snapshot.coverage[key]??=[]).push(id);};
 try {
  const facts=await reader.facts(),schedules=await reader.schedules(),statements=rows.filter(r=>r.table==="statements");
  const maps=(await pool.query(`SELECT source_id,target_id FROM "${schema}".legacy_id_map WHERE run_id=$1 AND table_name='transactions' AND target_kind='source_line'`,[runId])).rows;
  for(const row of rows.filter(r=>r.table==="transactions")) {
   const statement=statements.find(s=>s.payload.id===row.payload.statement_id);if(!statement)throw Error("missing_legacy_statement");
   const sourceLineId=maps.find(m=>m.source_id===row.id)?.target_id;
   for(const [field,currency] of [["ars","ARS"],["usd","USD"]] as const) {
    if(row.payload[field]===null||row.payload[field]===undefined)continue;const minor=sourceAmountMinor(Number(row.payload[field]));if(!minor)continue;
    const section=String(row.payload.section),key=`${section}/${statement.payload.cycle_month}/${currency}`,id=`transactions:${row.id}:${currency}`;
    add(before,key,minor,id);
    const observations=facts.filter(f=>f.sourceLineId===sourceLineId&&f.currency===currency&&f.kind!=="purchase"&&f.kind!=="opening");
    if(observations.length===1) {const f=observations[0];add(after,key,f.kind==="payment"?-f.minor:f.minor,id);}
   }
  }
  const latest=new Map<unknown,Row>();
  const cardMap=(await pool.query(`SELECT r.source_id,s.card_id FROM "${schema}".legacy_id_map r JOIN "${schema}".source_revisions s ON s.id=r.target_id WHERE r.run_id=$1 AND r.table_name='statements' AND r.target_kind='source_revision'`,[runId])).rows;
  for(const row of statements){const card=cardMap.find(c=>c.source_id===row.id)?.card_id;if(card&&(!latest.has(card)||String(latest.get(card)!.payload.closing_date)<String(row.payload.closing_date)))latest.set(card,row);}
  for(const [card,statement] of latest)for(const row of rows.filter(r=>r.table==="upcoming_installments"&&r.payload.statement_id===statement.payload.id)) {
   const key=`future-schedule/${row.payload.month}/ARS`,id=`upcoming_installments:${row.id}`;
   add(before,key,sourceAmountMinor(Number(row.payload.amount_ars)),id);
   const matches=schedules.filter(s=>s.current&&s.cardId===card&&s.month===row.payload.month);
   if(matches.length===1)add(after,key,sourceAmountMinor(matches[0].amount),id);
  }
  for(const key of Object.keys(before.values)) {after.values[key]??=0;after.coverage[key]??=[];}
  const receiptMaps=(await pool.query(`SELECT source_id,target_id,target_kind FROM "${schema}".legacy_id_map WHERE run_id=$1 AND table_name='receipts' AND target_kind IN ('receipt','receipt_revision')`,[runId])).rows;
  const inspection=await reader.inspection();
  const economic=retainedEconomicParity({rows,facts,sourceLines:new Map(maps.map(m=>[m.source_id,m.target_id])),receiptIds:new Map(receiptMaps.filter(m=>m.target_kind==="receipt").map(m=>[m.source_id,Number(m.target_id)])),receiptRevisions:new Map(receiptMaps.filter(m=>m.target_kind==="receipt_revision").map(m=>[m.source_id,m.target_id])),associations:inspection.historicalAssociations??[]});
  return {before,after,result:compareParity(before,after,[]),economic};
 }finally {await reader.close?.();}
}
