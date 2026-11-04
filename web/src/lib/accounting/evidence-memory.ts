import {memoryHistoricalLinksTx} from "./historical-links-memory";
import type {HistoricalReceiptAssociation} from "./historical-links";
import { AccountingError } from "./model";
import type { PurchaseIdentity } from "./evidence";
import type { EvidenceTx, SourceObject, SourceRevision, SourceLine, StatementFacts, ReviewEvent, SourceImportCommand, ReceiptFacts, ReceiptLinkDecision } from "./evidence-port";
export type EvidenceMemoryState = { historicalAssociations:HistoricalReceiptAssociation[]; objects: SourceObject[]; revisions: SourceRevision[]; lines: SourceLine[]; facts: StatementFacts[]; reviews: ReviewEvent[]; identities: PurchaseIdentity[]; commands: SourceImportCommand[]; receipts: ReceiptFacts[]; receiptLinks: ReceiptLinkDecision[]; receiptEntities: {id:number;chain:string;fiscalId:string|null;keys:string[]}[]; nextReceiptId:number };
export function createEvidenceMemoryState(): EvidenceMemoryState { return { historicalAssociations:[], objects: [], revisions: [], lines: [], facts: [], reviews: [], identities: [], commands: [], receipts: [], receiptLinks: [], receiptEntities: [], nextReceiptId: 1 }; }
const copy = <T>(value: T): T => structuredClone(value);
export function memoryEvidenceTx(state: EvidenceMemoryState, onEvidenceId: (id: string) => void): EvidenceTx {
  return {
    ...memoryHistoricalLinksTx(state.historicalAssociations),
    sourceObject: async hash => copy(state.objects.find(o => o.sha256 === hash) ?? null),
    appendSourceObject: async object => {
      if (!/^[a-f0-9]{64}$/.test(object.sha256) || object.relativePath!==object.sha256 || !Number.isSafeInteger(object.byteLength) || object.byteLength<0) throw new AccountingError("invalid_source_object");
      const old = state.objects.find(o => o.sha256 === object.sha256);
      if (old && (old.relativePath !== object.relativePath || old.byteLength !== object.byteLength)) throw new AccountingError("source_object_conflict");
      if (!old) state.objects.push(copy(object));
    },
    sourceRevision: async id => copy(state.revisions.find(r => r.id === id) ?? null),
    sourceRevisions: async key => copy(state.revisions.filter(r => r.sourceKey === key)),
    sourceByDocument: async (kind, hash, payloadDigest) => copy(state.revisions.filter(r => r.kind === kind && r.documentHash === hash && (payloadDigest===undefined || r.payloadDigest===payloadDigest)).at(-1) ?? null),
    appendSourceRevision: async r => {
      if (state.revisions.some(old => old.id === r.id || old.kind === r.kind && old.documentHash === r.documentHash && old.payloadDigest===r.payloadDigest)) throw new AccountingError("source_revision_conflict");
      if (!state.objects.some(o => o.sha256 === r.documentHash && o.relativePath === r.objectPath) || r.rawObject && !state.objects.some(o => o.sha256 === r.rawObject!.sha256 && o.relativePath === r.rawObject!.relativePath)) throw new AccountingError("missing_source_object");
      if (r.previousRevisionId && !state.revisions.some(old => old.id === r.previousRevisionId && (old.sourceKey === r.sourceKey || old.kind===r.kind && old.documentHash===r.documentHash && (r.kind==="receipt" && old.admission==="rejected" || r.kind==="statement" && old.cardId===r.cardId && r.admission==="pending")))) throw new AccountingError("invalid_previous_revision");
      if (r.previousRevisionId===null && state.revisions.some(old=>old.sourceKey===r.sourceKey) || r.previousRevisionId!==null && state.revisions.some(old=>old.previousRevisionId===r.previousRevisionId)) throw new AccountingError("source_revision_fork");
      state.revisions.push(copy(r)); onEvidenceId(r.id);
    },
    sourceLine: async id => copy(state.lines.find(l=>l.id===id)??null),
    sourceLines: async id => copy(state.lines.filter(l => l.revisionId === id).sort((a,b) => a.occurrence-b.occurrence)),
    appendSourceLine: async line => {
      if (!state.revisions.some(r => r.id === line.revisionId)) throw new AccountingError("missing_source_revision");
      if (state.lines.some(l => l.id === line.id || l.revisionId === line.revisionId && l.occurrence === line.occurrence)) throw new AccountingError("source_line_conflict");
      state.lines.push(copy(line)); onEvidenceId(line.id);
    },
    statementSourceLines: async cardId => copy(state.revisions.filter((r,i)=>r.kind==="statement" && r.admission==="accepted" && (cardId===null || r.cardId===cardId) && !state.revisions.slice(i+1).some(newer=>newer.sourceKey===r.sourceKey && newer.admission==="accepted")).flatMap(revision=>state.lines.filter(line=>line.revisionId===revision.id).map(line=>({revision,line})))),
    statementFacts: async id => copy(state.facts.find(f=>f.revisionId===id)??null),
    currentStatementRevision: async (cardId, closingDate) => copy(state.revisions.filter(r=>r.kind==="statement" && r.cardId===cardId && r.admission==="accepted" && (closingDate===undefined || r.closingDate===closingDate)).sort((a,b)=>(b.closingDate??"").localeCompare(a.closingDate??"") || b.recordedAt.localeCompare(a.recordedAt))[0]??null),
    appendStatementFacts: async facts => {
      if (!state.revisions.some(r=>r.id===facts.revisionId && r.kind==="statement" && r.cardId===facts.cardId)) throw new AccountingError("missing_source_revision");
      if (state.facts.some(f => f.revisionId === facts.revisionId)) throw new AccountingError("statement_facts_conflict");
      state.facts.push(copy(facts));
    },
    reviewEvents: async id => copy(state.reviews.filter(r => r.subjectId === id)),
    appendReviewEvent: async event => { if (!state.revisions.some(r=>r.id===event.subjectId) && !state.lines.some(l=>l.id===event.subjectId)) throw new AccountingError("missing_review_subject"); if (state.reviews.some(r => r.id === event.id)) throw new AccountingError("review_event_conflict"); state.reviews.push(copy(event)); },
    purchaseIdentities: async (cardId, currency, date) => copy(state.identities.filter(p => p.cardId === cardId && p.currency === currency && p.purchaseDate === date)),
    appendPurchaseIdentity: async p => {
      if (state.identities.some(old => old.sourceLineId === p.sourceLineId && old.currency === p.currency)) throw new AccountingError("purchase_identity_conflict");
      state.identities.push(copy(p));
    },
    allPurchaseIdentities: async () => copy(state.identities),
    ensureReceiptEntity: async (chain,fiscalId,documentHash,previousReceiptId) => {
      const keys=[`sha256:${documentHash}`,...(fiscalId?[`fiscal:${fiscalId}`]:[])];
      const existing=state.receiptEntities.filter(e=>e.chain===chain && e.keys.some(key=>keys.includes(key)));
      if (new Set(existing.map(e=>e.id)).size>1 || previousReceiptId!==undefined && existing.some(e=>e.id!==previousReceiptId)) throw new AccountingError("receipt_entity_conflict");
      let entity=existing[0]??(previousReceiptId===undefined?undefined:state.receiptEntities.find(e=>e.id===previousReceiptId&&e.chain===chain));
      if(!entity) {if(previousReceiptId!==undefined) throw new AccountingError("missing_receipt_entity");entity={id:state.nextReceiptId++,chain,fiscalId,keys:[]};state.receiptEntities.push(entity);}
      if (fiscalId!==null && entity.fiscalId!==null && entity.fiscalId!==fiscalId) throw new AccountingError("receipt_entity_conflict");
      if(entity.fiscalId===null) entity.fiscalId=fiscalId;
      entity.keys=[...new Set([...entity.keys,...keys])];return entity.id;
    },
    receiptFacts: async id => copy(state.receipts.find(r=>r.revisionId===id)??null),
    appendReceiptFacts: async facts => {
      if (!state.revisions.some(r=>r.id===facts.revisionId && r.kind==="receipt")) throw new AccountingError("missing_source_revision");
      if (!state.receiptEntities.some(e=>e.id===facts.receiptId)) throw new AccountingError("missing_receipt_entity");
      if (state.receipts.some(r=>r.revisionId===facts.revisionId)) throw new AccountingError("receipt_facts_conflict");
      state.receipts.push(copy(facts));
    },
    acceptedReceipts: async () => copy(state.receipts.filter(f=>state.revisions.some(r=>r.id===f.revisionId && r.admission==="accepted"))),
    receiptLinkDecisions: async id => copy(state.receiptLinks.filter(l=>l.receiptRevisionId===id)),
    allReceiptLinkDecisions: async () => copy(state.receiptLinks),
    appendReceiptLinkDecision: async decision => {
      if (!state.receipts.some(r=>r.revisionId===decision.receiptRevisionId)) throw new AccountingError("missing_receipt_facts");
      if (state.receiptLinks.some(l=>l.id===decision.id || l.key===decision.key)) throw new AccountingError("receipt_link_conflict");
      const previous=state.receiptLinks.filter(l=>l.receiptRevisionId===decision.receiptRevisionId);
      const latest=previous.find(l=>!previous.some(child=>child.previousDecisionId===l.id));
      if ((latest?.id??null)!==decision.previousDecisionId) throw new AccountingError("stale_receipt_link");
      if(decision.action==="link" && state.receiptLinks.some(l=>l.receiptRevisionId!==decision.receiptRevisionId && l.purchaseId===decision.purchaseId && l.action==="link" && !state.receiptLinks.some(child=>child.previousDecisionId===l.id))) throw new AccountingError("purchase_already_linked");
      state.receiptLinks.push(copy(decision));
    },
    sourceImportCommand: async key => copy(state.commands.find(c => c.key === key) ?? null),
    appendSourceImportCommand: async command => { if (state.commands.some(c => c.key === command.key)) throw new AccountingError("command_conflict"); state.commands.push(copy(command)); },
  };
}
