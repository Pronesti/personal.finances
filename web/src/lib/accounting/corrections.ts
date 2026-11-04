import { AccountingError, type Journal, type PurchaseInput } from "./model";
import { purchaseLines } from "./purchases";
export function correctionJournals(original: Journal,replacement: PurchaseInput,input:{reversalId:string;replacementId:string;commandKey:string;recordedAt:string}):{reversal:Journal;replacement:Journal} {
 if(original.cardId!==replacement.cardId || original.currency!==replacement.currency) throw new AccountingError("correction_identity_mismatch");
 return {
  reversal:{...original,id:input.reversalId,commandKey:input.commandKey,kind:"reversal",recordedAt:input.recordedAt,reversesId:original.id,lines:original.lines.map(l=>({...l,debitMinor:l.creditMinor,creditMinor:l.debitMinor}))},
  replacement:{...original,id:input.replacementId,commandKey:input.commandKey,kind:"replacement",recordedAt:input.recordedAt,reversesId:null,effectiveDate:replacement.effectiveDate,evidenceIds:replacement.evidenceIds,lines:purchaseLines(replacement)},
 };
}
