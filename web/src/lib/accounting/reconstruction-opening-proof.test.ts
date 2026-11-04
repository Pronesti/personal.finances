import {expect,it,onTestFinished} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";
import {deriveOpeningProof,type ReceiptPrincipalProof} from "./reconstruction-opening-proof";
const sha=(bytes:Buffer|string)=>createHash("sha256").update(bytes).digest("hex");
function fixture() {
 const sourceRoot=fs.mkdtempSync(path.join(os.tmpdir(),"opening-proof-"));onTestFinished(()=>fs.rmSync(sourceRoot,{recursive:true,force:true}));
 for(const name of ["data","pdfs","json"])fs.mkdirSync(path.join(sourceRoot,name));
 const db=Buffer.from("synthetic copied SQLite bytes"),pdf=Buffer.from("%PDF-synthetic"),transaction={id:7,statement_id:1,section:"purchases",date:"2026-08-21",description:"COTO",ars:50,usd:null,installment_number:1,installment_count:2,fingerprint:"fingerprint"};
 const json=JSON.stringify({transactions:[{...transaction,voucher:"v1"}]});fs.writeFileSync(path.join(sourceRoot,"data/app.db"),db);fs.writeFileSync(path.join(sourceRoot,"pdfs/receipt.pdf"),pdf);fs.writeFileSync(path.join(sourceRoot,"json/statement.json"),json);
 const rows=[{table:"statements",id:"[1]",payload:{id:1,file:"statement.pdf",closing_date:"2026-09-18",balance_ars:100}},{table:"transactions",id:"[7]",payload:transaction},{table:"receipts",id:"[4]",payload:{id:4,file_sha256:sha(pdf),total_cents:10000,date:"2026-08-21"}},{table:"receipt_charge_links",id:"[4]",payload:{receipt_id:4,fingerprint:"fingerprint"}},{table:"upcoming_installments",id:"[1,2026-10]",payload:{statement_id:1,amount_ars:60}}];
 const proof:ReceiptPrincipalProof={sourceDatabaseSha256Before:sha(db),sourceDatabaseSha256After:sha(db),readOnly:true,asOfIssuerDate:"2026-09-18",currency:"ARS",supportedReceiptPrincipalRemainderMinor:5000,issuerFutureScheduleMinor:6000,unallocatedAggregateRemainderMinor:1000,completeFuturePrincipalKnown:false,receiptEvidence:[{legacyReceiptId:4,receiptDate:"2026-08-21",receiptFullPrincipalMinor:10000,receiptPdfSha256:sha(pdf),receiptPdfPath:"pdfs/receipt.pdf",receiptVerificationOk:true,acceptedLegacyAssociationFingerprint:"fingerprint",cardId:"card-a",actualOpeningIssuerStatementId:1,actualOpeningIssuerDate:"2026-09-18",observedBillings:[{legacyTransactionId:7,fingerprint:"fingerprint",statementId:1,issuerClosingDate:"2026-09-18",purchaseDate:"2026-08-21",currency:"ARS",actualBilledMinor:5000,installmentNumber:1,installmentCount:2,rawJsonPath:"json/statement.json",rawJsonSha256:sha(json),rawTransactionOrdinal:1,voucher:"v1"}],sumObservedBillingsMinor:5000,receiptPrincipalLessObservedBillingsMinor:5000}]};
 return {sourceRoot,rows,proof,input:()=>({bytes:Buffer.from(JSON.stringify(proof)),sourceRoot,rows,assignedCards:new Map([["statement.pdf","card-a"]]),cutoffDate:"2026-10-01"})};
}
it("derives only receipt-supported principal at actual card date and discloses unsupported schedule remainder",()=>{
 const f=fixture(),result=deriveOpeningProof(f.input());expect(result).toMatchObject({supportedUnbilledMinor:5000,futureAggregateMinor:6000,unsupportedFutureRemainderMinor:1000,completeFuturePrincipalKnown:false});expect(result.openings[0]).toMatchObject({observationDate:"2026-09-18",billedMinor:10000,unbilledMinor:5000});expect(result.components[0]).toMatchObject({legacyReceiptId:4,originalPrincipalMinor:10000,alreadyBilledMinor:5000,remainingMinor:5000,lastBilledInstallment:1,installmentCount:2});
});
it("rejects a changed copied database, PDF or printed JSON before opening",()=>{
 for(const [file,code] of [["data/app.db","opening_proof_source_mismatch"],["pdfs/receipt.pdf","opening_proof_receipt_mismatch"],["json/statement.json","opening_proof_json_hash_mismatch"]]){const f=fixture();fs.writeFileSync(path.join(f.sourceRoot,file),"changed");expect(()=>deriveOpeningProof(f.input())).toThrow(code);}
});
it("rejects mismatched native rows, an arbitrary date and duplicated actual billing evidence",()=>{
 const f=fixture();f.proof.receiptEvidence[0].observedBillings[0].actualBilledMinor=5001;expect(()=>deriveOpeningProof(f.input())).toThrow("opening_proof_billing_mismatch");
 const g=fixture();g.proof.receiptEvidence[0].actualOpeningIssuerDate="2026-10-01";expect(()=>deriveOpeningProof(g.input())).toThrow("opening_proof_issuer_date_mismatch");
 const h=fixture();h.proof.receiptEvidence[0].observedBillings.push({...h.proof.receiptEvidence[0].observedBillings[0]});expect(()=>deriveOpeningProof(h.input())).toThrow("opening_proof_duplicate_billing");
});
