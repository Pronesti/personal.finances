import fs from 'node:fs';
import {baseCatalog,cardAccounts,purposeGroups} from './reporting/lib/accounting/catalog';
import {spendingUiModel,accountingDrill,timingUiModel,currencyUiModel,topAccount} from './reporting/lib/accounting/spending-ui-model';
import {flowModel,purposeMeasuresFromSnapshot,valuedFacts} from './reporting/lib/accounting/reports/spending';
import {paceModel} from './reporting/lib/accounting/reports/timing';
import {commitmentsData} from './reporting/lib/accounting/reports/commitments';
import {receiptAllocationMatrix} from './reporting/lib/accounting/reports/supermarket';
import {valueFacts} from './reporting/lib/receipts/value';
import {buildAnalytics} from './reporting/lib/receipts/analytics';
const text=fs.readFileSync(0,'utf8');
if(Buffer.byteLength(text)>16*1024*1024)throw new Error('processing_output_limit');
const input=JSON.parse(text);
const {facts,statements,schedules,rates,scope,cards,sources}=input;
const inspection=input.inspection??{accounts:[...baseCatalog(),...cards.flatMap((card:any)=>cardAccounts(card.id,card.displayName))],groups:purposeGroups(),cards,sources,journals:[],reviews:[],alertStates:[]};
const supermarket=input.supermarket??{receipts:[],items:[]};
const common={facts,statements,schedules,inspection,scope,rates,locale:input.locale??'en'};
const result={
  spending:spendingUiModel(facts,inspection,scope,rates),
  ...(input.snapshot?{billed:spendingUiModel(facts,inspection,{...scope,basis:'billed'},rates),realQuarter:spendingUiModel(facts,inspection,{...scope,value:'real',granularity:'quarter'},rates),usdYear:spendingUiModel(facts,inspection,{...scope,value:'usd',granularity:'year'},rates),taxIncluded:spendingUiModel(facts,inspection,{...scope,tax:'incl'},rates)}:{}),
  foodDrill:accountingDrill(facts,inspection.accounts,scope,rates,input.path??{account:'expense:food',merchant:null}),
  flow:flowModel(facts,scope,rates),timing:timingUiModel(facts,scope,rates),currency:currencyUiModel(facts,scope,rates),pace:paceModel(facts,statements,scope,rates),
  commitments:commitmentsData(common),supermarket:(()=>{const values=input.snapshot?supermarket:valueFacts(supermarket,scope.value,rates);return buildAnalytics(values.receipts,values.items,values.rawItems);})(),
  ...(!input.snapshot?{receiptAllocations:receiptAllocationMatrix(input.allocations??[]),purposeMeasures:input.purposeInput?purposeMeasuresFromSnapshot(input.purposeSnapshot,input.purposeInput):[]}:{}),
};
if(!input.snapshot){
 result.foodDrill.totalRows=result.foodDrill.rows.length;result.foodDrill.rows=result.foodDrill.rows.slice(0,200);result.foodDrill.values=result.foodDrill.values.slice(0,200);
 const values=valuedFacts(facts,scope,rates);
 const details=result.spending.merchants.totals.map((merchant:any)=>{
  const own=values.filter((row:any)=>row.fact.merchant===merchant.merchant),active=own.map((row:any)=>row.month).sort(),byAccount=new Map<string,number>();
  for(const row of own){const id=topAccount(row.fact.accountId??'expense:unallocated',inspection.accounts);byAccount.set(id,(byAccount.get(id)??0)+row.amount);}
  return {...merchant,total:merchant.amount,category:[...byAccount].sort((a,b)=>b[1]-a[1])[0]?.[0]??'expense:unallocated',count:new Set(own.filter((row:any)=>row.fact.kind!=='credit').map((row:any)=>row.fact.purchaseId??row.fact.id)).size,firstMonth:active[0]??'',lastMonth:active.at(-1)??'',cumShare:merchant.cumulativeShare};
 });
 Object.assign(result.spending.merchants,{details,top5Share:details.length>=5?details[4].cumShare:null,top20Share:details.length>=20?details[19].cumShare:null});
}
const finite=(value:unknown):void=>{if(typeof value==='number'&&!Number.isFinite(value))throw new Error('invalid_report_number');if(Array.isArray(value))value.forEach(finite);else if(value&&typeof value==='object')Object.values(value).forEach(finite);};finite(result);process.stdout.write(JSON.stringify(result));
