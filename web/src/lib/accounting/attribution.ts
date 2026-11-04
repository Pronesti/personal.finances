import { AccountingError, type BilledComponent, type ComponentRevision, type Billing } from "./model";
import { exactMinor } from "./journal";
export function allocateOldestBilled(paymentMinor: number, components: BilledComponent[]): { assigned: { componentId: string; purposeId: string | null; minor: number }[]; unappliedMinor: number } {
  let remaining=exactMinor(paymentMinor);
  const ids=new Set<string>();
  const assigned=components.slice().sort((a,b)=>a.billedDate.localeCompare(b.billedDate)||a.purchaseDate.localeCompare(b.purchaseDate)||a.id.localeCompare(b.id)).map(c=>{
    if(ids.has(c.id)) throw new AccountingError("duplicate_component");ids.add(c.id);
    const minor=Math.min(remaining,exactMinor(c.outstandingMinor));remaining-=minor;
    return {componentId:c.id,purposeId:c.purposeId,minor};
  }).filter(r=>r.minor>0);
  return {assigned,unappliedMinor:remaining};
}
export function outstandingComponents(billings: import("./model").Billing[], attributions: import("./model").Attribution[], credits: import("./model").LinkedCredit[], revisions: ComponentRevision[] = [], attributionRevisions: import("./model").AttributionRevision[] = [], payments: import("./model").Payment[] = []): BilledComponent[] {
 const latest=new Map<string,number>();for(const r of attributionRevisions) latest.set(r.paymentId,Math.max(latest.get(r.paymentId)??0,r.revision));for(const a of attributions) latest.set(a.paymentId,Math.max(latest.get(a.paymentId)??0,a.revision));
 const components=revisedBillings(billings,revisions).flatMap(b=>b.components.map(c=>({id:c.id,purchaseId:b.purchaseId,cardId:b.cardId,purposeId:c.purposeId,currency:b.currency,billedDate:b.effectiveDate,purchaseDate:b.purchaseDate,outstandingMinor:c.minor})));
 const active=attributions.filter(a=>a.revision===latest.get(a.paymentId));
 const dated=payments.map(p=>({id:p.id,effectiveDate:p.effectiveDate,recordedAt:p.recordedAt}));
 const events=[...dated.map(p=>({...p,type:"payment" as const})),...credits.map(c=>({id:c.id,effectiveDate:c.effectiveDate,recordedAt:c.recordedAt,type:"credit" as const,credit:c}))].sort(eventOrder);
 // Legacy pure callers without payment metadata still get deterministic deduction.
 for(const a of active.filter(a=>!payments.some(p=>p.id===a.paymentId))) {const c=components.find(c=>c.id===a.componentId);if(c)c.outstandingMinor=Math.max(0,c.outstandingMinor-a.minor);}
 for(const event of events) {
  if(event.type==="payment") {for(const a of active.filter(a=>a.paymentId===event.id)) {const c=components.find(c=>c.id===a.componentId);if(c)c.outstandingMinor=Math.max(0,c.outstandingMinor-a.minor);}continue;}
  const available=components.filter(c=>c.purchaseId===event.credit.purchaseId&&c.billedDate<=event.effectiveDate).map(c=>({...c,outstandingMinor:Math.max(0,c.outstandingMinor-reservedIssuerMinor(payments,event,c.id))}));
  const assigned=allocateOldestBilled(event.credit.billedReductionMinor,available).assigned;
  for(const a of assigned) components.find(c=>c.id===a.componentId)!.outstandingMinor-=a.minor;
 }
 return components;
}
function eventOrder(a:{effectiveDate:string;recordedAt:string;id:string},b:{effectiveDate:string;recordedAt:string;id:string}):number {return a.effectiveDate.localeCompare(b.effectiveDate)||a.recordedAt.localeCompare(b.recordedAt)||a.id.localeCompare(b.id);}
function reservedIssuerMinor(payments:import("./model").Payment[],event:{effectiveDate:string;recordedAt:string;id:string},componentId:string):number {
 return payments.filter(p=>eventOrder(p,event)>0).flatMap(p=>p.issuerAllocations??[]).filter(a=>a.componentId===componentId).reduce((sum,a)=>exactMinor(sum+exactMinor(a.minor)),0);
}
export type ReplayedPayment = {paymentId:string;assigned:{componentId:string;purposeId:string|null;minor:number}[];unappliedMinor:number};
export function replayAttributions(state:import("./model").AttributionState):ReplayedPayment[] {
 const decisions:ReplayedPayment[]=[],rows:import("./model").Attribution[]=[];
 for(const p of state.payments.slice().sort(eventOrder)) {
  const credits=state.credits.filter(c=>eventOrder(c,p)<=0);
  const components=outstandingComponents(state.billings,rows,credits,state.componentRevisions,[],state.payments).filter(c=>c.billedDate<=p.effectiveDate);
  let allocation=allocateOldestBilled(p.amountMinor,components.map(c=>({...c,outstandingMinor:Math.max(0,c.outstandingMinor-reservedIssuerMinor(state.payments,p,c.id))})));
  if(p.issuerAllocations!==null) {
   let sum=0;const seen=new Set<string>(),assigned=[];
   for(const a of p.issuerAllocations) {const c=components.find(c=>c.id===a.componentId);if(!c||seen.has(a.componentId)||!exactMinor(a.minor)||a.minor>c.outstandingMinor) throw new AccountingError("invalid_issuer_allocation");seen.add(a.componentId);sum=exactMinor(sum+a.minor);assigned.push({componentId:c.id,purposeId:c.purposeId,minor:a.minor});}
   if(sum>p.amountMinor)throw new AccountingError("invalid_issuer_allocation");allocation={assigned,unappliedMinor:p.amountMinor-sum};
  }
  decisions.push({paymentId:p.id,...allocation});
  rows.push(...allocation.assigned.map((a,i)=>({...a,id:`${p.id}:${i}`,paymentId:p.id,method:p.issuerAllocations===null?"oldest_billed_first" as const:"issuer" as const,revision:1})));
 }
 return decisions;
}

export function revisedBillings(billings: Billing[],revisions: ComponentRevision[]): Billing[] {
 return billings.map(b=>{
  const applicable=revisions.filter(r=>r.billingId===b.id),latest=new Map<string,ComponentRevision>();
  for(const r of applicable) if(!latest.has(r.componentId)||latest.get(r.componentId)!.revision<r.revision) latest.set(r.componentId,r);
  const components=new Map(b.components.map(c=>[c.id,{...c}]));
  for(const r of latest.values()) components.set(r.componentId,{id:r.componentId,purposeId:r.purposeId,minor:r.minor});
  const newest=applicable.slice().sort((a,c)=>c.revision-a.revision)[0];
  return {...b,purchaseDate:newest?.purchaseDate??b.purchaseDate,components:[...components.values()].filter(c=>c.minor>0)};
 });
}
