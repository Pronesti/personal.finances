// Current-source adapter for the portable report-input/reports.expected contract.
// A rebuild supplies equivalent projections; it need not copy these module boundaries.
import {baseCatalog,cardAccounts,purposeGroups} from "../../web/src/lib/accounting/catalog";
import {spendingUiModel,accountingDrill,timingUiModel,currencyUiModel} from "../../web/src/lib/accounting/spending-ui-model";
import {flowModel} from "../../web/src/lib/accounting/reports/spending";
import {paceModel} from "../../web/src/lib/accounting/reports/timing";
import {commitmentsData} from "../../web/src/lib/accounting/reports/commitments";
import {buildAnalytics} from "../../web/src/lib/receipts/analytics";
export function reportSnapshot(input:any,supermarket:any){
 const {facts,statements,schedules,rates,scope,cards,sources}=input;
 const inspection={accounts:[...baseCatalog(),...cards.flatMap((c:any)=>cardAccounts(c.id,c.displayName))],groups:purposeGroups(),cards,sources,journals:[],reviews:[],alertStates:[]};
 const commitments=commitmentsData({facts,statements,schedules,inspection,scope,rates,locale:"en"});
 return {
  spending:spendingUiModel(facts,inspection,scope,rates),
  billed:spendingUiModel(facts,inspection,{...scope,basis:"billed"},rates),
  realQuarter:spendingUiModel(facts,inspection,{...scope,value:"real",granularity:"quarter"},rates),
  usdYear:spendingUiModel(facts,inspection,{...scope,value:"usd",granularity:"year"},rates),
  taxIncluded:spendingUiModel(facts,inspection,{...scope,tax:"incl"},rates),
  foodDrill:accountingDrill(facts,inspection.accounts,scope,rates,{account:"expense:food",merchant:null}),
  flow:flowModel(facts,scope,rates),
  timing:timingUiModel(facts,scope,rates),
  currency:currencyUiModel(facts,scope,rates),
  pace:paceModel(facts,statements,scope,rates),
  commitments,
  supermarket:buildAnalytics(supermarket.receipts,supermarket.items),
 };
}
