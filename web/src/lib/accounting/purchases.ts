import { AccountingError, type PurchaseInput, type Line } from "./model";
import { exactMinor } from "./journal";
export function purchaseLines(input: PurchaseInput): Line[] {
  if(!input.purchaseId.trim() || !input.allocations.length || !exactMinor(input.principalMinor)) throw new AccountingError("invalid_purchase");
  let sum=0;
  const lines=input.allocations.map(a=>{
    if(!a.purposeId.trim() || !a.accountId.trim() || !exactMinor(a.minor)) throw new AccountingError("invalid_allocation");
    sum=exactMinor(sum+a.minor);return {accountId:a.accountId,debitMinor:a.minor,creditMinor:0,purchaseId:input.purchaseId,purposeId:a.purposeId};
  });
  if(sum!==input.principalMinor) throw new AccountingError("allocation_mismatch");
  return [...lines,{accountId:`${input.cardId}:${input.currency}:unbilled`,debitMinor:0,creditMinor:input.principalMinor,purchaseId:input.purchaseId,purposeId:null}];
}
// Distribute exact minor units proportionally; any rounding remainder stays deterministic.
export function splitMinor(amount: number, weights: number[]): number[] {
  exactMinor(amount);const total=weights.reduce((sum,n)=>exactMinor(sum+exactMinor(n)),0);
  if(!total || amount>total) throw new AccountingError("invalid_allocation");
  // BigInt constructors are available at runtime without changing the ES2017 compilation target.
  const shares=weights.map(w=>Number(BigInt(amount)*BigInt(w)/BigInt(total)));
  let left=amount-shares.reduce((sum,n)=>sum+n,0);
  for(let i=0;left;i=(i+1)%shares.length) {if(shares[i]<weights[i]) {shares[i]++;left--;}}
  return shares;
}
