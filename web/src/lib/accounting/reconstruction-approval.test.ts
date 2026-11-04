import {createHash} from "node:crypto";
import {expect,it} from "vitest";
import {validateIdentityApproval} from "./reconstruction-approval";
const proposal=Buffer.from(JSON.stringify({supported:[{item_id:22},{item_id:23}]}));
const base={reviewer:"explicit reviewer",recordedAt:"2026-10-25T12:00:00Z",sourceDigest:"source-sha",sourceProposalSha256:createHash("sha256").update(proposal).digest("hex"),scope:"Listed historical identities only; no future matches or allocations",approvedLegacyItemIds:[22],excludedLegacyItemIds:[{id:23,reason:"contradictory identity"}]};
const bytes=(value:unknown)=>Buffer.from(JSON.stringify(value));
it("accepts only precise listed identities pinned to the reviewed source and proposal",()=>{
 expect(validateIdentityApproval(bytes(base),proposal,"source-sha").approvedLegacyItemIds).toEqual([22]);
 expect(()=>validateIdentityApproval(bytes(base),proposal,"other-source")).toThrow("migration_approval_source_mismatch");
 expect(()=>validateIdentityApproval(bytes(base),Buffer.from("{}"),"source-sha")).toThrow("migration_approval_source_mismatch");
});
it("does not approve excluded, duplicate or unreviewed proposal identities",()=>{
 for(const approvedLegacyItemIds of [[23],[22,22],[999]])expect(()=>validateIdentityApproval(bytes({...base,approvedLegacyItemIds}),proposal,"source-sha")).toThrow("invalid_migration_approval");
});
