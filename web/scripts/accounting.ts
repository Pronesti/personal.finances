import { AccountingError } from "../src/lib/accounting/model";
import fs from "node:fs";
import path from "node:path";
import { reconstruct } from "../src/lib/accounting/reconstruction";
import { releaseGate, type ReleaseGateInput } from "../src/lib/accounting/parity";
import { randomBytes } from "node:crypto";
import { migrateAccounting } from "../src/lib/accounting/postgres";
import { purchaseInput, billingInput, paymentInput, totals, seedSyntheticLedger } from "../src/lib/accounting/test-support";
import { createPostgresLedger } from "../src/lib/accounting/postgres";
import { recordPurchase, billInstallment, recordRepayment, recordLinkedCredit, correctPurchase } from "../src/lib/accounting/use-cases";
async function main() {
  const [command,...args]=process.argv.slice(2);
  const target=args[args.indexOf("--target")+1];
  if (!args.includes("--target") || !["test","staging"].includes(target)) throw Error("explicit_target_required: --target test|staging");
  if (!["migrate","demo","reconstruct","release-check"].includes(command)) throw Error("usage: accounting migrate|demo|reconstruct|release-check --target test|staging");
  if(command==="demo" && target!=="test") throw Error("demo_requires_test_target");
  const url=target==="test"?process.env.ACCOUNTING_TEST_DATABASE_URL:process.env.ACCOUNTING_STAGING_DATABASE_URL;
  if(!url) throw Error(`missing_explicit_${target}_database_url`);
  if (process.env.DATABASE_URL && url===process.env.DATABASE_URL) throw Error("refusing_default_database_url");
  const option=(name:string)=>{const i=args.indexOf(name);if(i<0||!args[i+1]||args[i+1].startsWith("--"))throw Error(`missing_${name}`);return args[i+1];};
  if(command==="release-check") {
    if(target!=="staging")throw Error("release_check_requires_staging");
    const proofPath=path.resolve(option("--proof"));const proof=JSON.parse(fs.readFileSync(proofPath,"utf8")) as ReleaseGateInput;
    const result=releaseGate(proof);
    for(const [id,location] of [...Object.entries(proof.artifacts??{}),...(proof.scenarios??[]).map(s=>[s.id,s.artifact] as [string,string])]) {
      if(!location?.trim())continue;
      const file=path.resolve(path.dirname(proofPath),location);try{if(!fs.statSync(file).isFile())result.failures.push(`artifact_unavailable:${id}`);}catch{result.failures.push(`artifact_unavailable:${id}`);}
    }
    result.ready=result.failures.length===0;
    console.log(JSON.stringify({...result,proofPath,failedScenarioIds:result.failures.filter(id=>/^[PT]\d{2}$/.test(id)),artifacts:proof.artifacts},null,2));if(!result.ready)process.exitCode=1;return;
  }
  if(command==="reconstruct") {
    const sourceRoot=path.resolve(option("--source")),documentRoot=path.resolve(option("--documents"));
    const mode=option("--mode");if(mode!=="historical"&&mode!=="opening")throw Error("invalid_reconstruction_mode");
    const report=await reconstruct({sourceRoot,documentRoot,targetUrl:url,cutoffDate:option("--cutoff"),mode,cardRegistry:JSON.parse(fs.readFileSync(option("--cards"),"utf8")),mappingPath:args.includes("--mapping")?path.resolve(option("--mapping")):undefined,schema:args.includes("--schema")?option("--schema"):undefined,productApprovalPath:args.includes("--product-approvals")?option("--product-approvals"):undefined,productProposalPath:args.includes("--product-proposal")?option("--product-proposal"):undefined,appRevision:option("--revision"),openingProofPath:args.includes("--opening-proof")?option("--opening-proof"):undefined,openingEvidence:args.includes("--opening-evidence")?JSON.parse(fs.readFileSync(option("--opening-evidence"),"utf8")):undefined});
    const reportPath=path.resolve(option("--report"));fs.writeFileSync(reportPath,JSON.stringify(report,null,2),{mode:0o600,flag:"wx"});
    console.log(JSON.stringify({schema:report.schema,sourceDigest:report.sourceDigest,complete:report.complete,unresolved:report.unresolved.length,reportPath}));return;
  }
  if(command==="migrate") {await migrateAccounting(url);console.log("accounting migrations applied");return;}
  const schema=`acct_test_${randomBytes(12).toString("hex")}`;
  await migrateAccounting(url,schema);await seedSyntheticLedger(url,schema);
  const port=createPostgresLedger(url,schema);
  try {
    const steps=[];
    await recordPurchase(port,purchaseInput());steps.push({event:"purchase",...await totals(port,"card-a","ARS")});
    await billInstallment(port,billingInput());steps.push({event:"bill installment one",...await totals(port,"card-a","ARS")});
    await recordRepayment(port,paymentInput());steps.push({event:"repayment",...await totals(port,"card-a","ARS")});
    await billInstallment(port,billingInput({key:"billing-2",installment:2,effectiveDate:"2026-03-01",recordedAt:"2026-03-02T12:00:00Z"}));steps.push({event:"bill installment two",...await totals(port,"card-a","ARS")});
    await recordLinkedCredit(port,{key:"demo-refund",purchaseId:"purchase-a",cardId:"card-a",currency:"ARS",amountMinor:5000,billedReductionMinor:5000,unbilledReductionMinor:0,effectiveDate:"2026-04-01",recordedAt:"2026-04-02T12:00:00Z",evidenceIds:["synthetic:e1"]});
    await correctPurchase(port,{key:"demo-correction",cardId:"card-a",purchaseId:"purchase-a",expectedVersion:1,replacement:purchaseInput({allocations:[{accountId:"expense:food",purposeId:"food",minor:60000}]}),recordedAt:"2026-05-01T12:00:00Z",reason:"synthetic receipt classification"});
    const attribution=await port.transaction(tx=>tx.attributionState("card-a","ARS"));
    console.log(JSON.stringify({schema,steps,correctedTotals:await totals(port,"card-a","ARS"),journals:await port.journals("card-a"),attribution},null,2));
  } finally {await port.close();}
}
main().catch(error=>{console.error(error instanceof AccountingError?JSON.stringify({code:error.code,params:error.params}):error instanceof Error?error.message:error);process.exitCode=1;});
