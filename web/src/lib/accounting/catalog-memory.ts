import {validateCatalog} from "./catalog";
import {AccountingError,type Account} from "./model";
import type {CatalogTx,CatalogReceipt,AccountNameRevision,GroupRevision} from "./catalog-service";
export type CatalogMemoryState={names:AccountNameRevision[];groups:GroupRevision[];commands:CatalogReceipt[]};
export const createCatalogMemoryState=():CatalogMemoryState=>({names:[],groups:[],commands:[]});
export function memoryCatalogTx(state:CatalogMemoryState,accounts:Account[],cards:Set<string>):CatalogTx{return {
 async ensureCard(id){cards.add(id);},
 async upsertAccount(a){const old=accounts.find(v=>v.id===a.id);if(old){if(old.parentId!==a.parentId||old.type!==a.type||old.currency!==a.currency||old.posting!==a.posting||old.primaryPurposeId!==a.primaryPurposeId)throw new AccountingError("account_definition_conflict");return;}validateCatalog([...accounts,a]);accounts.push(structuredClone(a));},
 async catalogAccounts(){return structuredClone(accounts);},
 async catalogGroups(){const groups=new Map();for(const r of state.groups)groups.set(r.group.id,r.group);return structuredClone([...groups.values()]);},
 async appendAccountName(r){const account=accounts.find(a=>a.id===r.accountId);if(!account)throw new AccountingError("missing_account");account.customName=r.customName;state.names.push(structuredClone(r));},
 async appendGroup(r){state.groups.push(structuredClone(r));},
 async catalogReceipt(key){return structuredClone(state.commands.find(c=>c.key===key)??null);},
 async appendCatalogReceipt(r){if(state.commands.some(c=>c.key===r.key))throw new AccountingError("command_conflict");state.commands.push(structuredClone(r));},
};}
