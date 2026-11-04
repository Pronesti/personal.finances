# Accounting acceptance matrix

Recorded 2026-10-25. All 46 scenarios have been assessed against combined actual evidence. **Passed** means the scenario contract is supported by exact controlled tests/service assertions plus its necessary browser observations; it does not mean every backend invariant was repeated through the browser. **Pending** identifies one concrete missing proof below. All 46 scenarios now pass within their stated evidence scope. Current R2 source verification, exact numerical-decision signoff and complete recovery are recorded. This established release readiness before the user separately approved and completed the live transition; see [the cutover record](cutover-decision.md).

The private machine-readable matrix is `qa-output/accounting-acceptance/acceptance-matrix.json`, with report/writer hashes and individual evidence paths. The raw report has 1,016 checks: 668 unchanged passes and 348 intentional differences. `accepted-report-differences-verification.json` independently pins 11,542 numerical leaves with zero unexplained differences. Root has verified and signed off the precise policy decisions and exact-pin verifier in `root-numerical-signoff.json`; the matrix does not relabel raw comparisons as identical or waive changed coverage.

Evidence: **W** `writer-integrated.json` and its actual Vitest receipt; **UI** `browser-root-writers.json`, `browser-report-controls.json`, `browser-receipt-writers.json`, `product-editor-save.json`; **R** raw report plus exact accepted-difference proof; **G** recorded tests/build/type/backup receipts; **O** `qa-output/accounting-operations/` real runtime/parser/reference evidence; **B** `qa-output/accounting-recovery/release-candidate-20261025-r2/` final complete restore. Files above are under ignored `qa-output/accounting-acceptance/` unless qualified. No pass is based merely on a file existing.

| ID | Status | Proven assertions | Specific remaining proof |
| --- | --- | --- | --- |
| P01 | Passed | Parser43 + W issuer scenarios; root browser uploaded real copied Visa and followed existing source revision. All 43 copied issuer PDFs passed the actual parser with identical financial JSON fields; writer admissions and browser upload/history complement guarded rejection tests. | None. |
| P02 | Passed | W proves renamed duplicate, changed extraction/stale replay; root browser exact copied Visa reupload retained existing revision. Writer tests cover renamed duplicates, changed extractions, stale replay and canonical revision history. Upload tests prevent superseded JSON resurrection; browser reupload retained the identical revision. | None. |
| P03 | Passed | Report comparisons exercise spending/forecast. | None. |
| P04 | Passed | Report comparison covers modes/granularity; spending tests cover boundaries. | None. |
| P05 | Passed | Read-only category/detail/evidence routes and historical receipt anchors. | None. |
| P06 | Passed | W + root browser prove selected/future/history preview-confirmation, exact native values and EN/ES context. | None. |
| P07 | Passed | A100/B100 render separately before merge; merged200 retains two purchases; future original A renders combined300/three purchases in EN/ES; Merge preserves every prior journal and printed source line | None. |
| P08 | Passed | Full report has merchant and novelty comparisons. | None. |
| P09 | Passed | Actual frozen-source36scope contribution proof: category deltas sum to latest-two-valuedperiod difference; percentages/zero-base invariants pass. Pure boundary regression plus actual annual browsercontrol completes contract. | None. |
| P10 | Passed | Full report includes flow comparisons. | None. |
| P11 | Passed | Full report includes timing comparisons; timing tests assert acquisition behavior. | None. |
| P12 | Passed | Full report includes pace comparisons. | None. |
| P13 | Passed | Full report compares recurring. | None. |
| P14 | Passed | Native six card/currency balances + mode report comparisons. | None. |
| P15 | Passed | Full report compares personal IPC; public IPC command successfully isolated. | None. |
| P16 | Passed | Native payment/charge checks; T11 test explicitly separates interest. | None. |
| P17 | Passed | The real-data float comparison and six bank valuation/tax comparisons match. Tests cover the day-28 missing-date fallback and unknown partial limits; rendered terms/float/bank views retain units and coverage. | None. |
| P18 | Passed | Full report compares installments/forecast; supported opening anchors separate principal. | None. |
| P19 | Passed | Root browser28→27→28open of31total; overview tile27 after review; Spanish stable review codes/counts retained. | None. |
| P20 | Passed | Real32180 browser raw copied792469 rejected, original reviewed correction admitted22items/71081.92; both transcripts visible. Existing real OCR corpus9raw/3corrected and acceptance7tests. | None. |
| P21 | Passed | Receipt native totals pass; full comparison includes basket/category products. | None. |
| P22 | Passed | Full comparison includes frequency/product/index checks and reviewed-item coverage. | None. |
| P23 | Passed | Writer product-code-merge-rematch proves approval/code move/redirect/rematch and immutable printed money. Producteditor-save.json fixed browser savepersistedcurrentselects; browsercodeownershipmove, canonicalproductmergeandrematch; Wprintedsourceimmutable andper-itemreviewinvalidation. | None. |
| P24 | Passed | W receipt-first/statement-first/occupied matching plus actual receipt1 browser unlink→link; same charge/by-hand and total115370.80. | None. |
| P25 | Passed | Root browser missingANTHROPICkey failure translates EN→ES after current fix; rejected proposal persists reload and rules unchanged. Existing controlled service tests prove sanitized-only proposal/accept/reject boundary; no externalAI called. | None. |
| P26 | Passed | Root actual account/group save/reset, draft-preserving language switch, dark appearance; H/M; retained duplicate EN→ES fixed browser replay. | None. |
| P27 | Passed | Final12 real relocated restore:56 tables142 objects146 payloads, exact state/reader and unchanged source. | None. |
| T01 | Passed | Current accepted-decisions-current.json explicitly passes Travel-vs-USD/processor assertion. accepted-decisions-current.json exactacceptedtargettest passes; no unnecessary realTraveldata manufactured. | None. |
| T02 | Passed | Travel200 acquisition and distinct April20 linked refund retain Travel account; Native billed Travel debt130 after refund; repayment attribution remains Food100/Travel50 | None. |
| T03 | Passed | Verified100 receipt with three explicitly reviewed identities allocates70Food/20Home/10Pets; Exactly one100 purchase journal and100 total expense; one receipt links all three allocations; EN/ES detail preserves native cents | None. |
| T04 | Passed | Writer receipt-first unknown purpose; allocation tests keep unsupported remainder Unallocated. | None. |
| T05 | Passed | Writer product approval invalidation/code move; arithmetic alone never approves identity. | None. |
| T06 | Passed | Writer issuer cases and receipt rejection prove guarded admission; financial-nature tests retain review. | None. |
| T07 | Passed | W + root browser selected/future/history preview and confirmation; source values unchanged. | None. |
| T08 | Passed | W effective-period/history total assertions + root browser both September source purposes updated via confirmed history. | None. |
| T09 | Passed | Receipt establishes600 supported principal once in January; February100 first installment moves unbilled600→500 and billed0→100 without new expense; Original January600 and February100 remain separately rendered EN/ES after later correction/refund | None. |
| T10 | Passed | 100 actual synthetic repayment makes billed0, retains unbilled500/expense600, credits explicit unresolved source clearing100; Rendered EN/ES warning states clearing is not available cash | None. |
| T11 | Passed | Current accepted-decisions-current.json passes supported interest separate from estimate/principal/repayment. accepted-decisions-current.json exactsupported10interest/estimate-only targettest passes. | None. |
| T12 | Passed | Frozen per-card openings, independent anchors, recovery and continuity tests. Supported opening mode selected for release candidate with eachactualcoverage date and disclosedunknownfutureprincipal; anchors/continuity/recovery proven. No livecutoverauthorization. | None. |
| T13 | Passed | Current accepted-decisions-current.json passes ordinary appliance expense default. accepted-decisions-current.json exactordinary300appliance expense defaulttest passes. | None. |
| T14 | Passed | March correction reversal/replacement remain effective January15 and original entry persists; Actual April5 refund is a distinct April event, not part of March correction; R2 purchase and billed April selectors retain April and display20 refund EN/ES; missing billing-cycle errors still enforced by focused tests | None. |
| T15 | Passed | Writer8000 receipt then later statement bills same purchase; unknown card remains reviewable. | None. |
| T16 | Passed | Known Food100 precedes Travel200;150 repayment attributes100Food/50Travel, leavesFood0/Travel150 before later refund; EN/ES native-purpose table discloses issuer precedence then oldest-billed-first analytical convention, not issuer confirmation, with unattributed opening/excess/unbilled safeguards; After later April refund, February point-in-time table still preserves Food0/Travel150 and100/50 repayments | None. |
| T17 | Passed | Root browser language preserves correction report context/draft and account/group custom names; W financial state invariant. | None. |
| T18 | Passed | Root browser saved literal Mi casa QA, reset built-in label, cross-type Viajes2026QA membership/debt unchanged EN/ES; W service proof. Rootbrowsersaved/resetbuiltinname andcross-typegroup names/membershipEN/ES; Wconfirms no financialmutation. | None. |
| T19 | Passed | Root bilingual alert stable codes/counts plus rebuilt duplicate upload EN→ES same2026-09-11/#6; source preserved. UploadduplicateEN→ESbrowserfixedsamecode/date/id; correctionforms/classifierstructuredfeedbackfocusedtests pass. Classifierbrowserreplay tracksP25. | None. |

The selected initial runtime is the compatible private same-Mac Apple Vision/PG18 installation with persistent private local storage and loopback-only access. This is not a remote host or public deployment claim. The selected release-candidate basis is supported opening balances at each actual card coverage date, with historical source analytics retained and unsupported future principal in forecast/review. Neither choice invents missing history, approves pending identities or authorizes live cutover. Fresh application-wide writer freeze, backup/delta reconstruction and concrete live authorization remain mandatory.

Final controlled proof independently verified all 41 referenced artifact hashes: P07/T02/T03/T09/T10/T14/T16 passed with bilingual posted-state rendering. Earlier April-month omission and missing repayment-convention disclosure remain recorded as failed observations and have passing R2 replays. The final strict CLI result is `qa-output/accounting-acceptance/release-check.json`; actual live-cutover authorization remains false.
