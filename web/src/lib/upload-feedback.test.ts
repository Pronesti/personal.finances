import { expect, it } from "vitest";
import { Failure } from "./failure";
import { translator } from "./i18n";
import { uploadFeedback } from "./upload-feedback";
it("re-renders a retained duplicate code and exact values after locale change",()=>{
 const failure=new Failure("duplicate_receipt","failure.duplicate_receipt.file",{id:6,date:"2026-09-11"});
 const retained={code:failure.code,...failure.localized("en")};
 expect(uploadFeedback(translator("en"),retained).message).toContain("already uploaded");
 const es=uploadFeedback(translator("es"),retained).message;expect(es).not.toContain("already uploaded");expect(es).toContain("2026-09-11");expect(es).toContain("6");
 expect(retained).toMatchObject({code:"duplicate_receipt",messageParams:{id:6,date:"2026-09-11"}});
});
it("translates retained parser detail and setup hint while preserving raw source",()=>{
 const failure=new Failure("parse_failed","failure.parse_failed.detail",{detail:"RAW 123,45"},"hint.pythonSetup");const retained={code:failure.code,...failure.localized("en")};
 const en=uploadFeedback(translator("en"),retained),es=uploadFeedback(translator("es"),retained);expect(en.message).toBe(es.message);expect(en.hint).not.toBe(es.hint);expect(es.message).toContain("RAW 123,45");expect(retained.messageParams.detail).toBe("RAW 123,45");
});
it("renders retained accounting/client failures and preserves unknown diagnostics",()=>{
 const retained={code:"missing_card_identity",message:"old",receiptKey:"accounting.receipts.cardRequired" as const};expect(uploadFeedback(translator("en"),retained).message).not.toBe(uploadFeedback(translator("es"),retained).message);
 const client={code:"unknown",message:"old",messageKey:"upload.error.unreadable" as const,messageParams:{file:"source.pdf"}};expect(uploadFeedback(translator("es"),client).message).toContain("source.pdf");
 expect(uploadFeedback(translator("es"),{code:"future_unknown",message:"raw diagnostic",hint:"raw hint"})).toEqual({message:"raw diagnostic",hint:"raw hint"});
});
it("re-renders retained classifier credentials errors without losing the setup hint",()=>{
 const retained={code:"llm_unavailable",...new Failure("llm_unavailable","failure.llm_unavailable",{},"hint.apiKey").localized("en")};
 const en=uploadFeedback(translator("en"),retained),es=uploadFeedback(translator("es"),retained);
 expect(en.message).not.toBe(es.message);expect(es.message).toContain("ANTHROPIC_API_KEY");expect(es.hint).toBeTruthy();
});
