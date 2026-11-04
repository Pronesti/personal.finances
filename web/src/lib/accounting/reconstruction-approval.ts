import {createHash} from "node:crypto";
export type MigrationIdentityApproval={reviewer:string;recordedAt:string;sourceDigest:string;sourceProposalSha256:string;scope:string;approvedLegacyItemIds:number[];excludedLegacyItemIds:{id:number;reason:string}[]};
export function validateIdentityApproval(approvalBytes:Buffer,proposalBytes:Buffer,sourceDigest:string):MigrationIdentityApproval {
 const approval=JSON.parse(approvalBytes.toString()) as MigrationIdentityApproval;
 const proposal=JSON.parse(proposalBytes.toString()) as {supported:{item_id:number}[]};
 if(approval.sourceDigest!==sourceDigest||approval.sourceProposalSha256!==createHash("sha256").update(proposalBytes).digest("hex"))throw Error("migration_approval_source_mismatch");
 if(!approval.reviewer?.trim()||!approval.scope?.trim()||!Number.isFinite(Date.parse(approval.recordedAt))||!Array.isArray(approval.approvedLegacyItemIds)||!Array.isArray(approval.excludedLegacyItemIds))throw Error("invalid_migration_approval");
 const ids=approval.approvedLegacyItemIds;
 if(ids.some(id=>!Number.isSafeInteger(id)||id<1)||new Set(ids).size!==ids.length||ids.some(id=>!proposal.supported.some(row=>row.item_id===id)||approval.excludedLegacyItemIds.some(row=>row.id===id)))throw Error("invalid_migration_approval");
 return approval;
}
