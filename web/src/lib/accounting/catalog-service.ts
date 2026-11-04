import { createHash,randomUUID } from "node:crypto";
import {validDate} from "./journal";
import { AccountingError,type Account } from "./model";
import { baseCatalog,cardAccounts,purposeGroups,resolveLabel,validateCatalog,validateGroup,type AccountGroup } from "./catalog";
import type { LedgerPort,LedgerTx } from "./port";
export type CatalogReceipt={key:string;digest:string;result:{accountId?:string;customName?:string|null;groupId?:string}};
export type AccountNameRevision={id:string;accountId:string;customName:string|null;recordedAt:string};
export type GroupRevision={id:string;group:AccountGroup;recordedAt:string};
export interface CatalogTx {
 ensureCard(id:string):Promise<void>;
 upsertAccount(account:Account):Promise<void>;
 catalogAccounts():Promise<Account[]>;
 catalogGroups():Promise<AccountGroup[]>;
 appendAccountName(revision:AccountNameRevision):Promise<void>;
 appendGroup(revision:GroupRevision):Promise<void>;
 catalogReceipt(key:string):Promise<CatalogReceipt|null>;
 appendCatalogReceipt(receipt:CatalogReceipt):Promise<void>;
}
function digest(value:unknown):string{return createHash("sha256").update(JSON.stringify(value)).digest("hex");}
function date(value:string):void{if(!validDate(value.slice(0,10))||!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)||!Number.isFinite(Date.parse(value)))throw new AccountingError("invalid_date");}
export async function seedActualCatalogCards(port:LedgerPort,cards:{id:string;displayName:string}[]):Promise<void>{
 const all=[...baseCatalog(),...cards.flatMap(c=>cardAccounts(c.id,c.displayName))];validateCatalog(all);
 await port.transaction(async tx=>{for(const c of cards)await tx.ensureCard(c.id);for(const account of all)await tx.upsertAccount(account);for(const group of purposeGroups())if(!(await tx.catalogGroups()).some(g=>g.id===group.id))await tx.appendGroup({id:randomUUID(),group,recordedAt:new Date().toISOString()});});
}
export async function saveAccountName(port:LedgerPort,input:{key:string;accountId:string;customName:string|null;recordedAt:string}):Promise<{accountId:string;customName:string|null}>{return port.transaction(tx=>saveAccountNameTx(tx,input));}
export async function saveAccountNameTx(tx:LedgerTx,input:{key:string;accountId:string;customName:string|null;recordedAt:string}):Promise<{accountId:string;customName:string|null}>{
 if(!input.key.trim())throw new AccountingError("invalid_command_key");date(input.recordedAt);const key=`catalog:${encodeURIComponent(input.key)}`,hash=digest([input.accountId,input.customName]),saved=await tx.catalogReceipt(key);
 if(saved){if(saved.digest!==hash)throw new AccountingError("command_conflict");return saved.result as {accountId:string;customName:string|null};}
 const account=await tx.account(input.accountId);if(!account)throw new AccountingError("missing_account");resolveLabel({...account,customName:input.customName},"en");
 const result={accountId:input.accountId,customName:input.customName};await tx.appendAccountName({id:randomUUID(),...result,recordedAt:input.recordedAt});await tx.appendCatalogReceipt({key,digest:hash,result});return result;
}
export async function saveGroup(port:LedgerPort,input:AccountGroup&{key:string;recordedAt:string}):Promise<{groupId:string}>{return port.transaction(async tx=>{
 if(!input.key.trim())throw new AccountingError("invalid_command_key");date(input.recordedAt);const group:AccountGroup={id:input.id,customName:input.customName,labelKey:input.labelKey,accountIds:input.accountIds,additive:input.additive};validateGroup(group);
 const key=`catalog:${encodeURIComponent(input.key)}`,hash=digest(group),saved=await tx.catalogReceipt(key);if(saved){if(saved.digest!==hash)throw new AccountingError("command_conflict");return saved.result as {groupId:string};}
 for(const id of group.accountIds){const account=await tx.account(id);if(!account)throw new AccountingError("missing_account",{accountId:id});if(group.additive&&account.primaryPurposeId!==group.id)throw new AccountingError("invalid_primary_purpose");}
 await tx.appendGroup({id:randomUUID(),group,recordedAt:input.recordedAt});const result={groupId:group.id};await tx.appendCatalogReceipt({key,digest:hash,result});return result;
 });}
