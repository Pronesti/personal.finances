# Competitor Research: Personal Finance Apps

Survey of existing trackers to inform the credit-card-statement analysis app (see `analysis.md` §1–7). Researched 2026-08-25 against primary sources (official sites, help centers, first-party blogs/changelogs, GitHub repos/docs); claims verifiable only via secondary reporting are flagged. Anything not discoverable from the sources checked is marked **not documented**.

---

## Group 1 — Mainstream trackers (US)

### Mint (Intuit) — shut down

- **Shutdown**: announced Oct 31, 2023 — "we are reimagining Mint as part of Intuit Credit Karma"; "Mint is going away, and we have phased communications and user migration by design" ([Credit Karma official release: "Intuit Credit Karma welcomes all Minters"](https://www.creditkarma.com/about/releases/intuit-credit-karma-welcomes-all-minters)). Initially slated for Jan 1, 2024 ([Bloomberg](https://www.bloomberg.com/news/articles/2023-11-01/intuit-winds-down-personal-finance-app-mint-shifts-users-to-credit-karma)); final shutdown **March 23, 2024** ([Credit Karma support: Intuit Mint and Credit Karma](https://support.creditkarma.com/s/article/Intuit-Mint-and-Credit-Karma)).
- **Official reasoning**: consolidation into Credit Karma (acquired 2020). The Mint team had joined Credit Karma to build its Net Worth experience, combining "Mint's more than 15 years of product experience" ([CK press release, Mar 9 2023](https://www.creditkarma.com/about/releases/credit-karma-aims-to-help-millions-of-americans-know-grow-and-protect-their-net-worth)). No deeper first-party rationale was published; reporting attributes it to the collapse of free-with-ads aggregation economics (secondary).
- **What migrated**: "the majority of your Mint financial account balances, historical net worth, and 3 years of transactions" ([CK support article](https://support.creditkarma.com/s/article/Intuit-Mint-and-Credit-Karma)). Credit Karma never claimed budget parity — Mint-style **monthly budgets, custom categories, and savings goals did not carry over** ([welcomes-all-minters](https://www.creditkarma.com/about/releases/intuit-credit-karma-welcomes-all-minters); [Clark](https://clark.com/personal-finance-credit/budgeting-saving/mint-shuts-down/), secondary).
- **Feature set (as marketed)**: linking to 17,000+ institutions, transaction monitoring, spending categories, net worth ([mint.intuit.com](https://mint.intuit.com/), now a redirect page). Free, ad-supported.
- **Lesson**: the free-aggregator model died; every successor below charges a subscription. The post-Mint vacuum is what Monarch/Copilot/Simplifi grew into ([TechCrunch](https://techcrunch.com/2023/11/02/personal-finance-monarch-intuit-mint), secondary).

### YNAB

- **Core**: zero-based envelope budgeting ("give every dollar a job"), bank sync + auto import, targets, debt tools, net worth and spending reports, sharing up to 6 users ([ynab.com/features](https://www.ynab.com/features)).
- **Categorization**: manual-first with payee memory — "once you've set a category for a payee, YNAB does this automatically" ([Categorizing Transactions](https://support.ynab.com/en_us/categorizing-transactions-a-guide-HyRl60sks)). No ML claimed.
- **Recurring**: no automatic detection documented; recurring items are user-created repeating scheduled transactions ([How to Add Transactions](https://support.ynab.com/en_us/how-to-add-transactions-in-ynab-HyDwA_byi)).
- **Forecasting**: none — by design YNAB budgets only money you already have. **Anomaly alerts**: not documented.
- **Multi-currency / inflation**: no conversion; "when using more than one currency, we recommend creating a separate budget" ([multi-currency guide](https://support.ynab.com/en_us/using-multiple-currencies-in-ynab-a-guide-SyBF6PHno)). No inflation handling.
- **Dashboard / charts**: budget screen; "Reflect" view with spending breakdown, net-worth trend, savings progress bars ([features](https://www.ynab.com/features)).
- **Ingest**: Direct Import via linked accounts — YNAB operates "as an agent of Plaid Financial Ltd." ([features](https://www.ynab.com/features)); drag-and-drop file import (CSV/OFX/QFX), CSV needs no pre-formatting ([File-Based Import](https://support.ynab.com/en_us/file-based-import-a-guide-Bkj4Sszyo), [CSV formatting](https://support.ynab.com/en_us/formatting-a-csv-file-an-overview-BJvczkyuRq)).
- **Pricing**: $14.99/mo or $109/yr, 34-day trial ([features](https://www.ynab.com/features)).

### Monarch Money

- **Core**: all-accounts aggregation (banks, cards, loans, real estate, investments), net worth, flexible budgets, goals, partner/advisor access at no extra cost ([monarch.com](https://www.monarch.com/)).
- **Categorization**: automatic via AI/rules with custom rules; transactions support search and "review" marking ([monarch.com](https://www.monarch.com/)).
- **Recurring**: "Automatically detects your recurring subscriptions — like streaming services, gyms, or app memberships" ([monarch.com](https://www.monarch.com/)).
- **Forecasting**: goal planning and cash-flow adjustment toward goals; no balance-forecast tool documented. **Anomaly alerts**: not documented.
- **Multi-currency / inflation**: USD-only, **no conversion** — mixed CAD/USD accounts "will show as $20,000, combining the two amounts as if they are the same currency" ([International Accounts and Currency](https://help.monarchmoney.com/hc/en-us/articles/360048393552-International-Accounts-and-Currency)). No inflation handling.
- **Dashboard / charts**: customizable dashboard, user-selected widgets; customizable reports for spending trends, income, net-worth trajectories ([monarch.com](https://www.monarch.com/)).
- **Ingest**: **Plaid, Finicity (Mastercard), and MX with user-selectable provider**, 13,000+ institutions, manual accounts ([Guide to Connecting Your Accounts](https://help.monarchmoney.com/hc/en-us/articles/360048393352-Guide-to-Connecting-Your-Accounts)).
- **Pricing**: ~$99/yr, 7-day trial; "Plus" tier exists ([pricing](https://help.monarch.com/hc/en-us/articles/9136169422996-Pricing), [Plus tier](https://help.monarch.com/hc/en-us/articles/48349699981972-Monarch-Plus-Tier)).

### Copilot Money

- **Core**: spending tracking, budgets with rollovers, investments (stocks/crypto/ETF, real estate via Zillow), net worth, cash-flow analysis ([copilot.money](https://copilot.money/)).
- **Categorization — the ML reference implementation**: "Copilot Intelligence" is an in-house **per-user ML model** using "the name of the transaction, amount, day of the week, which card was used, and a few other data points"; activates after the user reviews **30 transactions**; **skips low-confidence predictions** and surfaces "the top two guesses"; corrections retrain it; "built in-house and with privacy in mind" ([Copilot Intelligence for Spending](https://help.copilot.money/en/articles/8182433-copilot-intelligence-for-spending), [changelog](https://changelog.copilot.money/log/copilot-intelligence)).
- **Recurring**: auto-detects likely recurrings at onboarding; Recurrings tab organizes paid / left-to-pay / future / archived ([Creating Recurrings](https://help.copilot.money/en/articles/3760068-creating-recurrings), [Recurrings Tab](https://help.copilot.money/en/articles/9778259-recurrings-tab-overview)).
- **Forecasting**: "Spending line" — dotted ideal-pace line vs actual month-to-date spend, plus a "Free to Spend" number ([Dashboard Tab Overview](https://help.copilot.money/en/articles/6045480-dashboard-tab-overview)).
- **Anomaly alerts**: not documented (the "To Review" inbox flags new transactions for confirmation).
- **Multi-currency / inflation**: not documented.
- **Dashboard**: Spending graph + Free to Spend, To Review inbox, Budgets snapshot, Upcoming recurrings, Net This Month ([Dashboard Tab Overview](https://help.copilot.money/en/articles/6045480-dashboard-tab-overview)).
- **Charts**: spending line, cash-flow charts, allocation pies, investment performance ([copilot.money](https://copilot.money/)).
- **Ingest**: mostly **Plaid**, plus Finicity, MX, and Akoya; direct integrations with Apple, Capital One, Public, Coinbase ([How Do You Get My Financial Data?](https://help.copilot.money/en/articles/10768078-how-do-you-get-my-financial-data)).
- **Pricing**: $95/yr (~$7.92/mo), one-month trial ([copilot.money](https://copilot.money/)).

### Rocket Money

- **Core**: subscription management, spend tracking, bill negotiation, budgets, credit monitoring, net worth ([rocketmoney.com](https://www.rocketmoney.com/)).
- **Categorization**: automatic, "an effortless breakdown of your finances"; method not documented ([rocketmoney.com](https://www.rocketmoney.com/)).
- **Recurring — its raison d'être**: auto-identifies recurring charges; Premium concierge: "Let us cancel your subscriptions for you" ([rocketmoney.com](https://www.rocketmoney.com/)).
- **Forecasting**: not documented. **Anomaly alerts**: Premium **Balance Alerts** "when your checking account falls below a safe balance or when your credit spend is too high" ([rocketmoney.com](https://www.rocketmoney.com/)) — threshold alerts, not merchant-level anomaly detection.
- **Multi-currency / inflation**: not documented.
- **Dashboard / charts**: unified "simple to understand dashboard"; spending trends; chart specifics not documented.
- **Ingest**: **Plaid** — "Your sensitive information is sent directly to Plaid, our trusted account connection partner" ([security page](https://www.rocketmoney.com/security)).
- **Pricing**: freemium; Premium is choose-your-own-price, typically $7–14/mo ([pricing page](https://www.rocketmoney.com/learn/personal-finance/how-much-does-rocket-money-cost), [Premium features](https://help.rocketmoney.com/en/articles/2677184-premium-membership-features)).

### Empower Personal Dashboard (ex Personal Capital)

- **Core**: free net-worth/investment dashboard as funnel for paid advisory; budgeting & cash flow, retirement planner, savings planner, fee/portfolio analysis ([empower.com/tools](https://www.empower.com/tools), [Budget & Cash Flow](https://www.empower.com/tools/budgeting-cash-flow)).
- **Categorization**: "automatically categorizes your spending"; method not documented ([Budget & Cash Flow](https://www.empower.com/tools/budgeting-cash-flow)).
- **Recurring**: not documented.
- **Forecasting**: Retirement Planner — "test-drive what retirement could look like," Lifetime Income Score, projected monthly retirement income, scenario testing ([Retirement Planner](https://www.empower.com/tools/retirement-planner)). No near-term cash-flow forecast documented.
- **Anomaly alerts / multi-currency / inflation**: not documented.
- **Dashboard / charts**: net worth at a glance, 90-day investment performance, retirement progress, spending categories, allocation ([empower.com/tools](https://www.empower.com/tools), [Dashboard Overview](https://support-personalwealth.empower.com/hc/en-us/articles/201169740-Dashboard-Overview)).
- **Ingest**: **Yodlee (Envestnet) FastLink** aggregation ([Terms of Use](https://www.empower.com/hpc/terms-of-use)); nightly refresh + manual re-sync ([support](https://support-personalwealth.empower.com/hc/en-us/articles/23481877705751-Re-sync-Account-Transactions)).
- **Pricing**: dashboard free; advisory from $250k AUM ([empower.com/tools](https://www.empower.com/tools)).

### PocketGuard

- **Core**: safe-to-spend budgeting around one number — **"In My Pocket"**: disposable income "after paying your bills, saving for your goals, and setting aside enough money for needs and wants," computed from expected monthly income minus upcoming bills, goals, cleared spend ([App Store listing](https://apps.apple.com/app/id949414211)); bill organizer, subscription manager, debt payoff planner.
- **Categorization**: automatic with custom categories; method not documented ([App Store listing](https://apps.apple.com/app/id949414211)).
- **Recurring**: auto-identifies bills/subscriptions after linking; due-date reminders ([App Store listing](https://apps.apple.com/app/id949414211)).
- **Forecasting**: **"PACE"** metric "forecasts how your month is trending based on your actual spending behavior" ([App Store listing](https://apps.apple.com/app/id949414211)).
- **Anomaly alerts / multi-currency / inflation**: not documented.
- **Dashboard / charts**: In My Pocket number front and center; pie charts and line graphs for categories and month-over-month trends ([App Store listing](https://apps.apple.com/app/id949414211)).
- **Ingest**: 18,000+ institutions via **Plaid and Finicity** (dual aggregators for redundancy) ([PocketGuard blog](https://pocketguard.com/blog/pocketguard-vs-monarch-money/)).
- **Pricing**: free tier; Plus $12.99/mo, $74.99/yr, or **$149.99 lifetime** ([App Store listing](https://apps.apple.com/app/id949414211)).

### Quicken Simplifi

- **Core**: **Spending Plan** — "starts with your monthly income, subtracts your bills & subscriptions," auto-adjusts as you spend, shows "how much you have left to spend per day for the rest of the month," with rollovers; viewable up to a year ahead ([product page](https://www.quicken.com/products/simplifi)).
- **Categorization**: "automatically categorize[s] all your transactions"; method not documented ([product page](https://www.quicken.com/products/simplifi)).
- **Recurring**: detects/tracks bills & subscriptions, due-date reminders with projected balances ([product page](https://www.quicken.com/products/simplifi)).
- **Forecasting — best-in-class**: **Projected Cash Flow** graphs future balances up to **12 months** ahead factoring recurring income, bills, and planned spending, with "what-if" scenarios ([Projected Cash Flow](https://www.quicken.com/features/projected-cashflow/), [mobile help](https://support.simplifi.quicken.com/en/articles/5274786-using-projected-cash-flow-on-the-mobile-app)). **Watchlists**: mini-budgets by payee/tag/category group that "project your likely monthly total based on current behavior, compare it to your 12-month average," with target alerts ([Watchlists help](https://support.simplifi.quicken.com/en/articles/3472367-using-watchlists-on-the-web-app)).
- **Anomaly alerts**: watchlist near/over-target alerts only; suspicious-charge detection not documented.
- **Multi-currency / inflation**: not documented.
- **Dashboard**: **12 customizable default tiles** — Spending Plan, Net Worth, Recent Transactions, Bills & Income, Top Spending Categories (30 days), Savings Goals, Watchlist, Spending by Month (6 mo), Income by Month (6 mo), Achievements, Investments, Credit Score ([Getting to Know Your Dashboard](https://support.simplifi.quicken.com/en/articles/3357180-getting-to-know-your-dashboard)).
- **Charts**: projected-balance line, monthly spending/income bars, category breakdowns ([Projected Cash Flow](https://www.quicken.com/features/projected-cashflow/)).
- **Ingest**: 14,000+ institutions via aggregation partner (OAuth API connections rolling out); **CSV import** via template or bank files; manual accounts ([bank connection help](https://support.simplifi.quicken.com/en/articles/5687989-how-does-quicken-simplifi-connect-to-my-bank), [CSV import](https://support.simplifi.quicken.com/en/articles/4413430-how-to-manually-import-transactions)).
- **Pricing**: $3.99/mo billed annually (list $6.99) ([product page](https://www.quicken.com/products/simplifi)).

---

## Group 2 — Argentine / LatAm apps (cuotas, inflación, dual currency)

### Key question answered first

**Does any Argentine app offer CPI-adjusted real-terms spending views or personal-inflation tracking? No shipping consumer app does.**

- No bank app (Galicia, BBVA, Santander), wallet (Ualá, Mercado Pago, Belo), or tracker (Finy, Ábaco, MonAi, Toshl) documents any IPC/CPI adjustment or real-terms view. Finy's own [comparison guide of Argentine expense apps](https://www.finyapp.io/guias/mejor-app-de-gastos-argentina) discusses currency handling at length with zero mention of inflation-adjusted views — corroborating the absence.
- The market's workaround is **USD as the deflator, not CPI**: [Ábaco](https://www.abaco.uno/) stores "el tipo de cambio del momento" per transaction so users can "comparar tu evolución mes a mes incluso en contextos de inflación y devaluación" — dollar-terms comparison, explicitly not IPC adjustment. [FocusFolio](https://focusfolio.com.ar/) (private beta) markets for "inflación local" but its mechanism is also dólar-blue conversion (live rate via DolarAPI).
- Personal-inflation tracking exists only as **web calculators disconnected from spending data**: [Tu Inflación](https://www.estadisticaciudad.gob.ar/tuinflacion/) (Buenos Aires City statistics office) lets users build a consumption profile and compute their own inflation vs IPCBA; generic adjusters ([ipc.com.ar](https://ipc.com.ar/), [servidos.ar](https://servidos.ar/calculadora-ajuste-inflacion); [El Cronista roundup](https://www.cronista.com/infotechnology/finanzas-digitales/calculadoras-digitales-de-inflacion-como-sacar-la-cuenta-de-cuanto-subieron-mis-gastos/)) adjust one-off amounts, not histories.

### Ualá

- **Core**: prepaid + credit Mastercard, savings, USD account, FCI/plazo fijo/CEDEARs, loans ([uala.com.ar](https://www.uala.com.ar/)). Credit card: "consumos hasta en 24 cuotas," government "Cuota simple," in-app "Resumen de Tarjeta," pay minimum/partial/total ([tarjeta-de-credito](https://www.uala.com.ar/tarjeta-de-credito)).
- **Categorization**: press describes organizing spending "por mes, por categorías, por colores" ([iProfesional](https://www.iprofesional.com/tecnologia/310891-ual-como-funciona-una-tarjeta-sin-cuenta-bancaria), secondary); current official site no longer foregrounds expense analysis — marketing leads with yields/investing.
- **Recurring / forecasting / anomaly**: not documented; real-time push "notificación en la app por cada compra" ([tarjeta-de-credito](https://www.uala.com.ar/tarjeta-de-credito)).
- **Currency / inflation**: separate USD account, official/MEP dollar purchase, USD settlement of foreign consumption; no CPI features (its blog only [explains what IPC is](https://www.uala.com.ar/aula-uala/blog/categorias/finanzas-personales/que-es-el-ipc)).
- **Ingest**: own-account data only (issuer).

### Finy — closest local analog to this project

- **Ingest**: voice ("Toca el micrófono... la IA detecta monto, categoría y método"), ticket-photo scan, **bank-statement PDF import** ("Resúmenes bancarios PDF: extrae cada movimiento"), chat entry, **Mercado Pago auto-sync** (AR/BR/MX/CO/CL/PE/UY) ([finyapp.io](https://www.finyapp.io/)).
- **Cuotas — explicit**: "Detecta pagos a cuotas y los divide automáticamente"; Mercado Pago installment purchases imported **split by month**; manual cuota splitting on edit ([finyapp.io](https://www.finyapp.io/), [Google Play changelog](https://play.google.com/store/apps/details?id=com.finy.app)).
- **Categorization**: AI auto-categorization by merchant type. **Recurring**: payment reminders; detection mechanics not documented.
- **Forecasting**: "¿Me conviene?" affordability analysis; monthly AI review ("El 1° de cada mes, alguien miró tus números"); no cuota-obligation projection documented. **Anomaly**: not documented.
- **Currency / inflation**: 40+ currencies incl. ARS/USD, stores exchange rate at transaction time; **no CPI adjustment** ([finyapp.io](https://www.finyapp.io/)).
- **Pricing**: freemium — 100/500/1,000 tx/mo, 10/75/200 AI queries, 2/30/100 scans (Gratis/Plus/Pro) ([finyapp.io](https://www.finyapp.io/)).

### Ábaco — Argentine dual-currency tracker

- Built "especialmente para Argentina": **ARS/USD "multimoneda real" with blue, MEP, or official rate; every movement stores the exchange rate of the moment** ([abaco.uno](https://www.abaco.uno/)).
- Custom categories, monthly budgets with overspend alerts, category-breakdown and monthly-evolution charts, manual entry + **Mercado Pago integration**, offline-first, free ([abaco.uno](https://www.abaco.uno/)).
- **Cuotas**: no installment feature documented. **CPI**: none — dollar-terms comparison is its inflation answer. **Recurring/anomaly**: reminders only.

### MonAi (the "MonI" candidate)

- "MonI" as named doesn't exist as an Argentine tracker; matches are [Moni](https://moni.com.ar/) (payday-loans fintech, not a tracker) and **[MonAi](https://apps.apple.com/ar/app/finanzas-personales-monai/id6447112647)** by an Argentine developer: **voice-message expense entry with AI auto-split/categorization**, budgets with progress bars, recurring-transaction management, per-list currencies, iCloud-local storage. Cuotas/inflation: not documented.

### Toshl Finance (global, popular in AR)

- **Multi-currency best-in-class**: built multi-currency "at all levels" — ~200 currencies + crypto, hourly rate updates, **user-entered custom rates** (how Argentines encode the blue/MEP gap), historical rates, per-account and per-budget currency ([toshl.com/es/divisas](https://toshl.com/es/divisas/)).
- Budgets with per-category notifications; bank linking claimed for 13,000+ institutions incl. Argentina ([App Store listing](https://apps.apple.com/es/app/toshl-finanzas-mis-cuentas/id921590251)) — in practice AR feeds are limited, manual/CSV common.
- **Cuotas**: no native installment splitting documented. **Inflation**: nothing.

### Belo

- Argentine crypto wallet centered on **dollarization**: pesos in via CBU/Mercado Pago → instant USDT/DAI/USDC ("dólares digitales"), 50+ cryptos, USD yield ~8.25%, prepaid Mastercard with crypto cashback up to 21% ([Rankia](https://www.rankia.com.ar/blog/cripto/7420144-belo-opiniones-comisiones-argentina), [ComparaLatam](https://comparalatam.com/ar/crypto/belo.html), secondary; [belo.app/ar](https://belo.app/ar) markets cross-border USD, QR payments, bill-payment reminders).
- **Spending analysis, categorization, charts, cuotas, CPI: not documented.** Belo answers inflation by **currency escape**, not measurement.

### Banco Galicia app

- **Statement/cuotas**: in-app consumos, resúmenes, limits; statement shows pending cuotas ([help: leer resumen](https://ayuda.bancogalicia.com.ar/n4/como-leo-el-resumen-de-mi-tarjeta/), [consultar resumen](https://ayuda.bancogalicia.com.ar/n4/como-consulto-el-resumen-de-mi-tarjeta-de-credito)).
- **"Cuotificación"**: converts **debit-card** purchases into up to 3 fixed installments with interest post-purchase, via Cuentas → "Cuotificá" with in-flow credit evaluation ([galicia.ar](https://www.galicia.ar/personas/prestamos/cuotificacion-consumos); [La Nación](https://www.lanacion.com.ar/economia/cuotificar-los-consumos-conoce-la-nueva-herramienta-para-hacer-rendir-tus-finanzas-nid16032022/), secondary).
- Automatic "contador de ahorros" totaling promo savings; due-date alerts; in-app USD buy/sell. **Categorization, recurring detection, anomaly alerts, forecasting, CPI: not documented.**

### BBVA Argentina — "Mi día a día"

- The most complete bank PFM found: income/expenses by **category and subcategory** (gastronomía, salud, educación, indumentaria, hogar, servicios y seguros...); manual **recategorization** (the system does not yet learn from it); **budgets per subcategory** with auto-renewal; income-vs-expense chart; data updated within one business day; free ([bbva.com.ar Mi día a día](https://www.bbva.com.ar/personas/servicios-digitales/bbva-movil/mi-dia-a-dia.html)). Includes a financial **aggregator** for external accounts ([BBVA global platform rollout](https://www.bbva.com/es/ar/innovacion/bbva-despliega-su-plataforma-global-de-banca-movil-en-argentina/)).
- **Cuota forecasting, recurring detection, anomaly alerts, inflation/dual-currency views: not documented.**

### Santander Argentina app

- **Plan V / cuotificación**: refinance the statement balance or single-payment purchases into fixed peso cuotas (up to 24–36), minimum $100, on the amount between minimum and total payment; card stays usable ([santander.com.ar cuotificación](https://www.santander.com.ar/personas/prestamos/cuotificacion)).
- App: statement consultation ([help center](https://ayuda.santander.com.ar/KMG0RRUEH7-1/article/UJEU8S9O5B-como-consultar-resumen-tarjeta-credito/)), USD buy/sell, QR, investments. **Spending analysis, categorization, recurring, anomaly, CPI: not documented.**

### Mercado Pago

- **"Tus gastos"** under "Tu dinero": **pie chart** of monthly spending by auto-assigned category with totals below; category drill-down with **evolution over time**; manual recategorization; monthly budget with a depleting bar ("Creá tu presupuesto") vs prior months ([Mercado Pago blog](https://blog.mercadopago.com.ar/productos/lleva-un-control-de-tus-gastos-con-mercado-pago)).
- Covers only MP-account spending. Cuotas appear as a payment option, not as tracked future obligations. **Recurring, anomaly, CPI, USD views: not documented.**

### Others found (brief)

- **FocusFolio** ([focusfolio.com.ar](https://focusfolio.com.ar/)): Argentine, private beta; spending blocks incl. credit cards with **closure and due dates**, live dólar-blue conversion (DolarAPI, 5-min refresh), crypto net worth, AI monthly summaries; no CPI adjustment.
- **Finanz** ([finanz.com.ar](https://www.finanz.com.ar/)): Argentine; "Controlá tarjetas, préstamos y cuentas en un solo lugar," family roles; deeper features not documented.
- **Blin AI**: Argentine voice-AI tracker, minimal multi-currency ([FocusFolio roundup](https://focusfolio.com.ar/mejores-apps-finanzas-personales-argentina), secondary).
- **Buendolar**: not a tracker — BCRA-regulated zero-spread digital FX house ([Cronista](https://www.cronista.com/infotechnology/entreprenerds/buendolar-lanzan-una-plataforma-para-comprar-dolares-sin-spread-y-proteger-los-ahorros/)). **"Mis Cuentas"**: no standalone AR app found (it's Toshl's Spanish App Store subtitle). **Ceibo**: only an investment broker ([ceibogestion.com](https://ceibogestion.com/)).

### Group-2 takeaways

1. **Cuota future-obligation forecasting is universally absent**: banks show pending cuotas inside the statement (and sell refinancing — Galicia Cuotificación, Santander Plan V); only Finy splits cuotas into future months; nobody documents a consolidated "your committed cuotas for the next N months" projection across cards.
2. **Dual currency is solved by dollarization** (Belo stablecoins, Ábaco/FocusFolio blue-rate ledgers, bank USD accounts), with **storing the exchange rate at transaction time** emerging as the local best practice.
3. **CPI-adjusted real-terms views: gap confirmed** — the only personal-inflation tool is a government web calculator disconnected from spending data.

---

## Group 3 — Open-source self-hosted

### Firefly III

- **Core**: self-hosted manager on **double-entry bookkeeping**: budgets, categories, tags, piggy banks, subscriptions (bills), recurring transactions, rules, webhooks, multi-currency, 2FA, REST JSON API "covering almost every part of Firefly III"; AGPL-3.0 ([README](https://github.com/firefly-iii/firefly-iii)).
- **Categorization — rules, not ML**: **triggers** (description matches, amount > X, created/updated) + **actions** (set budget/category/tags/description/amount/accounts), in ordered **rule groups**; "strict" (ALL) vs non-strict (ANY) matching; invertible triggers; "stop processing" short-circuits; an **expression engine** for computed actions; rules cannot fire other rules ([rules docs](https://docs.firefly-iii.org/how-to/firefly-iii/features/rules/), [actions](https://docs.firefly-iii.org/references/firefly-iii/rule-actions/), [triggers](https://docs.firefly-iii.org/references/firefly-iii/rule-triggers/)).
- **Recurring vs subscriptions — two features**: (1) **Recurring transactions** auto-create transactions on a schedule (daily/weekly/monthly/nth-weekday/yearly, skip-every-X, weekend fallback) via cron ([recurring docs](https://docs.firefly-iii.org/how-to/firefly-iii/finances/recurring/)). (2) **Subscriptions** track expected bills with **min/max expected amount and period; Firefly predicts expected spend** and shows expected-vs-paid on the front page; creating one redirects into creating a matching rule so future transactions auto-link ([subscriptions docs](https://docs.firefly-iii.org/how-to/firefly-iii/finances/subscriptions/)).
- **Forecasting**: limited to subscription min/max expectations and budget tracking. **Anomaly**: not documented (webhooks enable DIY).
- **Dashboard / charts**: front page with account balance charts, budget/category boxes, subscriptions expected-vs-paid box; URL-addressable **reports** scoped by accounts/date/budget/category/tag ([reports docs](https://docs.firefly-iii.org/how-to/firefly-iii/finances/reports/)).
- **Ingest — pattern worth copying**: the **Data Importer is a separate companion app** ("separated from Firefly III for security and maintenance reasons") talking to Firefly over its API with OAuth/personal tokens; imports **CSV and camt** files and syncs banks via **GoCardless (ex-Nordigen), SimpleFIN, Salt Edge/Spectre**; CLI/web + cron automation ([data-importer repo](https://github.com/firefly-iii/data-importer), [importer intro](https://docs.firefly-iii.org/explanation/data-importer/introduction/), [GoCardless](https://docs.firefly-iii.org/how-to/data-importer/import/gocardless/), [SimpleFIN](https://docs.firefly-iii.org/how-to/data-importer/import/simplefin/), [Salt Edge](https://docs.firefly-iii.org/how-to/data-importer/import/salt-edge/)). **Duplicate detection is two-mode**: content-based (SHA hash over the pre-rules transaction payload) and identifier-based (unique external-ID column) ([duplicate detection](https://docs.firefly-iii.org/references/data-importer/duplicate-detection/)).
- **Architecture**: PHP/**Laravel**, classic client-server web app (no offline sync); MySQL/PostgreSQL/SQLite; Docker/Kubernetes ([README](https://github.com/firefly-iii/firefly-iii)).

### Actual Budget

- **Core**: "a local-first personal finance tool... 100% free and open-source, written in NodeJS"; envelope (zero-sum) budgeting; ~28k stars ([README](https://github.com/actualbudget/actual)).
- **Architecture — closest to this project's plan**: monorepo — `loot-core` shared logic, `desktop-client` web UI, Electron wrapper. **All data lives in a local SQLite database on the client**; the sync server is a dumb relay/backup ([sync docs](https://actualbudget.org/docs/getting-started/sync/)). **CRDT sync**: [`packages/crdt`](https://github.com/actualbudget/actual/tree/master/packages/crdt) encodes protobuf messages; per creator James Long's [Using CRDTs in the wild](https://archive.jlongster.com/using-crdts-in-the-wild): every mutation emits **per-field last-write-wins messages** timestamped with **Hybrid Logical Clocks**, stored in an append-only `messages_crdt` table ("all data is stored twice"); a **merkle trie of message hashes** finds the divergence point so peers exchange only missing messages. Optional **E2E encryption** (password-derived key; server can't read; unrecoverable if lost) ([sync docs](https://actualbudget.org/docs/getting-started/sync/)).
- **Categorization**: **rules engine** — conditions on payee/imported payee/account/amount/notes/date (incl. regex, `one of`) → actions (set category/payee/notes), executed in specificity-ranked order with `pre`/`default`/`post` stages; Actual **auto-creates rules from behavior** when you rename payees or categorize repeatedly ([rules docs](https://actualbudget.org/docs/budgeting/rules/)).
- **Recurring — concrete heuristics worth stealing**: **Schedules** support monthly/bi-weekly/weekly/custom recurrences, multiple days per month, weekend shifting; **approximate amounts match at ±7.5%**; incoming transactions match if **dated within 2 days** of schedule; auto-post or await approval; and **"Find schedules" mines transaction history for recurring patterns and suggests them** — the only OSS recurrence *detection* found ([schedules docs](https://actualbudget.org/docs/schedules/)).
- **Forecasting**: Crossover Point report (passive income vs expenses); experimental **Balance Forecast** and **Monte Carlo Analysis** ([reports docs](https://actualbudget.org/docs/reports/)). **Anomaly**: not documented.
- **Multi-currency / inflation**: effectively single-currency; not documented.
- **Dashboard / charts**: customizable multi-dashboard reports — Cash Flow, Net Worth (trend/stacked), Spending Analysis, Summary and **Calendar** cards, custom reports, experimental **Sankey** ([reports docs](https://actualbudget.org/docs/reports/)).
- **Ingest**: file import + optional user-triggered bank sync via **GoCardless (EU; "not accepting new accounts"), SimpleFIN Bridge (US/CA), Pluggy.ai (Brazil), Akahu (NZ), Enable Banking (EU)**; "Actual does **not** sync bank data automatically"; provider credentials live on the server outside E2E encryption ([bank-sync docs](https://actualbudget.org/docs/advanced/bank-sync/)).

### Maybe Finance → Sure

- **Status**: repo **archived July 27, 2025** — "no longer actively maintained"; "Maybe is pivoting to B2B financial forecasting and scenario planning" ([repo](https://github.com/maybe-finance/maybe)). The company spent ~$1M building it before open-sourcing (~40k stars). Most-starred community fork: **[Sure (we-promise/sure)](https://github.com/we-promise/sure)** — active, same stack, Docker self-hosting, accessible "from a browser, the macOS desktop app, the mobile app, API clients, and LLM agents."
- **Stack**: **Ruby on Rails + PostgreSQL + Hotwire (Turbo/Stimulus)**, Redis/Sidekiq, Docker ([repo](https://github.com/maybe-finance/maybe)).
- **AI**: opt-in **OpenAI-powered chat assistant** with read access to financial data (Turbo Streams; `Provider::OpenAI` behind an `Assistant::Provideable` interface) plus AI **auto-categorization**; data goes to OpenAI only on opt-in ([AI wiki](https://github.com/maybe-finance/maybe/wiki/AI-and-your-financial-data), [PR #2022](https://github.com/maybe-finance/maybe/pull/2022)).
- Recurring detection, forecasting, anomaly: not documented at README level. **Lesson**: even a funded OSS personal-finance startup couldn't sustain B2C; the community keeps it alive.

### Ghostfolio

- **Core**: "Open Source Wealth Management Software" — portfolio tracker (stocks, ETFs, crypto), multi-account, performance across Today/WTD/MTD/YTD/1Y/5Y/Max, ROAI, **static analysis flagging portfolio risks**, import/export, PWA, AGPLv3 ([README](https://github.com/ghostfolio/ghostfolio)).
- **Architecture**: **Nx monorepo**, TypeScript; backend "NestJS using PostgreSQL as a database together with Prisma and Redis for caching"; frontend "Angular... Angular Material" ([README](https://github.com/ghostfolio/ghostfolio)).
- **Forecasting**: FIRE calculator — projected retirement date, 4%-rule sustainable withdrawal ([blog: Path to FIRE](https://ghostfol.io/en/blog/2023/07/exploring-the-path-to-fire)).
- **Multi-currency**: yes. **Ingest**: manual entry, **CSV/JSON import/export**, JSON API; market data from Yahoo Finance, CoinGecko, or manual ([README](https://github.com/ghostfolio/ghostfolio)). Expense categorization/recurring/anomaly: n/a — investment scope.

### Wallos

- **Core**: self-hosted **subscription tracker** — recurring payments and due dates, custom categories, logo search, statistics with **charts and calendar views**, mobile-friendly, OIDC; **notifications via email, Discord, Pushover, Telegram, Gotify, webhooks**; **AI recommendations via ChatGPT, Gemini, or local Ollama**; GPLv3 ([README](https://github.com/ellite/Wallos)).
- **Architecture — proof that simple works**: **PHP 8.3 + SQLite3**, Docker ([README](https://github.com/ellite/Wallos)).
- **Multi-currency**: yes, Fixer API conversion. **Ingest**: manual (tracks commitments, not transactions). Forecasting beyond monthly/yearly totals, anomaly: not documented.

### Paisa

- **Core**: personal finance manager "on top of the ledger double entry accounting tool" — plain-text files are the source of truth (**ledger, hledger, beancount**); rich dashboards; **CSV/Excel/PDF import with a template system**; **recurring-transaction tracking with calendar view** (rent, EMI, credit-card bills); budgets; goals + retirement calculator/forecasting; multi-currency; data never leaves your system; demo at [demo.paisa.fyi](https://demo.paisa.fyi) ([repo](https://github.com/ananthakumaran/paisa), [paisa.fyi](https://paisa.fyi/)).
- **Architecture**: **Go backend + Svelte frontend** (Tailwind), single-binary/Docker, AGPL-3.0 ([repo](https://github.com/ananthakumaran/paisa)). Anomaly: not documented.

### Also noted (brief)

- **Fava** ([repo](https://github.com/beancount/fava)): "a web interface for the double-entry bookkeeping software Beancount with a focus on features and usability" — Python + Svelte, no database (the `.beancount` text file is the store), BQL queries, importer framework you script yourself. hledger is the Haskell sibling.
- **Money Manager Ex** ([repo](https://github.com/moneymanagerex/moneymanagerex)): C++17/wxWidgets desktop over **SQLite3 (AES option)**, ApexCharts reports, "budgeting and cash flow forecasting," scheduled-bill reminders, CSV/QIF import.
- **Financier** ([repo](https://github.com/financier-io/financier)): offline-first YNAB4-style envelopes — **AngularJS + PouchDB→CouchDB replication**; a second local-first sync architecture besides Actual's CRDTs.
- **Frappe Books** ([repo](https://github.com/frappe/books)): Electron + Vue + SQLite double-entry accounting, aimed at SMEs more than personal finance.

---

## Cross-cutting patterns

### Common features (table stakes)

1. **Auto-categorization with a human-correction loop.** Every commercial app claims "automatic"; only Copilot documents the mechanism (per-user ML, confidence-gated, trained by review). OSS is rules-based everywhere — Firefly (triggers/actions + expression engine) and Actual (rules + behavior-learned rule creation) are the most sophisticated. Correction-as-training-signal is universal (Copilot review, BBVA recategorización, Mercado Pago recategorize). The planned LLM-once → persistent mapping → manual-override-wins flow matches the industry pattern.
2. **Recurring/subscription detection** is the single most marketed post-Mint feature (Rocket's whole business; Monarch, Copilot, Simplifi, PocketGuard lead with it). In OSS, only Actual's "Find schedules" *detects* recurrence from history; Firefly and Wallos require declaring subscriptions up front (Firefly then predicts expected spend from min/max ranges).
3. **One at-a-glance number** on the home screen: PocketGuard "In My Pocket", Simplifi left-to-spend-per-day, Copilot "Free to Spend". Everyone reduces screen one to "am I OK?" — validating the ELI5-first design.
4. **Chart vocabulary is narrow**: pie/donut for categories (Mercado Pago, PocketGuard), line for trends/net worth (YNAB, Simplifi), bars for monthly cash flow (Copilot, Simplifi). Sankey (experimental in Actual), calendar views (Wallos, Actual, Paisa), and layered projection bands are rare → visual differentiation opportunity.
5. **Dashboards are tile-based and increasingly customizable** (Simplifi's 12 default tiles, Monarch's widget picker, Actual's multi-dashboard reports).
6. **Post-Mint economics**: free-with-ads is dead; commercial apps are $50–150/yr subscriptions; OSS fills the free niche; even funded OSS (Maybe) failed as a business.

### Gaps nobody covers

- **Personalized-inflation tracking: nobody does it.** Not one app — US, Argentine, or open-source — reprices the user's own recurring basket against CPI. The only adjacent artifact is Buenos Aires' manual [Tu Inflación](https://www.estadisticaciudad.gob.ar/tuinflacion/) calculator, disconnected from spend data. **Clearest differentiator of this project.**
- **Real-terms (CPI-deflated) views**: absent everywhere; everything is nominal. Argentina's market answers inflation with **dollarization** (Belo stablecoins, Ábaco/FocusFolio blue-rate ledgers), never with deflation by index.
- **Cuota-aware forward-commitment analytics**: bank apps list pending cuotas and sell refinancing (Galicia Cuotificación, Santander Plan V); Finy splits cuotas by month; nobody renders a committed-future waterfall or blends contractual cuotas with recurring + trend layers.
- **Uncertainty-graded forecasting**: Simplifi projects 12 months but as a single line; Actual's Balance Forecast/Monte Carlo are experimental. Nobody visually separates certain / expected / estimated.
- **Anomaly / suspicious-charge detection**: essentially undocumented across all ~25 products surveyed. Closest: Rocket's balance-threshold alerts, Simplifi's watchlist target alerts, Ghostfolio's portfolio-risk rules. Merchant-novelty, duplicate-charge, and statement-integrity checks are unoccupied territory.
- **Statement-PDF ingestion**: rare — Finy ("Resúmenes bancarios PDF: extrae cada movimiento") and Paisa (PDF import templates) only. No AR bank-feed aggregator exists for cards, which makes the PDF→JSON pipeline both necessary and differentiating.

### Ingest & architecture patterns worth copying

- **Local-first SQLite as source of truth** ([Actual](https://actualbudget.org/docs/getting-started/sync/)) — validates the Next.js+SQLite plan; Actual proves a full finance app runs over client-side SQLite. Its CRDT/HLC sync layer is only needed for multi-device — skippable for a single-machine tool.
- **Import as a separate pipeline behind a clean boundary** ([Firefly Data Importer](https://github.com/firefly-iii/data-importer): "separated... for security and maintenance reasons," CLI/API-driven, cron-able) — mirrors keeping `pdf_to_json.py` outside the app behind an endpoint.
- **Two-mode duplicate detection at import** ([Firefly](https://docs.firefly-iii.org/references/data-importer/duplicate-detection/)): content hash over the raw payload + external unique ID — maps directly to `voucher` + (date, amount, merchant) hashing, complementing the `declared_totals` integrity check.
- **Rules run after import, idempotently** (Firefly triggers→actions; Actual rules with pre/default/post stages, auto-created from user behavior) — the persistent merchant-mapping file is effectively a rules table; keep it re-runnable over full history.
- **Concrete matching heuristics** ([Actual schedules](https://actualbudget.org/docs/schedules/)): amount tolerance **±7.5%**, date window **±2 days**, plus "Find schedules" pattern-mining — sane starting constants for recurring-charge clustering. For AR inflation, match on merchant+cadence and treat amount jumps as a signal (personal-inflation input / anomaly flag) rather than a match failure.
- **Confidence-gated ML with a review queue** ([Copilot Intelligence](https://help.copilot.money/en/articles/8182433-copilot-intelligence-for-spending): won't auto-apply low-confidence predictions, shows top-2 guesses, activates after 30 reviewed transactions) — adapt as: LLM proposes, low-confidence lands in a review queue, manual override always wins.
- **Store the exchange rate at transaction time** (Ábaco's "tipo de cambio del momento"; Toshl's custom rates) — local best practice; the statement JSONs already capture applied rates (`TC...` lines), and MEP series should be joined at ingest, not display time.
- **Boring stacks survive**: Wallos (PHP+SQLite), Paisa (Go+Svelte single binary), Firefly (Laravel) are healthy; the VC-funded Rails app (Maybe) died and was community-rescued. For a personal tool, simplicity is the moat.
