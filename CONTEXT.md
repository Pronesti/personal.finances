# Tarjetas personal finances

Current local state (2026-10-25): the user-approved live app uses PostgreSQL through the existing Lerd site. All 46 acceptance scenarios and live cutover verification passed. See [implementation status](docs/accounting/implementation-status.md) and [cutover record](docs/accounting/cutover-decision.md); pending source reviews remain explicit. Changes are local and uncommitted.

Tarjetas explains card spending, future commitments, and supermarket purchases from statements and receipts. These terms describe current analysis and agreed accounting concepts; some financial components and account mappings still require evidence.

## Accounting and evidence

**Chart of accounts**:
The organized set of accounting accounts used to classify financial effects and explain balances. Its structure need not reproduce the existing spending categories or product departments one for one.

**Accounting account**:
A named classification in the financial books, such as an expense, asset, liability, income, or equity account. It is distinct from a login, an issuer's account identifier, or a product identity.

**Accounting type**:
The financial role of an account: asset, liability, equity, income, or expense. A household purpose such as Food or Transportation is a different classification.

**Display label**:
The readable name shown for a concept or entity. A label can depend on the interface language or a user's naming choice without changing the identity it describes.

**Custom name**:
A user-authored account or group label shown exactly as entered across interface languages. It is distinct from the translated built-in name and from the identity of the account or group.

**Interface language**:
The language used for the application's controls and explanations. It is distinct from transaction currency, source-document language and financial number conventions.

**Account group**:
A named collection of accounting accounts for a purpose or view, potentially including accounts of different accounting types. Group membership does not change those accounts' financial roles.

**Primary purpose group**:
The purpose used to count a classified amount once in additive summaries. Additional custom groups can overlap for other views.

**Car payment**:
A payment toward the purchase or financing of a vehicle. Its purpose is distinct from the financial components, such as principal and charges, contained in the payment.

**Travel purchase**:
A purchase for travel, such as flights or accommodation, or a purchase made while abroad under the agreed spending convention. Online subscriptions retain their ordinary purpose even when billed in a foreign currency.

**Purchase allocation**:
The distribution of one purchase amount across account classifications supported by its item detail. An allocation explains the original purchase rather than creating an additional purchase.

**Unallocated purchase**:
A recorded purchase whose amount and evidence are retained while its account classification awaits sufficient detail. Its amount remains visible in reporting while it awaits review.

**Linked purchase credit**:
A refund or directly linked promotion attributed to an earlier purchase and its account classification. It remains a distinct event from both the original purchase and a card repayment.

**Statement payment**:
An issuer's record that an amount was applied to a card balance. It can establish a reduction in the card liability even when its bank or wallet source is not yet known.

**Payment-source clearing account**:
An account representing the unresolved origin of a payment already reported by a card issuer. Its balance identifies payment evidence that still needs to be connected to the originating financial account.

**Posted entry**:
A recorded financial effect in the accounting books whose history remains traceable when corrected. A correction is distinct from silently replacing the original event.

**Effective date**:
The date to which a recorded financial effect belongs economically. It can differ from when the system learns or records that effect.

**Recorded time**:
The actual time at which a fact or correction is recorded. It preserves when information became known without changing the economic period it describes.

**Receipt-originated purchase**:
A purchase established from sufficient receipt and payment evidence before its card statement arrives. Later statement evidence can confirm the same purchase.

**Repayment attribution**:
The assignment of a card repayment to components of its debt for analysis. It can follow explicit issuer evidence or a disclosed convention; a convention is not proof that the issuer settled particular purchases.

**Source document revision**:
A changed version of financial evidence linked to the earlier version it corrects. Preserving both versions allows a correction to be explained.

**Restated historical analytics**:
Historical reports that use the latest corrected classification of a purchase. Earlier assignments and their corrections remain available in the audit history.

**Native currency**:
The currency in which a source amount or account balance is denominated, independent of the currency or purchasing-power basis used to display a report.

## Statements and spending

**Statement**:
A card issuer's summary for a billing cycle, including billed movements, closing balances, payment terms, and available installment information.

**Statement movement**:
A line reported by an issuer as a purchase, payment or adjustment, or tax or charge. Its presence on a statement does not by itself establish a new purchase or a bank payment.
_Avoid_: Journal entry, ledger posting

**Cycle month**:
The reporting month assigned to a billing cycle from the midpoint between its previous and current closing dates. It can differ from both the purchase month and the closing month.

**Merchant**:
The common name used to group statement movements belonging to the same seller or service, even when their printed descriptions differ.

**Merchant alias**:
A naming decision that makes a family of printed merchant names refer to one merchant.

**Spending category**:
A broad purpose assigned to a statement movement, optionally refined by a subcategory. A spending category is not yet an accounting account.

**Installment plan**:
A purchase billed in a stated number of installments, with the current installment's position identifying how much of the plan has been billed.

**Purchase recognition**:
Recording the acquisition of goods or services and its financial effect. It is distinct from an installment being billed or a debt being repaid.

**Unbilled principal**:
Recorded purchase principal owed on a card that has not yet been billed by the issuer. It is part of existing debt rather than an estimate of a future purchase.

**Billed balance**:
The recorded card obligation already billed by the issuer, reflecting supported charges, payments, credits and other adjustments. Billing an installment does not itself repay it.

**Billed spending view**:
The amounts billed as purchases in each statement cycle; the current interface calls this view “cash.” It does not measure actual payments from a bank or wallet.

**Purchase commitment view**:
The remaining purchase principal recognized once at the earliest installment available in the imported history; the current interface calls this view “accrual.” With complete history from installment one, this represents the full purchase price.

**Recurring charge**:
A merchant's purchase charges that recur with sufficient regularity across billing months. Regular occurrence and confidence that it is a subscription are separate judgments.

**Integrity alert**:
A discrepancy between selected issuer-declared totals and the extracted statement information.

**Spending anomaly**:
A possible duplicate, unusual price increase, or newly seen merchant identified from spending history. An anomaly is a review prompt, not proof of an incorrect charge.

## Valuation and commitments

**Real pesos**:
ARS amounts restated in the purchasing power of a common month using official IPC.

**MEP reporting value**:
A conversion between ARS and USD using a monthly average MEP sell rate. It is a comparison basis, rather than evidence of the exchange rate actually paid.

**Personal inflation**:
A price index built from comparable recurring merchant charges, compared with official IPC. It is distinct from the supermarket product price index.

**Forecast**:
A range of future billed spending combining known installment schedules, expected recurring charges, and estimated variable spending.

**Payment float**:
The modeled purchasing-power benefit of paying billed ARS purchases at the statement due date instead of the original purchase date.

## Supermarket purchases

**Receipt**:
A supermarket document that identifies a shopping purchase and itemizes its quantities, prices, discounts, and paid total.

**Receipt item**:
A printed product line with quantity, gross amount, and any associated discount lines. Several items can refer to the same canonical product.

**Canonical product**:
A reviewed identity used to compare the same product across receipts despite variations in printed descriptions or article codes.

**Article code**:
A chain-specific identifier printed for a product on a receipt. It is distinct from the product's readable name and from its EAN barcode.

**Receipt discount**:
A signed reduction associated with an item; gross amount plus discounts gives the item's net amount.

**Shopping period**:
One receipt in chronological order. Supermarket analytics use shopping periods, which are not necessarily calendar weeks or months.

**Receipt charge link**:
An association between one receipt and one billed card charge representing its purchase. The association connects evidence without adding spending.

**Supermarket price index**:
A chained comparison of repeated products at their gross and effective unit prices, weighted by the current shopping period's quantities.
