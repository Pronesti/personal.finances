# Q8 installment accounting policy

Status: accepted by the user with “Q8 OK” on 2026-10-25. This records the agreed policy; no accounting implementation has been performed. Scope: purchaser-side card installments in the existing-feature migration, without adding bank integration or general asset-management features.

## Accepted model

Recognize one evidenced purchase and its full known financed principal once. Track the installment billing schedule separately from purchase recognition and actual repayment. Financing terms do not determine whether the acquisition is an expense, asset, or prepayment.

For ordinary personal consumption, record the purchase expense when the goods or services are acquired. Use the evidenced original purchase date when it represents that event; material delivery/prepayment differences need appropriate classification rather than automatic expense treatment. An explicitly tracked asset or prepaid service uses its appropriate account and recognition policy. Installments alone neither require asset capitalization nor justify monthly purchase expenses. Q28 subsequently accepts expensing ordinary personal durable goods by default, with explicitly identified supported asset/prepayment exceptions and no general depreciation feature in the first release. This policy does not settle the unknown financial components or ownership of the car-payment plan.

The research basis is the separation of card charges from repayments in [Intuit's credit-card guidance](https://quickbooks.intuit.com/learn-support/en-us/help-article/chart-accounts/set-use-pay-credit-card-accounts/L6cksFiDF_US_en_US), principal from interest in [its loan guidance](https://quickbooks.intuit.com/learn-support/en-us/help-article/loans/set-loan-quickbooks-online/L7pMR6rUN_US_en_US), and asset acquisition from financing in [its asset-loan example](https://quickbooks.intuit.com/learn-support/en-us/help-article/business-assets/record-loan-asset/L499QJijT_US_en_US). These pages were rechecked on 2026-10-25. The billed/unbilled structure below is a Tarjetas design recommendation, not a claim about QuickBooks automatically importing Argentine cuotas. See [the source research](../research/2026-10-25-installment-accounting.md) for its limits.

## Liability and billing

Use two liability subaccounts per distinct card and native currency: **Unbilled principal** and **Billed balance**. Keep purchase-level plans and installment identities in the supporting detail; do not create a chart account for each purchase. A billing event moves principal between these subaccounts without changing total debt or purchase expense. At the same reconciliation date, the billed balance is compared with the issuer's corresponding balance, including supported payments, credits, fees and other adjustments. The total of both subaccounts answers a different question: all recorded card debt, including future installments.

For a fully evidenced, interest-free ARS 600 consumption purchase in six ARS 100 installments:

| Event | Debit | Credit | Result |
| --- | --- | --- | --- |
| Acquire the purchase | Appropriate expense 600 | Card / Unbilled principal 600 | Expense 600; total debt 600 |
| Issuer bills installment one | Card / Unbilled principal 100 | Card / Billed balance 100 | Unbilled 500; billed 100; total debt still 600 |
| Issuer reports an actual payment of 100 | Card / Billed balance 100 | Unresolved payment-source clearing 100 | Unbilled 500; billed 0; total debt 500 |
| Issuer bills installment two | Card / Unbilled principal 100 | Card / Billed balance 100 | Unbilled 400; billed 100; total debt still 500 |

The payment assumes the only billed amount is the 100 in this example; the example alone does not infer per-purchase payment allocations for mixed card balances. Q31 subsequently accepts issuer allocation evidence where available and otherwise a disclosed oldest-billed-first analytical convention on billed debt, retaining unattributed opening debt and unapplied credits and reconciling to the card balance. The clearing role follows accepted Q9. Actual bank funding is connected in the later bank release. Each native-currency journal balances independently under Q13.

An imported statement may establish both the original purchase and its first billed installment; the two effects can be recorded together while remaining explainable. Subsequent installment lines attach to that existing purchase/plan. Reimport, receipt linkage and item allocation must not create it again. Equal amounts or merchant names alone are insufficient proof that two lines belong to one purchase.

## Reports and financing costs

- Purchase spending: full ordinary consumption cost once, attributed to the evidenced purchase period and latest corrected account classification. Explicit assets/prepayments retain their own accounting treatment; acquisition analysis must label them appropriately.
- Billed spending: installments charged in each cycle, preserving the current monthly-burden capability. This is a billing view, not proof of cash paid and not a second expense ledger.
- Payments: actual issuer-reported repayments, distinguished from purchases and billing. Bank-source reconciliation follows in the bank release.
- Commitments and forecasts: remaining supported principal schedules plus separately identified expected/variable projections. Already recorded unbilled principal is not added to debt a second time; projected recurring purchases are not posted obligations merely because they appear in a forecast.

Record separately supported interest and financing fees as their costs arise, distinct from purchase principal. Future estimated interest remains forecast information until the applicable obligation/recognition is established. Do not book all scheduled future interest as a purchase expense. Do not derive hidden interest from an assumed cash price or force an unknown installment split; retain evidence and review. Explicit prepaid fees or financed charges require their own supported treatment.

Linked refunds remain distinct credits to the original purchase classification under Q22. Their effect on billed/unbilled debt and the remaining schedule follows issuer evidence; do not assume a refund automatically cancels all installments.

## Incomplete history and acceptance examples

Preserve Q4's isolated reconstruction trial and deferred cutover choice. If history starts at installment three, do not invent installments one and two, their repayments, or an original-period expense from installment arithmetic alone. With sufficient evidence, an opening liability can include the current billed balance and supported future unbilled principal, offset by opening equity. Without that evidence, retain the uncertainty for review. A later discovery of original evidence follows the agreed correction policy and must not duplicate opening debt or purchase expense.

Accepted examples to validate in the replacement implementation:

1. A complete six-by-100 interest-free purchase produces one 600 consumption expense; billing all six installments never increases that expense again.
2. Billing alone leaves total principal unchanged; a supported repayment reduces it. Billed and unbilled subaccounts reconcile separately to their source coverage.
3. Importing the same statement again, linking a receipt, or reviewing receipt items creates no duplicate purchase, debt or allocation.
4. An explicit interest charge of 10 is a financing cost separate from the original 600 principal; a forecast of future interest creates no automatic posting.
5. An incomplete series preserves known opening obligations and missing-history labels without fabricating purchase dates, prior payments or historical expenses.
6. Purchase-period, billed-cycle, payment and future-commitment views remain available with distinct meanings. Their amounts are not added together as total spending.

Q8 is resolved. Q29 subsequently accepts original-effective-period corrections with actual correction time retained, no initial period locks, and distinct dates for later refunds/charges. Q30 accepts evidence-supported receipt-first purchase recognition without duplicate statement posting or guessed financing schedules. Supported nonstandard financing terms and final historical cutover remain separate evidence/decision requirements.
