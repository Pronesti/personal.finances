import fs from 'node:fs';
import crypto from 'node:crypto';
import {compareParity,type AcceptedDifference,type DifferenceExplanation,type ReportSnapshot} from '../src/lib/accounting/parity';
const base='../qa-output/accounting-acceptance/',file=base+'full-report-comparison.json',input=JSON.parse(fs.readFileSync(file,'utf8'));
const sha=(x:unknown)=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const policies:Record<string,{source:string;quote:string}>={Q8:{source:'docs/accounting/requirements.md:23;docs/accounting/installments.md:7-9',quote:'Recognize one evidenced purchase and its full known financed principal once.'},T12:{source:'docs/current-state/preservation.md:T12;docs/accounting/requirements.md:23',quote:'Incomplete history uses supported opening obligations rather than fabricated purchases or repayments.'},Q28:{source:'docs/accounting/requirements.md:30,35;docs/accounting/installments.md:9',quote:'Ambiguous financial nature stays in review. Purpose confirmation does not establish vehicle ownership, loan balance, or a principal/fee/insurance breakdown.'},Q22:{source:'docs/accounting/requirements.md:36;docs/current-state/accounting-questions.md:189,203',quote:'A directly linked refund follows the original purchase account; unrelated rewards and uncertain tax credits remain for review.'},T05:{source:'docs/current-state/preservation.md:T05;docs/accounting/requirements.md:40',quote:'Verification of receipt arithmetic does not validate a product identity or its account classification.'},Q13:{source:'docs/accounting/requirements.md:20',quote:'Balance native currencies independently; keep IPC/MEP restatement as separate reporting lenses.'}};
const sourceIds=input.coverage.sqliteTransactions.filter((r:any)=>r.section==='purchases').map((r:any)=>`transactions:${r.id}`).sort(),receiptIds=[...input.productIdentityDifferences.approvedLineIds,...input.productIdentityDifferences.excludedItems.map((r:any)=>r.sourceLineId)].sort();
function leaves(a:any,b:any,path='$'):any[]{
 if(typeof a==='number'||typeof b==='number'){
  if(typeof a==='number'&&typeof b==='number'&&Math.abs(a-b)<=Math.max(0.000001,Math.abs(a)*1e-10))return [];
  if(a===undefined||a===null||typeof a==='number')if(b===undefined||b===null||typeof b==='number')return [{path,before:a??null,after:b??null,numeric:true}];
 }
 if(a===b)return [];
 if((a&&typeof a==='object')||(b&&typeof b==='object')){const result:any[]=[];for(const k of new Set([...Object.keys(a??{}),...Object.keys(b??{})]))result.push(...leaves(a?.[k],b?.[k],`${path}.${k}`));return result;}
 return [{path,before:a??null,after:b??null,numeric:false}];
}
const records:any[]=[],failures:string[]=[];let approvedCount=0;
for(const raw of input.checks.filter((r:any)=>r.status==='unresolved_difference')){
 const proof=input.explanationProofs.find((p:any)=>p.rawComparisonId===raw.id),receipt=raw.id.startsWith('receipts/'),plans=raw.id.startsWith('installments/'),decisions=receipt?['T05']:plans?['Q8','T12']:['Q8','T12','Q28','Q22','Q13'];
 const coverage=[...new Set(receipt?receiptIds:plans?input.unknownInstallmentPlanIdentities.map((f:any)=>f.sourceLineId).sort():sourceIds)] as string[];
 const before:ReportSnapshot={values:{},coverage:{}},after:ReportSnapshot={values:{},coverage:{}},accepted:AcceptedDifference[]=[],explanations:DifferenceExplanation[]=[],semantic:any[]=[],numeric:any[]=[];
 for(const leaf of leaves(raw.before,raw.after)){
  const key=`${raw.id}:${leaf.path}`;
  if(!leaf.numeric){semantic.push({...leaf,key,expectedBefore:leaf.before,expectedAfter:leaf.after,beforeSha256:sha(leaf.before),afterSha256:sha(leaf.after)});continue;}
  const exact=/(?:minor|Cents|Count|count|qtyMilli|productId|receiptId|plans|nProducts|nItems|timesBought)$/.test(leaf.path),scale=exact?1:1_000_000,encode=(v:number|null)=>v===null?null:Math.round(v*scale),left=encode(leaf.before),right=encode(leaf.after);
  if(left!==null&&!Number.isSafeInteger(left)||right!==null&&!Number.isSafeInteger(right))throw Error('unsafe_report_fixed_unit');if(left===right)continue;
  const decision=decisions.join('+'),pin=left===null||right===null?{expectedBefore:left,expectedAfter:right}:{expectedDelta:right-left};
  before.values[key]=left;after.values[key]=right;before.coverage[key]=coverage;after.coverage[key]=coverage;
  accepted.push({id:decision,key,coverage,...pin} as AcceptedDifference);explanations.push({key,decision,reason:`Exact source cohort: ${proof.proofIds.join(', ')}`,...pin});
  numeric.push({...leaf,key,scale,unit:exact?'exact source/count/identity integer':'report currency/percentage micros',fixedBefore:left,fixedAfter:right,originalDelta:leaf.before===null||leaf.after===null?null:leaf.after-leaf.before,...pin});
 }
 const result=compareParity(before,after,explanations,accepted);approvedCount+=result.approved.length;failures.push(...result.unexplained);if(!proof?.proofsPass)failures.push(`${raw.id}:independent_source_proof`);
 records.push({key:raw.id,scope:raw.scope??null,decisions,policies:decisions.map(d=>({id:d,...policies[d]})),coverage,coverageSha256:sha(coverage),rawBefore:raw.before,rawAfter:raw.after,numericalDifferences:numeric,semanticTransitions:semantic,independentProofIds:proof.proofIds,independentProofsPass:proof.proofsPass,accepted:accepted.map(({coverage,...pin})=>({...pin,coverageRef:raw.id})),explanations,beforeSnapshot:{values:before.values,coverageRef:raw.id},afterSnapshot:{values:after.values,coverageRef:raw.id},compareParity:result});
}
const nativeSourceDecisions=input.q8NativeDeltas.filter((r:any)=>r.nativeDelta!==0||r.legacyCycleMonth!==(r.supportedPurchaseDate??'').slice(0,7)).map((r:any)=>{
 const decision=r.reason.startsWith('Historical negative')?'Q22':r.reason.startsWith('Financial nature')?'Q28':r.reason.startsWith('Unsupported')?'Q8+T12':'Q8',retained=input.coverage.pgFacts.filter((f:any)=>f.sourceLineId===r.sourceLineId&&f.currency===r.currency&&(f.kind==='billing'||f.kind==='credit')),native=retained.reduce((n:number,f:any)=>n+f.minor,0),retainedExact=native===r.sourceNativeMinor;
 if(!retainedExact)failures.push(`native-retention:${r.legacyTransactionId}`);
 return {...r,decision,policy:decision.split('+').map((d:string)=>({id:d,...policies[d]})),coverage:[`transactions:${r.legacyTransactionId}`,r.sourceLineId],retainedBilledOrCreditFacts:retained.map((f:any)=>({id:f.id,kind:f.kind,minor:f.minor})),retainedNativeMinor:native,retainedExact};
});
const result={sourceSqliteSha256:input.sourceHashBefore,sourceFactsSha256:sha(input.coverage.pgFacts),independentOracleSha256:sha(input.sourceAcquisitionOracle),createdAt:new Date().toISOString(),sourceArtifact:file,sourceArtifactSha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),coverageContract:'Each records[].coverage is the complete stable input cohort; accepted[].coverageRef and snapshot coverageRef resolve to that exact record key. Actual compareParity executes with expanded arrays; artifact omits duplicate arrays only.',authorization:'Root accepted exact source-based classifications within settled Q8/T12,Q22,Q28,T05,Q13 requirements; no blanket waiver.',conversionContract:{native:'Exact integer; scale1',report:'1majorunit=1000000micros; original floats/deltas retained; independent source oracle abs1e-6/relative1e-10; no journal rounding',absentMetric:'Explicitly pinned null, never coerced to0',nonnumeric:'Exact printed before/after identities retained and independently justified by source cohort proof'},summary:{rawComparisonKeys:records.length,approvedNumericalLeafKeys:approvedCount,semanticLeafTransitions:records.reduce((n,r)=>n+r.semanticTransitions.length,0),nativeSourceRows:nativeSourceDecisions.length,unexplainedDifferenceCount:failures.length},failures,nativeSourceDecisions,records};
fs.writeFileSync(base+'accepted-report-differences.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result.summary));if(failures.length)process.exitCode=1;
