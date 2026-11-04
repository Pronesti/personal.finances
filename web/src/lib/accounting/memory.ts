import {createReviewMemoryState,memoryReviewTx} from "./review-memory";
import {createCatalogMemoryState,memoryCatalogTx} from "./catalog-memory";
import { createEvidenceMemoryState, memoryEvidenceTx } from "./evidence-memory";
import { AccountingError, type Account, type CommandReceipt, type Journal, type PurchaseVersion, type Billing, type Payment, type Attribution, type LinkedCredit, type CorrectionLink, type ComponentRevision, type CreditRevision, type AttributionRevision } from "./model";
import { outstandingComponents } from "./attribution";
import { validateJournal } from "./journal";
import type { LedgerPort } from "./port";
export function createMemoryLedger(seed: { accounts?: Account[]; cardIds?: string[]; evidenceIds?: string[] } = {}): LedgerPort {
  let accounts = structuredClone(seed.accounts ?? []);
  let cards = new Set(seed.cardIds ?? []);
  let evidence = new Set(seed.evidenceIds ?? []), evidenceState = createEvidenceMemoryState();
  let reviewState=createReviewMemoryState();
  let catalogState=createCatalogMemoryState();
  let openingObligations: import("./model").OpeningObligation[] = [];
  let attributionRevisions: AttributionRevision[] = [];
  let creditRevisions: CreditRevision[] = [];
  let corrections: CorrectionLink[] = [], componentRevisions: ComponentRevision[] = [];
  let purchases: PurchaseVersion[] = [], billings: Billing[] = [], payments: Payment[] = [], attributions: Attribution[] = [], credits: LinkedCredit[] = [];
  let journals: Journal[] = [], commands: CommandReceipt[] = [], tail: Promise<unknown> = Promise.resolve();
  return {
    async transaction(work) {
      const previous = tail; let release!: () => void;
      tail = new Promise<void>(resolve => { release = resolve; });
      await previous;
      const nextOpeningObligations=structuredClone(openingObligations);
      const nextReviewState=structuredClone(reviewState);
      const nextAccounts=structuredClone(accounts),nextCards=new Set(cards),nextCatalogState=structuredClone(catalogState);
      const nextAttributionRevisions=structuredClone(attributionRevisions);
      const nextCreditRevisions=structuredClone(creditRevisions);
      const projectedCredits=()=>creditsProjection(nextCredits,nextCreditRevisions);
      const nextCorrections=structuredClone(corrections),nextComponentRevisions=structuredClone(componentRevisions);
      const nextPurchases=structuredClone(purchases), nextBillings=structuredClone(billings),nextPayments=structuredClone(payments),nextAttributions=structuredClone(attributions),nextCredits=structuredClone(credits);
      const nextJournals = structuredClone(journals), nextCommands = structuredClone(commands);
      const nextEvidence = new Set(evidence), nextEvidenceState = structuredClone(evidenceState);
      try {
        const result = await work({
          openingObligation: async id => structuredClone(nextOpeningObligations.find(o=>o.id===id)??null),
          openingObligations: async (cardId,currency) => structuredClone(nextOpeningObligations.filter(o=>o.cardId===cardId&&o.currency===currency)),
          appendOpeningObligation: async o => {if(o.evidenceIds.some(id=>!nextEvidence.has(id)) || !nextJournals.some(j=>j.id===o.openingJournalId)) throw new AccountingError("missing_reference");if(nextOpeningObligations.some(v=>v.id===o.id)) throw new AccountingError("opening_obligation_conflict");nextOpeningObligations.push(structuredClone(o));},
          openingBillings: async id => structuredClone(nextBillings.filter(b=>b.openingObligationId===id)),
          openingDate: async (cardId, currency) => nextJournals.filter(j => j.kind === "opening" && j.cardId === cardId && j.currency === currency).map(j => j.effectiveDate).sort().at(-1) ?? nextJournals.filter(j => j.kind === "opening" && j.cardId === cardId).map(j => j.effectiveDate).sort().at(-1) ?? null,
          ...memoryReviewTx(nextReviewState),
          ...memoryCatalogTx(nextCatalogState,nextAccounts,nextCards),
          ...memoryEvidenceTx(nextEvidenceState, id => nextEvidence.add(id)),
          appendAttributionRevision: async r => {if(nextAttributionRevisions.some(v=>v.paymentId===r.paymentId&&v.revision===r.revision)) throw new AccountingError("attribution_revision_conflict");nextAttributionRevisions.push(structuredClone(r));},
          appendCreditRevision: async r => {if(nextCreditRevisions.some(v=>v.id===r.id || (v.creditId===r.creditId&&v.purchaseVersion===r.purchaseVersion))) throw new AccountingError("credit_revision_conflict");nextCreditRevisions.push(structuredClone(r));},
          journal: async id => structuredClone(nextJournals.find(j=>j.id===id)??null),
          appendCorrection: async c => {if(nextCorrections.some(v=>v.id===c.id || (v.purchaseId===c.purchaseId&&v.toVersion===c.toVersion))) throw new AccountingError("correction_conflict");nextCorrections.push(structuredClone(c));},
          appendComponentRevisions: async rows => {for(const r of rows) {if(nextComponentRevisions.some(v=>v.id===r.id || (v.componentId===r.componentId&&v.revision===r.revision))) throw new AccountingError("component_revision_conflict");nextComponentRevisions.push(structuredClone(r));}},
          attributionState: async (cardId,currency) => structuredClone({billings:nextBillings.filter(b=>b.cardId===cardId&&b.currency===currency),payments:nextPayments.filter(p=>p.cardId===cardId&&p.currency===currency),attributions:nextAttributions,credits:projectedCredits(),componentRevisions:nextComponentRevisions,attributionRevisions:nextAttributionRevisions}),
          purchase: async id => structuredClone(nextPurchases.filter(p=>p.purchaseId===id).sort((a,b)=>b.version-a.version)[0]??null),
          appendPurchase: async p => {if(nextPurchases.some(v=>v.purchaseId===p.purchaseId && v.version===p.version)) throw new AccountingError("purchase_version_conflict");nextPurchases.push(structuredClone(p));},
          billings: async id => structuredClone(nextBillings.filter(b=>b.purchaseId===id)),
          appendBilling: async b => {if(nextBillings.some(v=>v.id===b.id || (b.purchaseId!==null && v.purchaseId===b.purchaseId && v.installment===b.installment) || (b.openingObligationId!==undefined && v.openingObligationId===b.openingObligationId && v.installment===b.installment))) throw new AccountingError("billing_conflict");nextBillings.push(structuredClone(b));},
          billedComponents: async (currency,cardId) => structuredClone(outstandingComponents(nextBillings.filter(b=>b.currency===currency&&b.cardId===cardId),nextAttributions,projectedCredits(),nextComponentRevisions,nextAttributionRevisions,nextPayments)),
          appendPayment: async p => {if(nextPayments.some(v=>v.id===p.id)) throw new AccountingError("payment_conflict");nextPayments.push(structuredClone(p));},
          appendAttributions: async rows => {for(const a of rows) {if(nextAttributions.some(v=>v.id===a.id)) throw new AccountingError("attribution_conflict");nextAttributions.push(structuredClone(a));}},
          linkedCredits: async id => structuredClone(projectedCredits().filter(c=>c.purchaseId===id)),
          appendLinkedCredit: async c => {if(nextCredits.some(v=>v.id===c.id)) throw new AccountingError("credit_conflict");nextCredits.push(structuredClone(c));},
          command: async key => structuredClone(nextCommands.find(c => c.key === key) ?? null),
          account: async id => structuredClone(nextAccounts.find(a => a.id === id) ?? null),
          hasChildAccounts: async id => nextAccounts.some(a => a.parentId === id),
          appendJournal: async journal => {
            validateJournal(journal);
            if (!nextCards.has(journal.cardId) || journal.evidenceIds.some(id => !nextEvidence.has(id))) throw new AccountingError("missing_reference");
            if (journal.reversesId !== null && !nextJournals.some(j => j.id === journal.reversesId)) throw new AccountingError("missing_reference");
            if (nextJournals.some(j => j.id === journal.id)) throw new AccountingError("duplicate_journal");
            for (const line of journal.lines) {
              const a = nextAccounts.find(a => a.id === line.accountId);
              if (!a || !a.enabled || !a.posting || nextAccounts.some(child => child.parentId === a.id)) throw new AccountingError("invalid_posting_account");
              if (a.currency !== null && a.currency !== journal.currency) throw new AccountingError("account_currency_mismatch");
            }
            nextJournals.push(structuredClone(journal));
          },
          appendCommand: async receipt => {
            if (nextCommands.some(c => c.key === receipt.key)) throw new AccountingError("command_conflict");
            nextCommands.push(structuredClone(receipt));
          },
        });
        openingObligations=nextOpeningObligations;
        reviewState=nextReviewState;
        accounts=nextAccounts;cards=nextCards;catalogState=nextCatalogState;
        attributionRevisions=nextAttributionRevisions;
        creditRevisions=nextCreditRevisions;
        corrections=nextCorrections;componentRevisions=nextComponentRevisions;
        purchases=nextPurchases;billings=nextBillings;payments=nextPayments;attributions=nextAttributions;credits=nextCredits;
        evidence = nextEvidence; evidenceState = nextEvidenceState;
        journals = nextJournals; commands = nextCommands; return result;
      } finally { release(); }
    },
    async journals(cardId) { await tail; return structuredClone(journals.filter(j => j.cardId === cardId)); },
  };
}

function creditsProjection(credits: LinkedCredit[],revisions: CreditRevision[]):LinkedCredit[] {
 return credits.map(c=>revisions.filter(r=>r.creditId===c.id).sort((a,b)=>b.purchaseVersion-a.purchaseVersion)[0]?.credit??c);
}
