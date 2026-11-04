# Installment accounting research

Research date: 2026-10-25. Scope: purchaser-side installment purchases, partial settlements, and credit-card repayments in official QuickBooks material, with a Xero financing example for comparison. This research answered the user's initial research-only request for Q8; the later accepted Tarjetas policy is recorded separately below. The source findings themselves select no policy and change no accounting implementation.

## Findings

The inspected material separates the original purchase or financed amount from later repayments. It does not support the general rule that an installment payment is another purchase. It also does not establish that every financed purchase must immediately become an expense: inventory, fixed assets, prepayments, and consumed goods/services can have different classifications and recognition timing.

The earlier Q8 choice between “full expense now” and “expense each billed installment” combined two decisions. The better distinction is between **what was acquired and when it is recognized**, **the financing liability**, **which portion is currently billed/due**, and **how the liability is actually repaid**.

## What the official sources show

| Situation | Documented treatment | Source and scope |
| --- | --- | --- |
| Vendor-financed installment purchase | Intuit's training example records inventory plus an “Installment Purchases” current-liability account. The unpaid portion offsets the purchase transaction; the example permits zero initial cash paid. Later vendor payments reduce the liability until it is cleared. | [QuickBooks Online Level 2 training manual, pp. 161–163](https://quickbooks.intuit.com/oidam/intuit/sbseg/en_us/quickbooks-online/QuickBooks-Online-Level-2-Manual-%20%282%29.pdf#page=161). Historical training material with 2021 PDF metadata, visually checked; not evidence of the current UI or Argentine card support. |
| Loan-financed fixed asset | Create a loan liability and debit the relevant asset against that liability. Financing the acquisition does not itself turn the whole asset cost into an immediate expense. | [Record a loan for an asset in QuickBooks Online](https://quickbooks.intuit.com/learn-support/en-us/help-article/business-assets/record-loan-asset/L499QJijT_US_en_US). Current help article inspected. |
| Loan repayments | Track the amount owed in a liability account. Repayments are recorded against that account; interest goes to an expense account. | [Set up a loan in QuickBooks Online](https://quickbooks.intuit.com/learn-support/en-us/help-article/loans/set-loan-quickbooks-online/L7pMR6rUN_US_en_US). Principal and interest are separate classifications. |
| Supplier bill paid in parts | A bill tracks an amount owed to a vendor; bill payment closes that obligation. Online Bill Pay allows a payment amount smaller than the bill amount. | [Bills versus checks and expenses](https://quickbooks.intuit.com/learn-support/en-us/help-article/accounts-payable/learn-difference-bills-checks-expenses-quickbooks/L0ZtL2TYI_US_en_US) and [QuickBooks Online Bill Pay](https://quickbooks.intuit.com/learn-support/en-us/help-article/pay-bills/pay-bills-quickbooks-bill-pay/L4XfPGnJl_US_en_US). An Online payment-service capability, not a claim that every QuickBooks edition has identical automation. |
| Card purchase and later repayment | Desktop help puts purchases into a credit-card liability account and later payments reduce what is owed. Online's Pay down credit card workflow separately identifies the card, payment amount/date, and funding bank account; connected-feed payment records can be paired. | [Desktop credit-card accounting](https://quickbooks.intuit.com/learn-support/en-us/help-article/chart-accounts/set-use-pay-credit-card-accounts/L6cksFiDF_US_en_US) and [Online card repayments](https://quickbooks.intuit.com/learn-support/en-us/help-article/pay-bills/record-payments-credit-cards/L7IjpiWLZ_US_en_US). Product editions are deliberately identified. |
| Comparable financed purchase | Xero's guide illustrates a vehicle asset paired with the full notes-payable liability. Later payments reduce principal and separately account for interest; the original vehicle is not repeatedly acquired each payment period. | [Xero notes-payable guide](https://www.xero.com/us/guides/notes-payable/). This is an accounting example in Xero's guide, not verification of an automatic cuotas-import feature. |

Recurring **new bills** and partial **payments of an existing obligation** are different concepts. A repeated invoice for a newly delivered monthly service need not represent the same economic event as the next payment toward goods already acquired. The Online Bill Pay article documents recurring-bill payment automation separately from the amount paid toward a selected bill.

## Applying the distinction to Argentine card cuotas

The inspected US QuickBooks purchase/loan/card articles, Spanish global card-payment article, and Intuit training section do not establish a native workflow that imports an Argentine statement's `n/N` installment lines and reconstructs the full purchase automatically. Neither the documented partial-bill payment service nor the Xero financing example proves that capability. Search results about seller installment invoices are not purchaser-side evidence and were not used for that conclusion.

Tarjetas currently sees each billed installment, frequently printed with its original purchase date, plus an aggregate forward schedule where available. Its [current behavior](../current-state/behavior.md) can infer remaining principal from the earliest observed installment, but this is not equivalent to knowing the complete original transaction or actual repayment history.

The research distinguishes these quantities; the subsequent accepted policy selects the account structure separately:

| Quantity | Illustrative meaning for a known, interest-free ARS 600 purchase in six equal installments |
| --- | --- |
| Original purchase principal | ARS 600 acquired once; the classification as expense/asset/prepaid remains a separate policy choice |
| Total unpaid principal before any actual payment | ARS 600 under the subsequently accepted full-known-principal model |
| Portion currently billed | ARS 100 after the first installment appears; billing is not proof that it was paid |
| Future unbilled installments | ARS 500 following that first billing, assuming no other changes |
| Principal after an actual ARS 100 repayment | ARS 500; the current billed portion has been settled if that payment is applied to it |

This table is a synthetic illustration and inference for Tarjetas, not an Intuit product example. It was initially research context; the later accepted Q8 policy uses billed/unbilled liability subaccounts. Total future commitment must not be compared directly with an issuer's currently billed statement balance without explaining their different coverage.

Under the subsequently accepted model, repeated imported installment lines attach to the existing purchase/schedule rather than add the original expense again. Interest and fees retain their own supported treatment. For incomplete history, the accepted requirement is to preserve evidence, test reconstruction, and use explicit opening balances instead of fabricated past purchases. The later accepted Q8 policy selects this model subject to its evidence limits; the competitor research alone did not settle it.

## Chart of accounts and current categories

Q10 requires a chart of accounts. In the next exchange, the user rejected reusing the current category systems as the desired structure and requested a new proposal based on actual expenses, together with cross-type account groups. Use the [new account proposal](../proposals/personal-chart-of-accounts.md) for that work; the examples below are earlier research context, not the current recommended taxonomy. QuickBooks describes transaction categories as accounts in its chart and supports parent/subaccounts. Sources: [QuickBooks chart of accounts](https://quickbooks.intuit.com/learn-support/en-us/help-article/chart-accounts/learn-chart-accounts-quickbooks-online/L2yc6KBob_US_en_US) and [subaccounts](https://quickbooks.intuit.com/learn-support/en-us/help-article/chart-accounts/create-subaccounts-chart-accounts-quickbooks/L7NLrY7cd_US_en_US).

The following are mapping candidates, not selected account names or an approved chart:

| Existing information | Candidate representation | Why one-to-one mapping is not automatic |
| --- | --- | --- |
| `food / supermarket` | Expense parent/subaccount such as Food → Groceries | A useful spending breakdown can become an expense-account hierarchy |
| `transport / fuel` | Expense parent/subaccount such as Transport → Fuel | Similar hierarchy, if those reports are wanted |
| `taxes_fees` | Several tax, fee, and interest accounts as appropriate | The current category mixes financially different concepts |
| `transfers` | Balance/clearing accounts where the event moves money | A report label does not make a transfer an expense |
| Product departments such as dairy or cleaning | Product detail, accounting subaccounts, or an explicit mapping | A single supermarket receipt may span several departments; preserve the detail without choosing the posting depth yet |
| Card balances, unresolved payment sources, opening balances | Liability, clearing, and equity accounts | These necessary financial roles are absent from the current spending taxonomy |

The open choice is how much analytical detail should become a posting account, not whether the new system should have a chart of accounts. More detailed accounts improve account-level reporting but require more granular allocations when supporting evidence is incomplete.

## Remaining decisions and subsequent discussion

- The original request was research-only. The user subsequently requested a recommendation and accepted it with “Q8 OK” on 2026-10-25. The [accepted policy](../accounting/installments.md) records one purchase/full known principal, billed/unbilled liability and separate repayments. Acceptance comes from that explicit answer, not from the competitor research alone.
- Q10's account detail, grouping strategy, reviewed item allocations and Unallocated purchases were subsequently accepted through Q16–Q24. Individual uncertain mappings and financial components still require evidence; see [the account proposal](../proposals/personal-chart-of-accounts.md).
- Cross-currency settlement and exchange differences remain deferred to the stage before bank conversions.
- Hosted OCR, native-currency balancing, payment-source clearing, evidence reconciliation, and posted-entry correction requirements are accepted in [the decision record](../current-state/accounting-questions.md). No login is required for now; this does not settle network exposure.

Research is based on official sources and the inspected Intuit manual, without logging into QuickBooks/Xero, running financial transactions, or validating an Argentine cuotas import in either product. No application code, database, or deployment was changed.
