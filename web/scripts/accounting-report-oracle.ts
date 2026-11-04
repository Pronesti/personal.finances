/** Independent copied-source acquisition/valuation oracle; no report model imports. */
import type Database from 'better-sqlite3';
import type {AccountingInspection,ReportFact,ReportScope} from '../src/lib/accounting/read-model';
export function sourceAcquisitionOracle(db:Database.Database,maps:any[],inspection:AccountingInspection):ReportFact[]{
 const mapped=(table:string,id:number,kind:string)=>maps.find(m=>m.table_name===table&&m.source_id===JSON.stringify([id])&&m.target_kind===kind)?.target_id;
 const rows=db.prepare(`SELECT t.*,s.cycle_month FROM transactions t JOIN statements s ON s.id=t.statement_id ORDER BY t.id`).all() as any[];
 const receipts=db.prepare('SELECT * FROM receipts').all() as any[],links=db.prepare('SELECT * FROM receipt_charge_links').all() as any[];
 const result:ReportFact[]=[];
 for(const row of rows){
  if(row.section!=='purchases'||typeof row.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(row.date)||Number.isNaN(Date.parse(row.date+'T00:00:00Z'))||new Date(row.date+'T00:00:00Z').toISOString().slice(0,10)!==row.date||/(PLAN\s*[OÓ]VALO|ADELANTO|PR[EÉ]STAMO|EXTRACCI[OÓ]N|EFECTIVO)/i.test(row.description))continue;
  const currencies=[['ars','ARS'],['usd','USD']] as const,values=currencies.filter(([field])=>typeof row[field]==='number'&&row[field]!==0);if(values.length!==1)continue;
  const [field,currency]=values[0];if(row[field]<=0)continue;
  let minor=Math.round(row[field]*100),date=row.date;
  if(row.installment_count!=null&&row.installment_count!==1||row.installment_number!=null&&row.installment_number!==1){
   if(!(row.installment_count>1&&row.installment_number===1&&currency==='ARS'))continue;
   const candidates=links.filter(l=>l.fingerprint===row.fingerprint);if(candidates.length!==1||rows.filter(t=>t.fingerprint===row.fingerprint).length!==1)continue;
   const receipt=receipts.find(r=>r.id===candidates[0].receipt_id);if(!receipt)continue;minor=receipt.total_cents;date=receipt.date;
  }
  const statementId=mapped('statements',row.statement_id,'source_revision'),statement=inspection.sources?.find(s=>s.id===statementId);if(!statement?.cardId)throw Error('oracle_statement_identity_missing');
  const sourceLineId=mapped('transactions',row.id,'source_line');if(!sourceLineId)throw Error('oracle_line_identity_missing');
  const classifications=(inspection.reviews??[]).filter(r=>r.code==='historical_source_classification'&&r.subjectId===sourceLineId&&r.state==='reviewed'),classification=classifications.at(-1);
  result.push({id:`oracle:transaction:${row.id}`,purchaseId:null,kind:'purchase',cardId:statement.cardId,merchant:row.merchant,accountId:typeof classification?.params.accountId==='string'?classification.params.accountId:'expense:unallocated',purposeId:typeof classification?.params.purposeId==='string'?classification.params.purposeId:'unallocated',currency,minor,effectiveDate:date,cycleMonth:row.cycle_month,sourceLineId,statementId,coverage:'complete'});
 }
 return result;
}
export function independentlyValue(facts:ReportFact[],scope:ReportScope,rates:{cpi:Record<string,number>;mep:Record<string,number>},db:Database.Database){
 const lookup=(month:string,table:Record<string,number>)=>{const key=Object.keys(table).sort().filter(m=>m<=month).at(-1);if(!key)throw Error('oracle_rate_missing');return table[key];},latest=Object.keys(rates.cpi).sort().at(-1)!;
 const taxes=new Map<number,number>(),bases=new Map<number,number>();
 for(const r of db.prepare(`SELECT t.*,s.cycle_month FROM transactions t JOIN statements s ON s.id=t.statement_id`).all() as any[]){
  if(r.section==='taxes_and_charges'&&r.ars!=null&&!r.description.toUpperCase().startsWith('DEVOLUCION'))taxes.set(r.statement_id,(taxes.get(r.statement_id)??0)+r.ars);
  if(r.section==='purchases')bases.set(r.statement_id,(bases.get(r.statement_id)??0)+(r.ars??(r.usd??0)*lookup(r.cycle_month,rates.mep)));
 }
 return facts.flatMap(fact=>{
  if(fact.currency==='USD'&&scope.value!=='usd')return [];
  const month=fact.effectiveDate.slice(0,7),period=scope.granularity==='all'?'all':scope.granularity==='year'?month.slice(0,4):scope.granularity==='quarter'?`${month.slice(0,4)}-Q${Math.ceil(Number(month.slice(5))/3)}`:month;
  if(scope.period&&scope.period!=='all'&&scope.period!==period)return [];
  let amount=fact.minor/100;
  if(fact.currency==='ARS'&&scope.value==='real')amount*=rates.cpi[latest]/lookup(month,rates.cpi);
  if(fact.currency==='ARS'&&scope.value==='usd')amount/=lookup(month,rates.mep);
  const legacyStatementId=Number((fact.id.match(/transaction:(\d+)$/)?.[1]));
  const statement=(db.prepare('SELECT statement_id FROM transactions WHERE id=?').get(legacyStatementId) as {statement_id:number}).statement_id;
  if(scope.tax==='incl'&&(bases.get(statement)??0)>0)amount*=1+(taxes.get(statement)??0)/bases.get(statement)!;
  return [{fact,month,period,amount}];
 });
}
