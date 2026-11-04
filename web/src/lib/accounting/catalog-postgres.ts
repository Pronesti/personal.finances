import type {PoolClient} from "pg";
import type {CatalogTx} from "./catalog-service";
import type {Account} from "./model";
import type {AccountGroup} from "./catalog";
export function postgresCatalogTx(client:PoolClient):CatalogTx{return {
 async ensureCard(id){await client.query("INSERT INTO cards(id) VALUES($1) ON CONFLICT DO NOTHING",[id]);},
 async upsertAccount(a){await client.query("INSERT INTO accounts(id,parent_id,type,label_key,custom_name,currency,primary_purpose_id,posting,enabled) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(id) DO NOTHING",[a.id,a.parentId,a.type,a.labelKey,a.customName,a.currency,a.primaryPurposeId,a.posting,a.enabled]);const r=await client.query("SELECT parent_id,type,currency,posting,primary_purpose_id FROM accounts WHERE id=$1",[a.id]);const old=r.rows[0];if(old.parent_id!==a.parentId||old.type!==a.type||old.currency!==a.currency||old.posting!==a.posting||old.primary_purpose_id!==a.primaryPurposeId)throw Error("account_definition_conflict");},
 async catalogAccounts(){return (await client.query('SELECT id,parent_id AS "parentId",type,label_key AS "labelKey",custom_name AS "customName",currency,primary_purpose_id AS "primaryPurposeId",posting,enabled FROM accounts ORDER BY id')).rows as Account[];},
 async catalogGroups(){return (await client.query("SELECT DISTINCT ON (group_id) payload FROM account_group_revisions ORDER BY group_id,ordinal DESC")).rows.map(r=>r.payload as AccountGroup);},
 async appendAccountName(r){await client.query("INSERT INTO account_name_revisions VALUES($1,$2,$3,$4)",[r.id,r.accountId,r.customName,r.recordedAt]);await client.query("UPDATE accounts SET custom_name=$2 WHERE id=$1",[r.accountId,r.customName]);},
 async appendGroup(r){await client.query("INSERT INTO account_groups VALUES($1) ON CONFLICT DO NOTHING",[r.group.id]);await client.query("INSERT INTO account_group_revisions VALUES($1,$2,$3,$4)",[r.id,r.group.id,r.group,r.recordedAt]);},
 async catalogReceipt(key){return (await client.query("SELECT key,digest,result FROM catalog_commands WHERE key=$1",[key])).rows[0]??null;},
 async appendCatalogReceipt(r){await client.query("INSERT INTO catalog_commands VALUES($1,$2,$3)",[r.key,r.digest,r.result]);},
};}
