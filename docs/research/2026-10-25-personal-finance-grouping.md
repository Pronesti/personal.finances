# Personal finance grouping research

Research date: 2026-10-25. Question: what common household-purpose groupings can inform Tarjetas, and how should those groups relate to a chart of accounts that includes both expenses and liabilities?

## Public sources

| Primary source | Relevant finding | Limit |
| --- | --- | --- |
| [CFPB spending tracker](https://www.consumerfinance.gov/documents/5178/cfpb_ymyg_analyze-your-spending-tracker.pdf) | Distinguishes groceries/eating out, housing/utilities, household supplies, transport, healthcare, personal care, entertainment, pets, education, giving, and other allocations | A spending worksheet, not a chart of accounts. Its debt-payment and savings columns do not make principal repayment or savings transfers accounting expenses. |
| [INDEC household-consumption explanation, June 2018, p. 7](https://www.indec.gob.ar/ftp/cuadros/economia/ipc_nacional_que_es_06_18.pdf#page=7) | COICOP-based household divisions distinguish food, household equipment/maintenance, housing/utilities, transport, communication, health, clothing, and recreation among other purposes. Cleaning supplies belong with household maintenance rather than food | Historical classification reference, not a claim about current IPC weights, a recommended budget, or mandatory ledger structure. |
| [BLS Consumer Expenditures 2024 report](https://www.bls.gov/opub/reports/consumer-expenditures/2024/home.htm) | Independently supports purpose-based household categories such as housing, food, transportation, healthcare, entertainment, apparel, personal care, education, and contributions | US statistical expenditure classification, not a personal bookkeeping rule or target spending ratio. |
| [YNAB getting-started guide](https://www.ynab.com/guide/the-ultimate-get-started-guide) | Encourages customizable categories and groups that evolve with the user's priorities | Budget envelopes are not automatically accounting accounts, and this does not establish cross-type ledger grouping. |
| [GnuCash account concepts](https://www.gnucash.org/docs/v5/C/gnucash-guide/chapter_accts.html) | Distinguishes the five accounting types and the difference between balances at a point in time and income/expense changes over a period | Does not mean a mixed expense/liability parent should replace accounting-type hierarchy. |
| [Actual Budget custom reports](https://actualbudget.org/docs/reports/custom-reports/) | Supports separate category, group, payee, account, and time dimensions. Explicitly distinguishes an account's transaction sum from its periodic balance | Reporting precedent rather than a specification for Tarjetas account-group membership or double-entry postings. |

## Conclusion for Tarjetas

Common personal-finance language describes **what money is for**. The chart of accounts also needs to describe **what financial role a record has**. They are compatible but separate questions. No single universal personal chart or group list was established by these sources.

The proposed cross-type account group is a Tarjetas design inference: editable sets of account references that preserve accounting types and expose named, separate measures. Transportation could show expense activity and vehicle debt; Home could show utilities, equipment, and related financing. They should not produce a single sum that mixes spending with outstanding principal.

For mixed-purpose card liabilities, account membership alone is not enough to measure purpose-specific debt. Purchase/posting allocations must explain the relevant portion, and unallocated balances must remain visible. Custom overlapping groups are useful for exploration; totals are not additive without a partition/allocation rule.

The research originally recommended classification by goods/service purpose, retaining merchant, currency, recurrence, financing status, and trip context separately. The user chose a different Travel convention in Q17, clarified in Q21: purchases made while abroad use Travel; online subscriptions keep their ordinary accounts. Currency or merchant nationality alone does not establish a purchase abroad. The original goods/service detail can remain available without overriding this chosen account convention.

## Applied proposal and private evidence

The [proposed chart and groups](../proposals/personal-chart-of-accounts.md) adapt these concepts to the actual local expense descriptions. The user explicitly authorized expense-line review on 2026-10-25; this is additional evidence beyond the original source-code-only baseline.

The read-only review covers all 1,632 statement movements and all 251 receipt item rows at the family level, including 304 purchase merchant descriptors and 169 printed-item/product families. Existing classifications and canonical product matches were checked against source wording and treated as fallible. Full mapping artifacts remain in ignored local `qa-output/account-design/`, without amounts or financial account identifiers.

No private financial details were used in public web queries. No classification API was called. The result is a proposal; no application data or accounting behavior changed.
