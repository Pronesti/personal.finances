/** Replay pinned accepted choices; this file never invents or updates an acceptance. */
import fs from 'node:fs';
import crypto from 'node:crypto';
import {compareParity,type AcceptedDifference,type ReportSnapshot} from '../src/lib/accounting/parity';
const base=(process.argv[2]??'../qa-output/accounting-acceptance').replace(/\/$/,'')+'/',accepted=JSON.parse(fs.readFileSync(base+'accepted-report-differences.json','utf8')),actual=JSON.parse(fs.readFileSync(base+'full-report-comparison.json','utf8')),sha=(x:unknown)=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const failures:string[]=[];let approved=0;
if(accepted.sourceSqliteSha256!==actual.sourceHashBefore||actual.sourceHashBefore!==actual.sourceHashAfter)failures.push('source_sqlite_changed');
if(accepted.sourceFactsSha256!==sha(actual.coverage.pgFacts))failures.push('source_facts_changed');
if(accepted.independentOracleSha256!==sha(actual.sourceAcquisitionOracle))failures.push('independent_oracle_changed');
const ids=actual.checks.filter((c:any)=>c.status==='unresolved_difference').map((c:any)=>c.id).sort();if(sha(ids)!==sha(accepted.records.map((r:any)=>r.key).sort()))failures.push('unlisted_or_missing_difference');
for(const record of accepted.records){
 const raw=actual.checks.find((r:any)=>r.id===record.key);if(!raw||sha(raw.before)!==sha(record.rawBefore)||sha(raw.after)!==sha(record.rawAfter))failures.push(`${record.key}:unexpected_before_after`);
 const proof=actual.explanationProofs.find((p:any)=>p.rawComparisonId===record.key);if(!proof?.proofsPass||sha(proof.proofIds)!==sha(record.independentProofIds))failures.push(`${record.key}:source_proof_changed`);
 if(sha(record.coverage)!==record.coverageSha256)failures.push(`${record.key}:coverage_changed`);
 const expand=(snapshot:any):ReportSnapshot=>({values:snapshot.values,coverage:Object.fromEntries(Object.keys(snapshot.values).map(key=>[key,record.coverage]))});
 const pins:AcceptedDifference[]=record.accepted.map(({coverageRef,...pin}:any)=>{if(coverageRef!==record.key)failures.push(`${pin.key}:invalid_coverage_ref`);return {...pin,coverage:record.coverage};});
 const result=compareParity(expand(record.beforeSnapshot),expand(record.afterSnapshot),record.explanations,pins);approved+=result.approved.length;failures.push(...result.unexplained);
}
const output={generatedAt:new Date().toISOString(),acceptedArtifactSha256:crypto.createHash('sha256').update(fs.readFileSync(base+'accepted-report-differences.json')).digest('hex'),rawDifferenceKeys:accepted.records.length,approvedNumericalLeafKeys:approved,unexplainedDifferenceCount:failures.length,failures,passed:failures.length===0};
fs.writeFileSync(base+'accepted-report-differences-verification.json',JSON.stringify(output,null,2));console.log(JSON.stringify(output));if(failures.length)process.exitCode=1;
