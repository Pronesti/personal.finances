# Open accounting decisions

The user has established the goal: keep current features while introducing double-entry accounting to connect the information, with freedom to replace the implementation. The accepted requirements are consolidated in [the migration requirements](../accounting/requirements.md). This record retains the numbered decisions, accepted installment policy, and remaining interview frontier; it is not an authorization to implement or deploy.

## What the current application connects

- A statement contains billed movements, balances, terms, and installment schedules.
- Merchant aliases and category rules connect related statement descriptions across history.
- Product identities connect receipt items across shopping purchases.
- A receipt can connect to one card charge through an evidence association.
- IPC and MEP connect nominal observations to comparable reporting values.

The missing general connection is between economic purchases, their item evidence, liabilities, actual payments, and the accounts those payments affect. The current [schema and workflows](data-and-workflows.md) establish the available evidence but do not settle how a ledger should represent it.

## Accepted decisions from round one

Recorded from the user's answers on 2026-10-25. “OK” accepts the corresponding recommendation from round one; Q1 and Q6 provide explicit scope changes.

| Question | Accepted decision | Consequence or remaining boundary |
| --- | --- | --- |
| Q1 Financial coverage | First migrate the existing card features into the accounting architecture. Add bank accounts and transfers after those features are migrated. | Bank/transfer workflows are a subsequent stage, not prerequisites for feature parity. Preserve extension points; do not expand the first release to bank, income, investment, or wealth-management features. |
| Q2 Ownership boundary | One person's finances first, with explicit distinct accounts/cards. | Household splits and business books are outside the initial scope. A hosted personal app does not by itself imply a multi-user product. |
| Q3 Preservation standard | Preserve capabilities and source evidence; correct explicitly agreed defects and explain resulting differences. | Exact reproduction of every current figure is not mandatory. No individual behavior correction is approved merely by accepting this principle. |
| Q4 History and cutover | Retain all evidence and decisions; test historical reconstruction in an isolated copy before choosing cutover; use explicit opening balances for missing prehistory. | Full historical reconstruction versus prospective cutover is deferred until evidence establishes feasibility. Retention of history is already required. |
| Q5 Currency requirements | Preserve native ARS/USD amounts and actual conversion evidence where available; retain IPC/MEP as distinct reporting lenses. | Other currencies have not been requested. Functional valuation, settlement, and exchange-difference policies remain open, with bank settlement behavior staged later. |
| Q6 Operating boundary | Support hosting and migrate persistence to PostgreSQL. | Hosting is required. Provider, access model, document storage, OCR platform, and permission to send documents to third-party processing services remain undecided. Current local-only processing is not a target requirement. |
| Q7 Primary accounting outcome | Connect purchase/receipt evidence, card liability, and the actual payment account with explainable balances and no duplicate expense. | Deliver this in Q1's sequence: card/purchase/receipt connections first; actual bank-account/payment connections when bank features are added. How to represent existing statement payment lines before bank import is Q9. |

These answers authorize documenting requirements and continuing the interview. They do not request accounting implementation, a database migration, deployment, or external processing of financial documents.

## Round two decisions and open items

Recorded from the user's next answers on 2026-10-25. Q9 and Q11–Q14 accept their recommendations. Q8 initially requested research only and was accepted after the later recommendation below. Q10 requires a chart of accounts without settling the mapping, and Q15 specifies no login for now.

| Question | Status | Result |
| --- | --- | --- |
| Q8 Installment recognition | Accepted after research and recommendation | Recognize one evidenced purchase and full known principal once, distinguish billed/unbilled liability per card and currency, and treat repayment separately. Preserve distinct analytical views, supported financing costs and missing-history limits; see [the accepted policy](../accounting/installments.md). |
| Q9 Statement payments | Accepted | Reduce card liability against an unresolved payment-source clearing account until bank evidence can identify and reconcile the source. |
| Q10 Chart of accounts | New chart required; account detail, groups and allocation conventions accepted | Rebuild from actual expenses rather than preserve either current category system. Q16 accepts intermediate detail and Q18 accepts primary-purpose summaries plus overlapping groups. Q21 assigns purchases made while abroad to Travel, excluding online subscriptions. Q22–Q24 settle linked credits, receipt-based allocation and unallocated supermarket purchases. Individual uncertain mappings and posting policies remain open. |
| Q11 Conflicting evidence | Accepted | Preserve receipt and issuer amounts; flag discrepancies and require an explained reconciliation instead of silently overwriting either source. |
| Q12 Audit history | Accepted | Version evidence; correct posted entries through explicit reversal/replacement; keep prior entries traceable. Extraction drafts may remain editable, and classification/review decisions must be retained. |
| Q13 Native currencies | Accepted for initial card migration | Balance native ARS and USD entries independently and preserve available rate evidence; keep MEP/IPC in reports. Functional valuation and cross-currency settlement remain later policy work. |
| Q14 Hosted OCR | Accepted | Permit PDF processing within the private hosted installation; retain exact-cent verification and correction; evaluate compatible OCR against fixtures. No external document/OCR API permission was given. |
| Q15 Login | No login for now | Do not add an application login to the initial scope. Public exposure, private networking, and any infrastructure-level access controls have not been selected. |

### Q8 Installment recognition

For a known ARS 600 purchase billed in six ARS 100 installments, should the accounting system recognize the purchase and full card liability once, while tracking monthly billed installments separately, or recognize expense only as installments are billed?

Accepted on 2026-10-25 with “Q8 OK,” after the user requested a recommendation based on [the research](../research/2026-10-25-installment-accounting.md). The [accepted policy](../accounting/installments.md) recognizes one evidenced purchase and full known principal once, uses billed/unbilled liability subaccounts per card and native currency, and treats actual repayment separately. Ordinary consumption is expensed when acquired; explicit assets/prepayments retain appropriate treatment. Preserve purchase-period, billed-cycle, payment and commitment views without double counting, distinguish supported financing costs, and use supported opening obligations where history is incomplete rather than fabricating prior events. Exact correction dates, nonstandard financing evidence and final historical cutover remain separate requirements. No accounting implementation is authorized by this documentation decision.

### Q9 Statement payments before bank integration

When a statement says “payment received” but the first release has no corresponding bank transaction, how should that imported payment be represented?

Accepted: reduce the card liability against an explicitly unresolved payment-source clearing account. Keep the statement evidence and reconcile that clearing balance when bank integration arrives; do not invent a bank account or treat the repayment as income or reduced purchase spending.

### Q10 Categories and accounting accounts

The chart of accounts is required. The user's next instruction explicitly rejects treating the current spending and supermarket category lists as the desired structure. Research actual expense lines and propose a new account list, informed by common personal-finance grouping practice.

Required capability: a grouping type that can reference multiple accounts, including expense and liability accounts. Do not force those groups to replace accounting types or require the old categories to map one to one.

The [new account/group proposal](../proposals/personal-chart-of-accounts.md) uses authorized read-only review of all 1,632 current statement movements and 251 receipt item rows. It includes a complete local descriptor-family review, explicit confidence limits, and suggested account leaves. The [public grouping research](../research/2026-10-25-personal-finance-grouping.md) distinguishes household purposes from accounting roles. Q16–Q20 subsequently accept its intermediate detail and group strategy, change the Travel rule, and confirm the purposes of car payments and car insurance. The old candidate mappings must be read with those updates; no application reclassification or journal policy is authorized by them.

### Q11 Conflicting receipt and issuer evidence

When a receipt and possible card charge disagree beyond documented installment rounding, should the system preserve both sources and ask for reconciliation, or automatically adjust one to match the other?

Accepted: preserve both original amounts, flag the discrepancy, and require an explained reconciliation. Neither source silently overwrites the other. Partial payments, issuer credits, OCR corrections, and timing differences may explain a mismatch; their detailed treatment follows after this evidence policy.

### Q12 Corrections and audit history

Once an import has produced accounting entries, should corrections preserve earlier evidence and reverse/replace the affected entries, or may they delete and rebuild that accounting history as statement ingestion currently does?

Accepted: version source evidence and preserve posted entries through explicit reversal/replacement, with traceability to the correction. Unposted extraction drafts can be replaceable. Retain categorization/product decisions and alert review history as well; decide their exact revision policy later.

### Q13 Currency balancing in the card-only release

Should the initial journal balance independently in native ARS and USD, keeping MEP/IPC conversion in reports, or should every USD entry also require a fixed ARS accounting valuation from the start?

Accepted: balance native-currency entries independently for the initial card migration and preserve rate evidence where available. Keep MEP/IPC reporting separate; decide functional valuation and cross-currency settlement before implementing bank conversions.

### Q14 Hosted receipt processing and document privacy

Hosting changes the current macOS-only receipt OCR boundary. Which is acceptable: upload PDFs to the hosted installation and process them there with hosting-compatible OCR; retain a local Mac OCR worker; or permit an external document/OCR API?

Accepted: allow processing within the private hosted installation, preserve the exact-cent admission/correction workflow, and evaluate hosting-compatible OCR against existing fixtures before choosing an engine. Permission for an external document OCR/AI API remains separate from the existing merchant-name classification boundary.

### Q15 Hosted access model

User decision: no application login for now.

This supersedes the authenticated-login recommendation. Network exposure and infrastructure controls are not settled by that decision; resolve them when deployment is concrete. Multiple independent financial books and offline synchronization remain outside the initial requirements.

## Dependent decisions for later rounds

These are a design tree, not a list of choices already made:

```text
Cards and existing features first + one person + traceable purchase/liability goal
  → Q8 one purchase/full known principal, billed/unbilled debt and separate repayments: accepted
  → Q9 issuer payments via unresolved source clearing: accepted
  → Q10 new chart from expense evidence + cross-type grouping: required
  → Q16 intermediate detail and Q18 overlapping custom groups: accepted
  → Q17/Q21 purchases made while abroad go to Travel; online subscriptions excluded
  → Q19 car-payment purpose and Q20 car insurance: confirmed
  → Q22 credits follow original account; Q23 allocate same purchase by reviewed items
  → Q24 no receipt: keep domestic supermarket purchase Unallocated
  → Q25 validated known-nature imports post automatically: accepted
  → Q26 selected-purchase correction with explicit future/history options: accepted
  → Q27 latest corrected historical analytics with inspectable audit history: accepted
  → Q11 preserve conflicting evidence and reconcile explicitly: accepted
  → Then: exact dates/accounts, refund/promotion/tax rules, item allocation
  → Later release: bank accounts, payment reconciliation, transfers

Native ARS/USD + preserved rate evidence + separate IPC/MEP reports
  → Q13 native balancing in the first release: accepted
  → Then: applicable rate/fallback policies and explicit report differences
  → Before bank conversions: settlement, revaluation, and exchange differences

Preservation standard + agreed accounting semantics
  → Which report semantics stay compatible and which change
  → Categories/product departments versus accounting accounts and dimensions
  → Forecasts and inflation analysis as derived reports

Retain history + isolated reconstruction before choosing cutover
  → Q12 posted corrections by reversal/replacement and source versions: accepted
  → Then: opening balances, deduplication, review identity, revision rules
  → Evidence prerequisite: reconstruction trial before final cutover choice

Hosting + PostgreSQL
  → Q14 hosted OCR with exact-cent gate: accepted; engine not selected
  → Q15 no application login for now: selected; network exposure not selected
  → Then: durable document storage, OCR engine, provider, deployment and backups
  → Explicit requirement before adding offline synchronization
  → Delivery stages and acceptance on representative historical evidence
```

## Account proposal decisions

Recorded from the user's next answers on 2026-10-25. Q16 and Q18 accept their recommendations; Q17 replaces the earlier Travel recommendation; Q19 and Q20 supply user-confirmed purposes. At this stage Q8 was research-only; it was accepted subsequently as recorded above.

| Question | User answer | Recorded outcome |
| --- | --- | --- |
| Q16 Account detail | OK | Use the proposed intermediate account detail, including seven grocery subaccounts; groups/parents provide summaries, with no account per SKU. |
| Q17 Travel | Foreign charges go to travel account | Purchases made while abroad use Travel rather than their ordinary domestic purpose account. Q21 clarifies that online subscriptions are excluded and currency alone does not determine membership. Core travel services remain Travel by their purpose. |
| Q18 Overlap | OK | Use one primary purpose for additive summaries and optional overlapping custom groups. Preserve separate expense, asset, and debt measures across types, with allocation evidence for mixed-purpose card balances. |
| Q19 Vehicle plan | Is Car payments | The recurring vehicle-plan line has a user-confirmed car-payment purpose under Transportation. This does not establish how much is principal, contribution rights, administration, insurance, or interest; detailed financial treatment remains open. |
| Q20 Sancor | Just car | Classify its insurance purpose as vehicle insurance under Transportation. Policy identity can be retained without inferring home or other insured risks. |

### Q16 Account detail

Do you prefer the proposed detail, including seven grocery subaccounts, or one Groceries account with the food-kind breakdown retained only in product analytics?

Accepted: use the proposed intermediate detail, including the seven grocery subaccounts, with groups/parents as default summaries and no account per SKU. Product identity still supports more detailed price analysis.

### Q17 Travel scope

Should Travel mean core travel purposes such as flights, hotels and travel insurance, or all costs incurred on a trip, including food, fuel, and purchases?

User decision: foreign charges go to the Travel account. Q21 clarifies purchases made while abroad, excluding online subscriptions. This supersedes ordinary domestic expense-purpose accounts for those purchases and extends Travel beyond flights/lodging/insurance. Retaining item/purchase detail remains useful, but does not override this account choice; foreign currency or merchant nationality alone is insufficient evidence.

### Q18 Overlapping groups

Should one account be allowed in multiple groups, such as both Home and a custom Renovation group, or must every account belong to exactly one group?

Accepted: one primary purpose for additive summary charts, plus optional overlapping custom groups. Cross-type group reports show expense activity, assets, and outstanding debt as separate measures; mixed-purpose card debt requires allocation evidence rather than repeating its whole balance in every purpose.

### Q19 Vehicle-plan evidence

What does the recurring vehicle-plan line represent: contributions toward a vehicle not yet delivered, financing after delivery, or another arrangement?

User confirmation: car payments. Record that purpose under Transportation. Contributions/principal, administration, insurance, and interest may still map differently; do not infer their split or the financing/ownership mechanism from that purpose label. Do not keep asking whether the line is car-related; that is settled.

### Q20 Insurance coverage

What does the Sancor policy in these statements cover: a vehicle, home, another risk, or several policies?

User confirmation: car only. Use Vehicle insurance under Transportation; retain policy identity/detail. The old provider-only low-confidence classification is superseded by this user evidence.

## Travel credit and allocation decisions

Recorded from the user's next answers on 2026-10-25. Q21 gives the exact Travel criterion; Q22–Q24 accept their recommendations. These are requirements for the future model, not changes applied to the live database.

| Question | User answer | Recorded outcome |
| --- | --- | --- |
| Q21 Foreign criterion | Purchases made while abroad, not online subscriptions | Meals, transport, shopping and other purchases made while abroad use Travel. Online subscriptions retain their ordinary accounts; foreign billing currency alone is not sufficient. Core travel purchases, such as flights and accommodation, still use Travel by their purpose. |
| Q22 Linked credits | OK | A refund or directly linked promotion follows the original purchase account, including Travel when applicable; retain the credit as a separate event. Unrelated rewards and uncertain tax credits remain for review. |
| Q23 Receipt allocation | OK | Reviewed items on a verified, linked domestic receipt allocate the same purchase across accounts. Their allocations reconcile to the purchase total; no second purchase or full reallocation against each installment is created. |
| Q24 Missing receipt | OK | A domestic supermarket purchase without sufficient item detail remains Unallocated purchases, retaining the amount, merchant evidence and review status in reports rather than assuming Groceries or inventing a split. |

### Q21 Foreign-purchase criterion

When foreign charges go to Travel, does foreign mean purchases made while abroad, every charge billed in a non-ARS currency, or every foreign-merchant charge even if billed in ARS? This changes treatment of online services such as AI tools, streaming, and hosting.

Accepted: purchases made while abroad go to Travel; online subscriptions do not. A foreign currency, overseas processor, or subscription renewal during travel does not by itself qualify. Keep uncertain travel evidence for review rather than assigning all non-ARS charges to Travel. Core travel services already belong to Travel by their purpose, even if booked before departure.

### Q22 Refunds and linked promotions

Should a refund or directly linked issuer promotion reduce the same purchase account, including Travel when applicable, or appear in a separate income/credit account?

Accepted: follow the original purchase account for a directly linked refund/discount, preserving the credit as a distinct event. Unlinked rewards or uncertain tax credits remain for review rather than being forced into that rule. This concerns classification, not permission to erase posted history.

### Q23 Receipt-based allocation

When a domestic supermarket receipt is verified and linked to a card purchase, should its reviewed items split that same purchase across grocery, cleaning, personal-care, pet, and other accounts?

Accepted: allocate the original purchase once from reviewed items, with allocations reconciling to its total. The receipt does not add a second expense and is not reallocated in full to every installment. A discrepancy follows accepted Q11 instead of forcing equality by changing source amounts. This does not approve an incorrect product match merely because receipt arithmetic passed verification.

### Q24 Missing item detail

For a domestic supermarket purchase without a receipt, should the total provisionally go to Groceries, or stay in Unallocated purchases until item detail is available?

Accepted: Unallocated purchases with the supermarket evidence and review status visible, because the basket can include several purposes. This is a classification bucket for existing purchase evidence, not a decision to omit its amount or delay unrelated reporting. No allocation percentages are invented.

## Import and correction workflow decisions

Recorded from the user's next answers on 2026-10-25: Q25 and Q26 accept their recommendations. These requirements apply once the relevant accounting rules exist; they are not an instruction to post records in the current application.

| Question | User answer | Accepted outcome |
| --- | --- | --- |
| Q25 Import posting | OK | Post automatically when identity, financial nature and totals are established under the agreed rules. Uncertain purpose can use Unallocated purchases; ambiguous nature, duplicate identity or conflicting totals stays in review. Do not invent principal, past events or funding accounts to make an import postable. |
| Q26 Correction scope | OK | Default to the selected purchase. Provide explicit options for a reusable rule affecting future imports and for applying it to matching history. Preserve the current bulk capability as an explicit action; posted corrections retain reversal/replacement history. |

### Q25 Import review and posting

Should verified imports post automatically when their identity, financial nature and totals are established, or should every import remain a draft until manually approved?

Accepted: automatic posting for records established by the agreed accounting rules and validation, with uncertain purpose assigned to Unallocated purchases where appropriate. Ambiguous financial nature, duplicate identity or conflicting source totals stays in review. Automatic posting still depends on finalizing the applicable recognition rules; it is not authority to invent a principal, payment source, or unknown past event. Accepted Q9 still permits the explicit unresolved payment-source clearing role.

### Q26 Scope of account corrections

When an account assignment is corrected, should that affect only the selected purchase, future matching purchases, or matching history as well?

Accepted: selected purchase by default, with explicit options to create/update a reusable rule for future imports and to apply it to matching history. Preserve the existing family-wide correction capability as an explicit action; posted historical corrections follow accepted reversal/replacement rules. Product identity corrections and receipt-line allocations retain their own evidence rather than blindly assigning an entire mixed merchant to one account.

## Historical reporting decision and remaining frontier

Q27 accepts the latest corrected classification in historical analytics. Q8 now accepts [the installment policy](../accounting/installments.md) explicitly following research and recommendation. Cutover choice waits for the agreed historical reconstruction trial, and hosting/OCR implementation choices wait for engineering evaluation rather than additional speculative product questions.

### Q27 Historical analytics after correction

When an old purchase is corrected, should historical spending charts show the latest corrected classification, or stay frozen as originally shown?

Accepted: historical analytics use the latest corrected classification, while the original evidence, earlier assignments and posted-entry revisions remain inspectable in the audit history. This does not authorize erasing postings or selecting legal posting/period-close dates; it distinguishes the current analytical view from the correction record. A separate full “as originally reported” chart mode is not required unless requested.

## Concrete scenarios to resolve after the prerequisites

- For an ARS 600 purchase first observed at installment three, apply accepted Q8 missing-history limits. The isolated reconstruction trial must establish which original facts and opening obligations are supported before choosing the historical cutover; do not fabricate the earlier spending or repayments.
- A receipt has ARS 100 gross and ARS 20 item discounts, while an issuer later returns another ARS 10 promotion. Which events are purchase discount versus subsequent credit, and when do expense/liability balances change?
- One grocery receipt is paid partly by wallet and partly by card. Another charge covers two receipts. What allocations are required, and how should unmatched amounts remain explainable?
- A USD purchase is settled by an ARS payment at an actual rate different from monthly MEP. What evidence establishes settlement, and where should exchange differences appear?
- Apply Q12/Q29 to a corrected statement after posting/reconciliation: retain original evidence and immutable reversal/replacement history, correct original facts in their effective period and preserve actual correction time. Reconciliation must expose the changed evidence and affected allocations.
- Two cards with the same brand close on the same day and buy from the same merchant on the same date. How are accounts, purchases, billed appearances, and payments distinguished?
- Apply accepted Q30 when a receipt precedes its statement: supported acquisition/payment/card facts may establish one purchase; insufficient facts remain in review without suppressing receipt analytics. Later evidence confirms/enriches rather than duplicating it.

## Accepted foundation policies

Accepted on 2026-10-25: the user answered “Q28 OK. Q29 OK. Q30 OK. Q31 OK.” All four recommendations below are accepted. No further product-policy answer currently blocks an isolated ledger foundation. Historical cutover, ambiguous-case evidence, hosting/OCR evaluation and the later bank release remain separately staged. Acceptance records domain requirements and does not instruct implementation.

### Q28 Ordinary durable purchases versus tracked assets

Should ordinary personal purchases such as appliances, furniture and electronics be expensed when acquired, with asset tracking limited to explicitly identified cases, or should the first release introduce capitalization/depreciation rules for them?

Accepted: expense ordinary personal consumption, including ordinary durable household goods, by default. Only use a tracked asset or prepayment when explicitly identified and supported by evidence; otherwise leave ambiguous financial nature for review. Do not introduce automatic capitalization thresholds or general depreciation features in the first release. This is an accepted personal-app scope choice, not a tax-accounting rule. Car-payment purpose alone still establishes neither ownership nor financing components.

### Q29 Correction dates and period locks

When an old posted purchase is corrected, should the reversal/replacement affect its original economic period, with the actual correction time retained, or post into the current period? Should the initial personal system have locked accounting periods?

Accepted: for a correction to an original fact or classification, preserve the original effective period and record the actual correction time and immutable reversal/replacement chain. Have no period locks initially. A new refund or later charge remains a separate event on its own evidenced date. This aligns with Q27's restated analytics without treating every later event as an original-period correction. Period-close workflows can be added if needed later.

### Q30 Receipt-first recognition

If a verified receipt arrives before the card statement, when should it create the purchase and card liability rather than remain source evidence awaiting confirmation?

Accepted: allow it to establish the purchase when the acquisition, amount, payment method and specific card identity are supported. Record supported principal once and retain pending statement reconciliation; do not guess that a receipt amount establishes a financing schedule. A later statement confirms/enriches the same purchase and moves evidenced billed principal to billed liability. If payment or acquisition facts are insufficient, retain the receipt and its existing analytics while keeping the proposed accounting posting in review. Arithmetic verification alone is insufficient. More complex split-payment cases remain reviewable until all required allocations are supported.

### Q31 Repayment allocation for purpose-specific debt

When an issuer reports a card payment but does not identify which purchases it settles, how should that payment reduce the debt shown under Food, Travel, Transportation and other purposes?

Accepted: use explicit issuer allocation evidence where present. Otherwise apply an explicitly disclosed oldest-billed-first analytical convention to the billed balance; keep unsupported opening debt in its own unattributed component and any excess payment as an unapplied card credit until supported. The convention must not claim the issuer settled those specific purchases, must not reduce unbilled principal without evidence, and must reconcile purpose components/unattributed amounts to the card balance. This choice affects debt attribution only; purchase expenses and the total card repayment do not change. Q31 explicitly establishes this mixed-balance convention; the earlier single-payment Q8 example did not do so.

Q28–Q31 are resolved by the explicit user answers. Their acceptance does not settle final historical cutover, deployment choices, unknown financing components or the later bank settlement policy.

## Multilingual accounting features

The user added multilingual preservation to the accounting design on 2026-10-25. Existing English/Spanish support and English default are already part of F31/P26. The [multilingual requirements](../accounting/requirements.md#multilingual-preservation-and-new-accounting-features) extend this behavior to the new accounting features: stable domain identities independent of translated labels, complete interface catalogs, structured localized messages, preserved source evidence and language-independent financial facts/parsing. No application implementation or automatic external translation is authorized.

### Q32 Custom account and group names across languages

When you rename an account or create a custom group, should its name appear exactly as you wrote it in both interface languages, or should you be able to provide a separate English and Spanish name?

Accepted on 2026-10-25 with “Q32 OK”: one shared user-authored name, shown verbatim in either language. Built-in account/group names remain fully translated through stable identifiers; a custom rename overrides that built-in display name in both languages. This avoids requiring two names or silently machine-translating personal labels. Separate per-language custom names are outside the agreed initial scope. No automatic external translation is authorized.

Status: accepted. A custom name is one shared label, not a missing translation. Renaming or switching language never creates a second account/group, changes financial identity, or alters posting amounts. Built-in labels retain complete English/Spanish coverage.

## Decision recording

Continue the numbered interview in chat. After answers, update this document with accepted decisions and remaining questions, and update [the glossary](../../CONTEXT.md) immediately when domain terms are settled. Keep implementation policy out of the glossary. Create an ADR only for an actual, consequential tradeoff whose rationale would otherwise be surprising.

The foundational product-policy frontier is resolved through Q32, including multilingual custom naming. Current-state documentation and accepted accounting requirements can guide isolated implementation once requested. No additional product-policy answer currently blocks the foundation or its naming/presentation behavior. Empirical migration and hosting decisions remain staged; later bank/currency questions belong to that release. Do not equate the resolved foundation policies with completed migration evidence, deployment selection or authorization to implement.
