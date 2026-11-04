# Proposed personal chart of accounts and account groups

Status updated 2026-10-25. The user accepts intermediate account detail, seven grocery subaccounts, primary-purpose summaries and overlapping custom groups. Purchases made while abroad use Travel; online subscriptions retain ordinary accounts. Car-payment/car-insurance purposes are confirmed. Linked credits follow the original account; reviewed receipt items allocate the same purchase; unitemized domestic supermarket purchases stay Unallocated. Individual uncertain mappings and detailed posting treatment remain open; no classifications have been applied to application data.

## Recommendation

Keep **accounting type**, **account hierarchy**, and **account group** distinct:

| Concept | Question answered | Example |
| --- | --- | --- |
| Accounting type | What financial role does this account have? | Expense, liability, asset, income, or equity |
| Account hierarchy | Where is this financial effect recorded? | Expenses → Transportation → Fuel |
| Account group | Which accounts belong together for a user's purpose or report? | Transportation can collect fuel/insurance expenses and a vehicle-financing liability |
| Purchase/product context | What specific goods, services, trip, or behavior explains the entry? | Merchant, article code, product kind, trip, recurring status, installment plan |

The formal hierarchy keeps account types intact. An account group sits alongside that hierarchy and may reference several types. It does not turn liabilities into expenses or change an account's financial nature. This distinction follows the balance-versus-flow concepts in [GnuCash's account guide](https://www.gnucash.org/docs/v5/C/gnucash-guide/chapter_accts.html); the cross-type grouping capability is our proposed design for Tarjetas.

## Evidence used

The local SQLite database was queried with read-only access and `query_only` enabled, without opening the application's migration/seeding connection. The snapshot contains 43 statements, 1,632 movements (1,407 purchase-section rows, 100 payment/adjustment rows, and 125 tax/charge rows), 304 purchase merchant descriptors, and 251 item lines from 12 receipts. Statements cover closing dates 2025-01-30 through 2026-10-01; receipts cover 2026-08-07 through 2026-10-23.

All purchase lines were reviewed through their distinct merchant/source-description families; all receipt items were reviewed through 169 printed-description/product families. Current categories were comparison hints, not assumed correct. Imported line counts include repeated installments and reversals and are not counts of distinct economic purchases. This card/receipt sample does not establish all of the person's expenses or financial accounts.

The detailed candidate mapping is stored locally under ignored `qa-output/account-design/expense-review.md` and `proposal-review.json`. It omits financial amounts, account identifiers, dates, and full statements, but contains private merchant/product labels; it is kept out of versioned research. Every one of the 1,407 purchase rows and 251 receipt item rows is represented by a descriptor family in that review.

No private expense lines, amounts, identifiers, or dates were sent to online search or external classification services. No database rules, aliases, product matches, categories, or entries were changed.

## Common personal finance groups

[CFPB's spending worksheet](https://www.consumerfinance.gov/documents/5178/cfpb_ymyg_analyze-your-spending-tracker.pdf) separates food, housing/household costs, transport, health, personal care, entertainment, pets, education, giving, and other allocations. [INDEC's 2018 household-consumption explanation](https://www.indec.gob.ar/ftp/cuadros/economia/ipc_nacional_que_es_06_18.pdf#page=7) provides Argentina-relevant distinctions between food, home equipment/maintenance, communications, health, transport, clothing, and recreation. These are useful vocabularies, not a required personal accounting standard or target budget percentages.

Use the following tailored purpose groups. Financial costs/taxes and unallocated evidence remain explicit rather than hidden inside “other.”

| Proposed purpose group | Why it fits this expense sample | Membership boundary |
| --- | --- | --- |
| Food and dining | Grocery items, restaurants, takeaway, food-delivery membership, identifiable tips | Cleaning, toiletries, and pet items bought at a supermarket belong elsewhere |
| Home and utilities | Gas utility, furniture, bedding, kitchenware, appliances, household cleaning/paper, plants | Include related assets/debt only if actually recorded; no home ownership or mortgage is inferred |
| Transportation | Fuel, tolls, parking, public transport, ride hailing, maintenance, inspection, rental, car payments and car insurance | User confirms the recurring plan line is car payments and Sancor covers the car. Purchases made while abroad use Travel; currency alone does not trigger this rule. |
| Health | Health coverage, medicines, vision care | Pharmacy toiletries remain personal care; tax deductibility is not inferred |
| Clothing and personal care | Clothing/footwear/accessories plus toiletries | Keep clothing and hygiene as distinct accounts within this broad group |
| Entertainment and culture | Shows, cinema, games, video/music services, sports-club membership, hobby instruments | Recurrence is independent; streaming is entertainment rather than a generic subscription purpose |
| Digital services and communications | AI/developer/creative tools, hosting/domains, connectivity, devices | Unknown app/bundle content needs evidence; professional versus personal use is not assumed |
| Education and learning | Candidate books/stationery and future evidenced learning costs | A bookshop-like descriptor is tentative until confirmed; no tuition is inferred |
| Travel | Flights, accommodation, travel insurance, excursions, luggage, and purchases made while abroad | Q17/Q21 assign purchases made while abroad to Travel even when the goods would ordinarily be food, transport, or shopping. Online subscriptions keep ordinary accounts, regardless of billing currency or renewal during a trip. Core travel services remain Travel even when booked before departure. |
| Pets | Veterinary care, training, food and supplies where identifiable | A pet shop does not prove that its whole basket is pet food |
| Financial costs and taxes | Actual interest, issuer fees, stamp duties, nonrecoverable taxes, confirmed fines | Card principal payments and proven transfers are not spending in this group; tax recoverability requires evidence/policy |
| Gifts and giving | Common personal-finance purpose for future evidenced gifts/donations | Optional/inactive initially: no unambiguous evidence in the reviewed descriptors establishes a need for these accounts |

“Review needed” is a work queue and report bucket, not an intended permanent purpose group. An unclassified purchase retains its amount and evidence while its purpose is unresolved.

## Proposed expense accounts

These are account leaves below the Expenses root. The groups are the default presentation, not a second ledger hierarchy with mixed accounting types. The local mapping uses stable readable candidate keys; the final chart need not use those keys or numeric codes.

| Parent | Suggested posting accounts | Evidence and qualifications |
| --- | --- | --- |
| Food → Groceries | Fresh produce; Meat/poultry/fish/deli; Dairy/eggs; Bread/bakery; Pantry/snacks/baking; Nonalcoholic drinks; Prepared grocery foods | Based on printed item contents, not the supermarket name or current product department. Product-level price history remains separate. |
| Food → Meals and services | Restaurants/cafes/takeaway; Identified delivery fees/tips; Food-planning/delivery memberships | Recipe access and delivery membership serve a food purpose. Do not estimate an undisclosed fee/tip out of a combined order. A delivery order can contain groceries or nonfood goods and may need a different account. |
| Home | Gas utility; Cleaning/laundry; Household paper/disposables; Kitchenware/food storage; Bedding/household textiles; Furniture; Household appliances; Repairs/hardware; Plants/decor | Q28 expenses ordinary personal household equipment by default; explicitly identified supported assets/prepayments retain their appropriate treatment. No general depreciation feature is required initially. Rent, water, electricity, and mortgage accounts can be added when evidenced; their absence here is a sample limitation. |
| Transportation | Fuel; Tolls; Parking; Public transport; Taxis/ride hailing; Vehicle maintenance; Vehicle inspection; Vehicle rental; Vehicle insurance | Car insurance is user-confirmed. Car payments also belong in the Transportation group, but their principal/fee allocation belongs to the relevant financial accounts rather than automatically becoming another operating expense. |
| Health | Health coverage; Medicines/pharmacy goods; Vision care | Pharmacy merchandise needs item detail when it spans healthcare and toiletries. |
| Clothing and personal care | Clothing/footwear/accessories; Toiletries/personal hygiene | Separate durable clothing purchases from recurrent hygiene supplies. |
| Entertainment and culture | Live events/tickets; Cinema; Games/gaming services; Video/music services; Sports-club membership; Hobbies/musical instruments | Games versus gaming subscriptions can remain product/recurrence detail unless separate accounts are useful. |
| Digital services and communications | AI tools; Developer tools; Creative software; Hosting/web services; Domains; Internet/mobile/connectivity; Devices/accessories | Bundled mobile/broadband/TV or app charges are not silently split from merchant names. Q28 expenses ordinary personal devices by default, with explicitly identified supported asset/prepayment exceptions. |
| Education and learning | Books/stationery/learning materials | Provisional from a bookshop-like source descriptor; add courses/tuition only when supported or explicitly required. |
| Travel | Flights; Accommodation; Travel insurance; Excursions/attractions; Luggage; Purchases made abroad | Preserve item/merchant detail while using Travel for purchases made abroad. Online subscriptions keep their ordinary accounts. Do not infer physical purchase abroad solely from foreign currency or processor location. |
| Pets | Pet food; Pet supplies/hygiene; Veterinary care; Pet training; Pet purchases awaiting item detail | Pet-food account is sensible but the reviewed pet retailer descriptions do not prove which baskets contain food. The last account is a provisional known-purpose holding account. |
| Financial costs and taxes | Financing interest; Issuer/transaction fees; Nonrecoverable indirect taxes; Stamp duties; Confirmed fines/penalties | Recoverable advances/credits belong in an appropriate asset account only if that status is established. Do not make a legal/tax eligibility assumption. |
| Review | Unallocated verified purchases; Mixed retail baskets awaiting detail | Q24 accepts Unallocated for domestic supermarket purchases without enough item detail; their amounts remain visible. Financial-nature uncertainty, such as a possible transfer, asset acquisition, hold or advance, still requires separate review before expense assignment. |

Q16 accepts this intermediate detail, including seven grocery subaccounts, with parent/group summaries and no account per SKU. The original merchant/item review used 57 expense-account candidates; four further finance leaves are evidenced by non-purchase statement families. Q17/Q21 add the purchases-made-abroad route under Travel; individual assignments still require evidence. These counts describe the proposal, not active accounts or postings in the application.

## Other account types and reconciliation roles

A chart that only lists expense purposes cannot connect the information. The following are required or conditional roles, not an assertion that every corresponding balance currently exists:

| Type or role | Proposed accounts or distinctions | Scope/status |
| --- | --- | --- |
| Liabilities | Each actual card account, with native-currency balances | Initial migration. Use explicit issuer/account identity; a brand is insufficient as a unique key. No account numbers are needed in these documents. |
| Liability subaccounts | Billed balance and Unbilled principal under each distinct card and native currency | Accepted Q8 structure. Record supported principal once, move it between subaccounts as billed, and reduce debt on actual repayment. Do not invent a financed balance simply by multiplying a statement installment. |
| Settlement clearing | Unresolved payment source | Accepted Q9 role. Exact formal account type and reconciliation mechanics remain to be finalized; “clearing” is not a sixth accounting type. |
| Vehicle-payment allocation | Car payments, shown under Transportation, with principal/contributions and charges distinguished when evidenced | Q19 confirms the purpose. It does not establish a loan balance, vehicle ownership, contract mechanism, or a principal/fee split. |
| Assets, conditional | Vehicle-plan contribution rights or other advances; tax advances/credits; tracked durable goods | Require source/contract evidence and recognition policy. A car-plan charge is not proof of an existing car loan or owned vehicle. |
| Equity | Explicit opening balances and later explained migration adjustments | Accepted incomplete-history requirement. Do not use an unexplained balancing amount to hide a reconciliation error. |
| Income, conditional | Separately identified genuine rewards/income where their substance warrants it | Q22 assigns directly linked refunds/promotions to the original purchase account as separate credits. Unrelated rewards and uncertain tax credits remain for review rather than automatically becoming income. |
| Assets and transfers, later stage | Bank/wallet/cash accounts, transfers between them, settlement against actual funding accounts | Preserve extension points while keeping bank/transfer features after current card-feature migration. |

## How cross-type account groups should work

Recommend editable groups with many account memberships, including accounts from different financial types. A group can include an account subtree or a selected set of accounts. Membership changes presentation and filtering, not posting semantics.

Q18 accepts one primary purpose per classified account/allocation so ordinary summary totals partition the amount once, plus additional overlapping custom groups for inspection or comparison. Q32 accepts bilingual built-in account/group names and one shared verbatim name for custom groups or user renames. Financial identities and memberships are independent of display labels; renaming or switching language changes neither. Label overlapping views non-additive. Nested subgroups remain possible without forcing the chart of accounts to match that shape; their exact hierarchy is not yet selected.

### Example Transportation group

| Account or allocated position | Accounting type | Measure shown |
| --- | --- | --- |
| Fuel, tolls, parking, insurance | Expense | Signed spending over the selected period |
| Recorded vehicle or vehicle-plan rights, if evidenced | Asset | Balance at a selected date |
| Recorded vehicle financing, if evidenced | Liability | Outstanding principal at that date |
| Repayments linked to that financing | Movement/allocation, not another expense account | Principal repaid during the period |

These are separate measures. Do not add ARS 100 of expense to ARS 100 still owed and call it ARS 200 spent; netting them would also erase useful information. Native ARS/USD balances remain separate unless a report explicitly applies its selected conversion basis.

A mixed-purpose credit card needs special treatment. Its entire balance cannot join Food, Home, and Transportation as if each owns all of it. Whole-account membership is valid for navigation, but purpose-specific debt needs allocation through the underlying purchase/posting relationships. Unknown allocation must stay visible and must reconcile to the total card balance, including unattributed interest, opening balances, and settlement differences. Q31 follows explicit issuer repayment allocations where available; otherwise it uses a disclosed oldest-billed-first convention on billed debt. Unsupported opening debt stays unattributed; excess payments stay unapplied card credits. This convention is analytical attribution, not proof of issuer settlement of particular purchases.

[Actual Budget's report documentation](https://actualbudget.org/docs/reports/custom-reports/) is a useful precedent for separating category/group/account dimensions and for identifying whether a number is transaction flow or balance. It does not by itself specify our cross-type group design.

### Context that should remain independent

- Recurring/subscription status: streaming, health coverage, software, gas, and club membership have different purposes even when all recur.
- Trip/project: a trip view can associate related records; purchases made while abroad use Travel under Q17/Q21, while online subscriptions keep their normal accounts.
- Merchant/payment processor and original item kind: retain these details even when Travel takes precedence over ordinary purpose. Neither foreign currency nor overseas processor location alone proves a purchase made abroad.
- Product identity/kind: retain article codes, units, quantities, gross/net prices and product comparisons without an account for each SKU.
- Financing/billing status: an installment plan or payment date is not itself a consumption purpose.

## Specific findings from the current expense lines

| Observed evidence | Better classification or action | Why |
| --- | --- | --- |
| Rice, ketchup, canned corn, Nutella, and a packaged snack currently under produce | Pantry/snacks/baking | Packaged pantry food differs from fresh produce; old labels should not seed the new chart blindly |
| Powdered gelatin/dessert mix currently sometimes under dairy | Pantry/baking | Printed product form should prevail over an inconsistent department |
| Kitchen knife, acrylic jar and food-storage containers currently under cleaning | Kitchenware/food storage | Durable household goods differ from cleaning consumables |
| Blanket under other | Household textiles | A useful home purpose is available from the item wording |
| K9DOGTRAINERS | Pet food — user confirmed October 25, 2026 | The merchant name is the dog-food seller’s name, not evidence of a training service. The user also confirms the September 8 purchase was ARS 78,605.00 in two interest-free installments. Its final installment is reconciled as a selected opening-obligation correction; no new expense or blanket history/future rule was added. |
| A source family containing a bookshop-like “LIBR” descriptor currently under pharmacy | Candidate books/stationery; confirmation required | Existing classification is not independent evidence of a medicine purchase |
| An egg-labelled row currently matched to a Cyclamen plant product | Investigate source/transcript/product identity before using the match | An account rename alone cannot repair incorrect product identity or a contaminated OCR line |
| Cream descriptions currently sharing a protein-milk canonical identity | Revisit product matching even though both may use Dairy/eggs | Same account does not justify comparing different products as the same price series |
| Fuel, restaurants, ride hailing and retail purchases made while abroad | Travel under Q17/Q21, with underlying goods/service detail retained | The criterion is purchase while abroad; online subscriptions do not become Travel merely because billed in USD |
| Bedding descriptor contains “HOTEL” | Household textiles candidate | A substring is not proof of an accommodation bill |
| Card repayments and balance adjustments | Liability/clearing reconciliation | Not new consumption; preserve distinction from issuer promotions and tax-related credits |

## Evidence gaps that should remain explicit

The original review had 61 merchant descriptors requiring review, 29 low-confidence suggestions, and five receipt description families requiring review. User confirmation settles car-payment purpose and car-only insurance, while Q21 fixes the Travel criterion. Individual purchase evidence and other ambiguous descriptions can still require review. The local review records the accepted policy updates without pretending to infer every purchase's physical context. Ambiguous merchants and marketplaces must not receive confident new accounts merely to achieve 100% classification.

- Q23 accepts allocation from reviewed items of a verified, linked domestic receipt. Item allocations refine the same purchase and reconcile to its total; no second expense or repeated full allocation against each installment is created. Verification of arithmetic does not approve an incorrect product identity or account assignment.
- Q24 keeps a domestic supermarket purchase without sufficient detail in Unallocated, retaining its amount and evidence in reports. Do not copy a later basket's proportions, divide equally, or assume the whole basket is Groceries. Q25 accepts automatic posting for validated known-nature records once applicable accounting rules are settled; ambiguous nature or conflicting evidence remains in review.
- Marketplace/product-count descriptors, general retailers, app bills, and membership bundles need order/service detail. Q22 keeps directly linked refunds/promotions in the original account as distinct credits; unrelated rewards and uncertain tax credits remain for review.
- The vehicle-plan line is confirmed as car payments under Transportation. Its contribution/principal, administration, insurance, and interest components remain to be evidenced; no loan or owned asset is inferred from the purpose label alone.
- Sancor is confirmed as car insurance under Transportation. Other unknown policies would still need the insured risk identified.

## Decisions requested

The old “reuse current categories as the seed” suggestion is superseded. Q16 accepts the proposed detail; Q18 accepts primary-purpose summaries and overlapping custom groups; Q19/Q20 confirm car payments and car insurance. Q21 places purchases made abroad in Travel, excluding online subscriptions; Q22–Q24 accept original-account credits, same-purchase receipt allocations, and Unallocated purchases without receipt detail. No ledger or data migration has been performed.

Q25 accepts validated automatic posting with review for ambiguous/conflicting evidence; Q26 accepts selected-purchase corrections by default and explicit future-rule/history options. Q27 accepts historical analytics using the latest corrected classification with inspectable original evidence and revision history. Q8 accepts the [installment accounting policy](../accounting/installments.md). Detailed car-payment components remain an evidence/policy issue rather than an unanswered question about purpose. The [migration requirements](../accounting/requirements.md) consolidate the agreed scope. Corrections to current application data remain separate implementation actions; see [preservation scenarios](../current-state/preservation.md) for target examples.
