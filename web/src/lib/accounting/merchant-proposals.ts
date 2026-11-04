import {createHash} from "node:crypto";
import type {ReportFact} from "./read-model";
/** Historical source identities are eligible for proposals without inventing posted purchases. */
export function historicalProposalMerchants(facts: ReportFact[]): {id:string;normalizedName:string;sourceLineId:string}[] {
 const result=new Map<string,{id:string;normalizedName:string;sourceLineId:string}>();
 for(const fact of facts){
  if(fact.origin!=="historical_acquisition"||!fact.sourceLineId||!fact.merchant?.trim())continue;
  const normalizedName=fact.merchant.trim().toUpperCase(),id=createHash("sha256").update(JSON.stringify(normalizedName)).digest("hex");
  result.set(id,{id,normalizedName,sourceLineId:fact.sourceLineId});
 }
 return [...result.values()];
}
