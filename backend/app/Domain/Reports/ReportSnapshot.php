<?php

namespace App\Domain\Reports;

use App\Domain\Catalog\CatalogSettings;
use App\Domain\Evidence\DocumentStore;
use App\Domain\Evidence\HistoricalAssociations;
use App\Domain\Evidence\ReceiptProducts;
use App\Domain\Evidence\ReceiptReconciliation;
use App\Domain\Evidence\ReceiptService;
use App\Domain\Ledger\AccountingError;
use App\Domain\Ledger\LedgerRepository;
use App\Domain\Ledger\Money;

class ReportSnapshot
{
    public function __construct(private LedgerRepository $repository) {}

    private function payloads(string $table, string $order = 'id'): array
    {
        return $this->repository->query($table)->orderBy($order)->get()->map(fn ($row) => json_decode($row->payload, true))->all();
    }

    private function latest(string $table, string $key): array
    {
        return $this->repository->query($table)->selectRaw('DISTINCT ON ('.$key.') payload')->orderBy($key)->orderByDesc($table === 'purchase_versions' ? 'version' : 'seq')->get()->map(fn ($row) => json_decode($row->payload, true))->all();
    }

    public function read(): array
    {
        return $this->repository->readSnapshot(fn () => $this->collect());
    }

    private function collect(): array
    {
        $repository = $this->repository;
        $accounts = $repository->query('accounts')->orderBy('id')->get()->map(fn ($row) => ['id' => $row->id, 'parentId' => $row->parent_id, 'type' => $row->type, 'labelKey' => $row->label_key, 'customName' => $row->custom_name, 'currency' => $row->currency, 'primaryPurposeId' => $row->primary_purpose_id, 'posting' => $row->posting, 'enabled' => $row->enabled])->all();
        $accountMap = array_column($accounts, null, 'id');
        $cards = $repository->query('cards')->orderBy('id')->get()->map(fn ($row) => ['id' => $row->id, 'displayName' => $accountMap['card:'.$row->id]['customName'] ?? $row->id])->all();
        $sources = $this->payloads('source_revisions', 'ordinal');
        $sourceMap = [];
        $current = [];
        foreach ($sources as &$source) {
            if ($source['kind'] === 'statement') {
                $source['closingDate'] = $source['rawPayload']['period']['closing_date'];
            } $sourceMap[$source['id']] = $source;
            if ($source['admission'] === 'accepted') {
                $current[$source['sourceKey']] = $source['id'];
            }
        }unset($source);
        $lines = $repository->query('source_lines')->orderBy('revision_id')->orderBy('occurrence')->get()->map(fn ($row) => ['id' => $row->id, 'revisionId' => $row->revision_id, 'occurrence' => $row->occurrence, 'payload' => json_decode($row->payload, true), 'legacyFingerprint' => $row->legacy_fingerprint])->all();
        $lineMap = array_column($lines, null, 'id');
        $statementRows = [];
        $nullableMinor = fn ($value) => $value === null ? null : Money::source($value);
        foreach ($sources as $source) {
            if ($source['kind'] !== 'statement') {
                continue;
            }$raw = $source['rawPayload'];
            $period = $raw['period'];
            $statementRows[] = ['id' => $source['id'], 'cardId' => $source['cardId'], 'sourceRevisionId' => $source['id'], 'current' => ($current[$source['sourceKey']] ?? null) === $source['id'], 'closingDate' => $period['closing_date'], 'previousClosingDate' => $period['previous_closing_date'] ?? null, 'dueDate' => $period['due_date'] ?? null, 'cycleMonth' => FinancialFacts::cycle($period['closing_date'], $period['previous_closing_date'] ?? null), 'balanceArsMinor' => $nullableMinor($raw['balances']['current_ars'] ?? null), 'balanceUsdMinor' => $nullableMinor($raw['balances']['current_usd'] ?? null), 'previousBalanceArsMinor' => $nullableMinor($raw['balances']['previous_ars'] ?? null), 'minimumPaymentArsMinor' => $nullableMinor($raw['balances']['minimum_payment_ars'] ?? null), 'purchaseLimitArsMinor' => $nullableMinor($raw['limits']['purchase'] ?? null), 'tnaPct' => $raw['rates']['annual_nominal_ars'] ?? null, 'temPct' => $raw['rates']['monthly_effective_ars'] ?? null];
        }
        usort($statementRows, fn ($a, $b) => strcmp($a['closingDate'], $b['closingDate']) ?: strcmp($a['cardId'], $b['cardId']) ?: strcmp($a['id'], $b['id']));
        $statements = array_column($statementRows, null, 'id');
        $schedules = [];
        foreach ($repository->query('issuer_schedules')->orderBy('revision_id')->orderBy('ordinal')->get() as $row) {
            $statement = $statements[$row->revision_id] ?? null;
            if ($statement === null) {
                throw new AccountingError('schedule_statement_missing');
            }$payload = json_decode($row->payload, true);
            $newer = array_filter($statementRows, fn ($other) => $other['current'] && $other['cardId'] === $statement['cardId'] && $other['closingDate'] > $statement['closingDate']);
            $schedules[] = ['cardId' => $statement['cardId'], 'revisionId' => $row->revision_id, 'current' => $statement['current'] && $newer === [], 'month' => $payload['month'], 'amount' => Money::source($payload['amount_ars']) / 100];
        }
        $journalLines = [];
        foreach ($repository->query('journal_lines')->orderBy('journal_id')->orderBy('ordinal')->get() as $line) {
            $journalLines[$line->journal_id][] = ['accountId' => $line->account_id, 'purchaseId' => $line->purchase_id, 'purposeId' => $line->purpose_id, 'debitMinor' => FinancialFacts::minor($line->debit_minor), 'creditMinor' => FinancialFacts::minor($line->credit_minor)];
        }
        $journalEvidence = [];
        foreach ($repository->query('journal_evidence')->orderBy('evidence_id')->get() as $row) {
            $journalEvidence[$row->journal_id][] = $row->evidence_id;
        }
        $journals = [];
        $journalSources = [];
        foreach ($repository->query('journals')->where('status', 'posted')->orderBy('effective_date')->orderBy('id')->get() as $row) {
            $journals[] = ['id' => $row->id, 'commandKey' => $row->command_key, 'cardId' => $row->card_id, 'currency' => $row->currency, 'effectiveDate' => $row->effective_date, 'recordedAt' => $row->recorded_at, 'kind' => $row->kind, 'reversesId' => $row->reverses_id, 'evidenceIds' => $journalEvidence[$row->id] ?? [], 'lines' => $journalLines[$row->id] ?? []];
            $candidates = [];
            foreach ($journalEvidence[$row->id] ?? [] as $id) {
                if (isset($lineMap[$id])) {
                    $line = $lineMap[$id];
                    $source = $sourceMap[$line['revisionId']];
                    if ($source['kind'] === 'statement') {
                        $candidates[] = ['lineId' => $id, 'revisionId' => $source['id'], 'payload' => $line['payload'], 'closingDate' => $source['closingDate'], 'previousClosingDate' => $source['rawPayload']['period']['previous_closing_date'] ?? null, 'ordinal' => array_search($source['id'], array_column($sources, 'id'), true)];
                    }
                }
            }
            if ($candidates === []) {
                foreach ($journalEvidence[$row->id] ?? [] as $id) {
                    $source = $sourceMap[$id] ?? null;
                    if (($source['kind'] ?? null) === 'statement') {
                        $candidates[] = ['lineId' => null, 'revisionId' => $id, 'payload' => [], 'closingDate' => $source['closingDate'], 'previousClosingDate' => $source['rawPayload']['period']['previous_closing_date'] ?? null, 'ordinal' => array_search($id, array_column($sources, 'id'), true)];
                    }
                }
            }
            usort($candidates, fn ($a, $b) => ($b['ordinal'] <=> $a['ordinal']) ?: strcmp($a['lineId'], $b['lineId']));
            if ($candidates !== []) {
                $journalSources[$row->id] = $candidates[0];
            }
        }
        $purchases = $this->latest('purchase_versions', 'purchase_id');
        $billings = $this->payloads('billings');
        $obligations = array_column($this->payloads('opening_obligations'), null, 'id');
        $credits = $this->payloads('linked_credits');
        $originalCredits = array_column($credits, 'journalId');
        $creditIds = [];
        foreach ($credits as $credit) {
            $replacement = $repository->query('credit_revisions')->where('credit_id', $credit['id'])->orderByDesc('purchase_version')->value('replacement_journal_id');
            $creditIds[] = $replacement ?? $credit['journalId'];
        }
        foreach ($journals as $journal) {
            if ($journal['kind'] === 'credit' && ! in_array($journal['id'], $originalCredits, true)) {
                $creditIds[] = $journal['id'];
            }
        }
        foreach ($repository->query('source_purchase_identities')->get() as $identity) {
            $purchase = array_values(array_filter($purchases, fn ($row) => $row['purchaseId'] === $identity->purchase_id))[0] ?? null;
            if ($purchase === null || isset($journalSources[$purchase['journalId']]) || ! isset($lineMap[$identity->source_line_id])) {
                continue;
            }
            $line = $lineMap[$identity->source_line_id];
            $source = $sourceMap[$line['revisionId']];
            if ($source['kind'] === 'statement' && $source['admission'] === 'accepted') {
                $journalSources[$purchase['journalId']] = ['lineId' => $line['id'], 'revisionId' => $source['id'], 'payload' => $line['payload'], 'closingDate' => $source['closingDate'], 'previousClosingDate' => $source['rawPayload']['period']['previous_closing_date'] ?? null];
            }
        }
        $facts = (new FinancialFacts)->project(['journals' => $journals, 'accounts' => $accounts, 'journalSources' => $journalSources, 'purchases' => $purchases, 'billings' => $billings, 'openingObligations' => $obligations, 'creditJournalIds' => array_values(array_unique($creditIds))]);
        $this->appendObservations($facts, $statementRows, $lines);
        $service = new ReceiptService($repository, app(DocumentStore::class));
        $historical = (new HistoricalAssociations($service))->current();
        $this->appendHistorical($facts, $statementRows, $lines, $journals, $service, $historical);
        $products = new ReceiptProducts($repository);
        $financial = (new ReceiptReconciliation($service))->active();
        $receiptFacts = ['receipts' => [], 'items' => [], 'rawItems' => []];
        $allocations = [];
        foreach ($service->currentReceipts() as $receipt) {
            if ($receipt['admission'] !== 'accepted') {
                continue;
            }$id = $receipt['receiptId'];
            $parsed = $receipt['parsed'];
            $receiptFacts['receipts'][] = ['id' => $id, 'date' => $receipt['date'], 'time' => $parsed['header']['time'] ?? null, 'subtotalCents' => $parsed['footer']['subtotalCents'], 'discountsCents' => $parsed['footer']['discountsCents'], 'totalCents' => $receipt['totalMinor']];
            $link = array_values(array_filter($financial, fn ($row) => $row['receiptId'] === $id))[0] ?? null;
            $allocated = array_column($link['itemAllocations'] ?? [], null, 'sourceLineId');
            foreach ($lines as $line) {
                if ($line['revisionId'] !== $receipt['revisionId']) {
                    continue;
                }$item = $line['payload'];
                $discount = FinancialFacts::minor(array_sum(array_column($item['discounts'], 'amountCents')));
                $tags = array_column($item['discounts'], 'tag');
                $raw = ['sourceLineId' => $line['id'], 'receiptId' => $id, 'qtyMilli' => $item['qtyMilli'], 'grossCents' => $item['lineTotalCents'], 'discountCents' => $discount, 'hasM' => in_array('M', $tags, true), 'hasA' => in_array('A', $tags, true)];
                $receiptFacts['rawItems'][] = $raw;
                $match = $products->latest('product_match_revisions', 'id', $line['id']);
                $product = $match === null ? null : $products->product($match['productId']);
                $reviewed = ($match['reviewed'] ?? false) && ($product['reviewed'] ?? false) && $product['redirectId'] === null;
                if ($reviewed) {
                    $receiptFacts['items'][] = ['receiptId' => $id, 'productId' => (int) $product['id'], 'productName' => $product['name'], 'category' => $product['category'], 'unit' => $product['unit'], 'qtyMilli' => $item['qtyMilli'], 'grossCents' => $item['lineTotalCents'], 'discountCents' => $discount, 'hasM' => $raw['hasM'], 'hasA' => $raw['hasA']];
                }
                $allocation = $allocated[$line['id']] ?? null;
                $allocations[] = ['receiptId' => $id, 'itemId' => $line['id'], 'accountId' => $allocation['accountId'] ?? null, 'purposeId' => $allocation['purposeId'] ?? null, 'netMinor' => FinancialFacts::minor($item['lineTotalCents'] + $discount), 'reviewed' => $reviewed];
            }
        }
        usort($receiptFacts['receipts'], fn ($a, $b) => strcmp($a['date'], $b['date']) ?: strcmp($a['time'] ?? '', $b['time'] ?? '') ?: ($a['id'] <=> $b['id']));
        foreach ($facts as &$fact) {
            $fact['receiptIds'] = array_values(array_unique(array_column(array_filter($financial, fn ($link) => $link['purchaseId'] !== null && $link['purchaseId'] === $fact['purchaseId']), 'receiptId')));
            foreach ($historical as $link) {
                if ($link['sourceLineId'] === $fact['sourceLineId']) {
                    $fact['receiptIds'][] = $link['receiptId'];
                }
            }if ($fact['receiptIds'] !== [] && $fact['merchant'] === null) {
                $fact['merchant'] = 'COTO';
                $fact['description'] = 'COTO';
                $fact['coverage'] = 'complete';
            }
        }unset($fact);
        $reviews = $repository->query('review_events')->orderBy('ordinal')->get()->map(fn ($row) => ['id' => $row->id, 'subjectId' => $row->subject_id, 'priorDecisionId' => $row->prior_decision_id, 'code' => $row->code, 'params' => json_decode($row->params), 'sourceLineIds' => json_decode($row->source_line_ids, true), 'state' => $row->state, 'recordedAt' => $row->recorded_at])->all();
        foreach ($reviews as $event) {
            if ($event['code'] !== 'historical_source_classification' || $event['state'] !== 'reviewed') {
                continue;
            }foreach ($facts as &$fact) {
                if (($fact['origin'] ?? null) === 'historical_acquisition' && $fact['sourceLineId'] === $event['subjectId']) {
                    $fact['accountId'] = $event['params']->accountId;
                    $fact['purposeId'] = $event['params']->purposeId;
                }
            }unset($fact);
        }
        usort($facts, fn ($a, $b) => strcmp($a['effectiveDate'], $b['effectiveDate']) ?: strcmp($a['id'], $b['id']));
        $months = [];
        foreach ($statementRows as $statement) {
            if ($statement['current']) {
                $months[] = $statement['cycleMonth'];
            }
        }foreach ($facts as $fact) {
            if ($fact['kind'] === 'purchase' && $fact['origin'] !== 'issuer_observation' || $fact['kind'] === 'credit' && $fact['origin'] === 'ledger' && $fact['purchaseId'] !== null) {
                $months[] = substr($fact['effectiveDate'], 0, 7);
            }
        }$months = array_values(array_unique($months));
        sort($months, SORT_STRING);
        $alertStates = [];
        $alertVersions = [];
        foreach ($repository->query('review_decisions')->where('kind', 'alert_state')->orderBy('seq')->get() as $decision) {
            $payload = json_decode($decision->payload, true);
            $alertStates[$decision->subject_id] = ['id' => $decision->subject_id, 'state' => $payload['input']['state'], ...($payload['source'] === null ? [] : ['source' => $payload['source']])];
            $alertVersions[$decision->subject_id] = $decision->id;
        }
        $groups = (new CatalogSettings($repository))->groups();

        return ['facts' => $facts, 'statements' => $statementRows, 'schedules' => $schedules, 'cards' => $cards, 'sources' => $sources, 'supermarket' => $receiptFacts, 'allocations' => $allocations, 'months' => $months, 'alertVersions' => $alertVersions, 'inspection' => ['accounts' => $accounts, 'groups' => $groups, 'cards' => $cards, 'sources' => $sources, 'sourceLines' => $lines, 'journals' => $journals, 'reviews' => $reviews, 'alertStates' => array_values($alertStates), 'historicalAssociations' => $historical]];
    }

    private function appendObservations(array &$facts, array $statements, array $lines): void
    {
        $current = array_column(array_filter($statements, fn ($row) => $row['current']), null, 'id');
        foreach ($lines as $line) {
            $statement = $current[$line['revisionId']] ?? null;
            if ($statement === null) {
                continue;
            }$payload = $line['payload'];
            foreach (['ars' => 'ARS', 'usd' => 'USD'] as $field => $currency) {
                if (($payload[$field] ?? 0) == 0) {
                    continue;
                }$minor = Money::source($payload[$field]);
                $payment = ($payload['section'] ?? null) === 'payments' && preg_match('/^(SU PAGO|PAGO RECIBIDO|PAGO DE RESUMEN|PAGO DE TARJETA|PAGO DEL RESUMEN|PAGO DE)\b/iu', $payload['description'] ?? '');
                $kind = match ($payload['section'] ?? null) {
                    'purchases' => $minor < 0 ? 'credit' : 'billing','taxes_and_charges' => 'cost','payments' => $payment ? 'payment' : ($minor < 0 ? 'credit' : null),default => null
                };
                if ($kind === null || array_filter($facts, fn ($fact) => $fact['sourceLineId'] === $line['id'] && $fact['currency'] === $currency && $fact['kind'] === $kind) !== []) {
                    continue;
                }
                $date = FinancialFacts::validDate($payload['date'] ?? null) ? $payload['date'] : $statement['closingDate'];
                $spend = in_array($kind, ['billing', 'credit'], true);
                $facts[] = ['id' => LedgerRepository::json(['issuer', $line['id'], $currency, $kind]), 'origin' => 'issuer_observation', 'sourceSection' => $payload['section'], 'purchaseId' => null, 'cardId' => $statement['cardId'], 'kind' => $kind, 'merchant' => isset($payload['description']) ? FinancialFacts::merchant($payload['description']) : null, 'description' => $payload['description'] ?? null, 'accountId' => $spend ? 'expense:unallocated' : null, 'purposeId' => $spend ? 'unallocated' : null, 'currency' => $currency, 'minor' => $kind === 'payment' ? abs($minor) : $minor, 'effectiveDate' => $kind === 'billing' ? $statement['closingDate'] : $date, 'purchaseDate' => FinancialFacts::validDate($payload['date'] ?? null) ? $payload['date'] : null, 'cycleMonth' => $statement['cycleMonth'], 'sourceLineId' => $line['id'], 'statementId' => $statement['id'], 'coverage' => 'uncertain', 'installmentNumber' => $payload['installment_number'] ?? null, 'installmentCount' => $payload['installment_count'] ?? null, 'financed' => ($payload['installment_count'] ?? 0) > 1];
            }
        }
    }

    private function appendHistorical(array &$facts, array $statements, array $lines, array $journals, ReceiptService $receipts, array $associations): void
    {
        $current = array_column(array_filter($statements, fn ($row) => $row['current']), null, 'id');
        foreach ($lines as $line) {
            $statement = $current[$line['revisionId']] ?? null;
            if ($statement === null) {
                continue;
            }$row = $line['payload'];
            $opening = null;
            foreach ($journals as $journal) {
                if ($journal['kind'] === 'opening' && $journal['cardId'] === $statement['cardId'] && ($opening === null || $journal['effectiveDate'] < $opening)) {
                    $opening = $journal['effectiveDate'];
                }
            }
            if ($opening === null || $statement['closingDate'] > $opening || ($row['section'] ?? null) !== 'purchases' || ! FinancialFacts::validDate($row['date'] ?? null) || $row['date'] > $opening || preg_match('/PLAN\s*[OÓ]VALO|ADELANTO|PR[EÉ]STAMO|EXTRACCI[OÓ]N|EFECTIVO/iu', $row['description'] ?? '')) {
                continue;
            }
            $values = array_filter(['ars', 'usd'], fn ($field) => ($row[$field] ?? 0) != 0);
            if (count($values) !== 1) {
                continue;
            }$field = array_values($values)[0];
            if ($row[$field] <= 0 || ($row['installment_number'] ?? 1) !== 1) {
                continue;
            }$count = $row['installment_count'] ?? 1;
            $association = array_values(array_filter($associations, fn ($link) => $link['sourceLineId'] === $line['id']))[0] ?? null;
            $receipt = $association === null ? null : $receipts->facts($association['receiptRevisionId']);
            if ($count > 1 && ($receipt === null || $field !== 'ars')) {
                continue;
            }
            if (array_filter($facts, fn ($fact) => $fact['sourceLineId'] === $line['id'] && $fact['currency'] === ($field === 'ars' ? 'ARS' : 'USD') && ($fact['kind'] === 'purchase' || $fact['purchaseId'] !== null)) !== []) {
                continue;
            }
            $facts[] = ['id' => $count > 1 ? 'historical-receipt-acquisition:'.$receipt['receiptId'] : 'historical-acquisition:'.$line['id'].':'.($field === 'ars' ? 'ARS' : 'USD'), 'purchaseId' => null, 'cardId' => $statement['cardId'], 'origin' => 'historical_acquisition', 'kind' => 'purchase', 'merchant' => FinancialFacts::merchant($row['description']), 'description' => $row['description'], 'accountId' => 'expense:unallocated', 'purposeId' => 'unallocated', 'currency' => $field === 'ars' ? 'ARS' : 'USD', 'minor' => $count > 1 ? $receipt['totalMinor'] : Money::source($row[$field]), 'effectiveDate' => $count > 1 ? $receipt['date'] : $row['date'], 'purchaseDate' => $count > 1 ? $receipt['date'] : $row['date'], 'cycleMonth' => $statement['cycleMonth'], 'sourceLineId' => $line['id'], 'statementId' => $statement['id'], 'receiptIds' => $association === null ? [] : [$association['receiptId']], 'coverage' => 'complete', 'financed' => $count > 1, 'installmentNumber' => $count > 1 ? 1 : null, 'installmentCount' => $count > 1 ? $count : null];
        }
    }
}
