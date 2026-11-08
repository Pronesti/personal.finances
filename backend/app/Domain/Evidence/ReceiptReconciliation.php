<?php

namespace App\Domain\Evidence;

use App\Domain\Ledger\AccountingError;
use App\Domain\Ledger\FinancialCommands;
use App\Domain\Ledger\LedgerRepository;
use App\Domain\Ledger\Money;
use App\Domain\Reviews\MerchantReviews;
use Brick\Math\BigInteger;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class ReceiptReconciliation
{
    private LedgerRepository $repository;

    public function __construct(private ReceiptService $receipts)
    {
        $this->repository = $receipts->repository;
    }

    private static function days(string $a, string $b): int
    {
        return (int) (abs(strtotime($a.'T00:00:00Z') - strtotime($b.'T00:00:00Z')) / 86400);
    }

    private static function retailer(string $description): bool
    {
        return (bool) preg_match('/(?:^|[^A-Z])COTO(?:[^A-Z]|$)/i', $description);
    }

    public function latest(int $receiptId): ?array
    {
        $row = $this->repository->query('receipt_link_decisions')->where('receipt_id', $receiptId)->orderByDesc('ordinal')->first();

        return $row === null ? null : $this->withRetainedAllocations([...json_decode($row->payload, true), 'id' => $row->id]);
    }

    /** Association-only decisions preserve the last explicit financial item split. */
    private function withRetainedAllocations(array $link): array
    {
        $current = $link;
        $seen = [];
        while ($current !== null && $link['purchaseId'] !== null && $current['purchaseId'] === $link['purchaseId'] && $current['receiptRevisionId'] === $link['receiptRevisionId'] && ! isset($seen[$current['id']])) {
            $seen[$current['id']] = true;
            if (($current['allocation'] ?? null) !== null || ($current['itemAllocations'] ?? []) !== []) {
                return [...$link, 'itemAllocations' => $current['itemAllocations'] ?? []];
            }
            $previous = $this->repository->query('receipt_link_decisions')->where('receipt_id', $link['receiptId'])->where('id', $current['previousDecisionId'])->first();
            $current = $previous === null ? null : [...json_decode($previous->payload, true), 'id' => $previous->id];
        }

        return [...$link, 'itemAllocations' => []];
    }

    private function latestDecisions(): array
    {
        $latest = [];
        foreach ($this->repository->query('receipt_link_decisions')->orderBy('ordinal')->get() as $row) {
            $latest[$row->receipt_id] = [...json_decode($row->payload, true), 'id' => $row->id];
        }

        return array_values($latest);
    }

    public function active(): array
    {
        return array_map(fn ($row) => $this->withRetainedAllocations($row), array_values(array_filter($this->latestDecisions(), fn ($row) => $row['action'] === 'link')));
    }

    private function candidates(array $receipt, ?string $card): array
    {
        $found = [];
        $query = $this->repository->query('source_purchase_identities')->where('currency', 'ARS');
        if ($card !== null) {
            $query->where('card_id', $card);
        }
        foreach ($query->get() as $identity) {
            if (self::days($identity->purchase_date, $receipt['date']) > 3) {
                continue;
            }
            $line = $this->repository->query('source_lines')->where('id', $identity->source_line_id)->first();
            $revision = $line === null ? null : $this->receipts->source($line->revision_id);
            $payload = $line === null ? null : json_decode($line->payload, true);
            if (($revision['kind'] ?? null) !== 'statement' || $revision['admission'] !== 'accepted' || ! self::retailer($payload['description'] ?? '')) {
                continue;
            }
            $purchase = $this->repository->purchase($identity->purchase_id);
            if ($purchase !== null) {
                $found[$purchase['purchaseId']] = $purchase;
            }
        }

        return array_values($found);
    }

    private function unposted(array $receipt, ?string $card): array
    {
        $rows = [];
        $sources = $this->repository->query('source_revisions')->where('kind', 'statement')->whereRaw("payload->>'admission'='accepted'");
        if ($card !== null) {
            $sources->where('card_id', $card);
        }
        foreach ($sources->get() as $source) {
            $revision = json_decode($source->payload, true);
            foreach ($this->repository->query('source_lines')->where('revision_id', $source->id)->orderBy('occurrence')->get() as $line) {
                $row = json_decode($line->payload, true);
                if ($this->repository->query('source_purchase_identities')->where('source_line_id', $line->id)->exists() || ($row['section'] ?? null) !== 'purchases' || ! isset($row['date']) || self::days($row['date'], $receipt['date']) > 3 || ! self::retailer($row['description'] ?? '') || ($row['ars'] ?? 0) <= 0 || ($row['usd'] ?? 0) != 0) {
                    continue;
                }
                $count = $row['installment_count'] ?? 1;
                if (! is_int($count) || $count < 1 || $count > 9007199254740991) {
                    continue;
                }
                $difference = BigInteger::of(Money::source($row['ars']))->multipliedBy($count)->minus($receipt['totalMinor'])->abs();
                $tolerance = BigInteger::of($count)->multipliedBy($count - 1);
                if ($difference->isGreaterThan($tolerance)) {
                    continue;
                }
                $rows[] = ['lineId' => $line->id, 'revisionId' => $source->id, 'cardId' => $source->card_id, 'closingDate' => $revision['rawPayload']['period']['closing_date'], 'line' => $row];
            }
        }
        $ambiguous = count($rows) > 1 && (count(array_unique(array_column($rows, 'cardId'))) !== 1 || count(array_unique(array_column($rows, 'revisionId'))) !== count($rows));
        if (count($rows) > 1) {
            $identities = [];
            $positions = [];
            foreach ($rows as $row) {
                $line = $row['line'];
                if (! isset($line['voucher']) || trim($line['voucher']) === '') {
                    $ambiguous = true;
                }
                $identities[] = LedgerRepository::json([$line['voucher'] ?? null, $line['date'], $line['installment_count'] ?? null]);
                $positions[] = $line['installment_number'] ?? null;
            }
            $ambiguous = $ambiguous || count(array_unique($identities)) !== 1 || count(array_unique($positions)) !== count($rows);
        }

        return ['rows' => $rows, 'ambiguous' => $ambiguous];
    }

    private function requiresPaymentVerification(?array $link, int $receiptId): bool
    {
        return ($link['action'] ?? null) === 'unlink' || (($link['purchaseId'] ?? null) === 'receipt-purchase:'.$receiptId && ! ($link['paymentVerified'] ?? false));
    }

    private function allocations(array $receipt, array $input): ?array
    {
        $items = $input['itemAllocations'] ?? [];
        if ($items !== [] && ($input['allocation'] ?? null) !== null) {
            throw new AccountingError('conflicting_receipt_allocations');
        }
        $products = new ReceiptProducts($this->repository);
        $verify = function (string $id, int $minor) use ($products): void {
            $match = $products->latest('product_match_revisions', 'id', $id);
            if ($match === null || ! $match['reviewed']) {
                throw new AccountingError('product_identity_unreviewed');
            }
            $product = $products->product($match['productId']);
            if (! $product['reviewed'] || $product['redirectId'] !== null) {
                throw new AccountingError('product_identity_unreviewed');
            }
            Money::minor($minor);
        };
        $allocation = $input['allocation'] ?? null;
        if ($items !== []) {
            $seen = [];
            $covered = 0;
            foreach ($items as $row) {
                $index = null;
                foreach ($receipt['parsed']['items'] as $i => $item) {
                    if (SourceIdentity::line($receipt['revisionId'], $i + 1) === $row['sourceLineId']) {
                        $index = $i;
                        break;
                    }
                }
                if ($index === null || isset($seen[$row['sourceLineId']])) {
                    throw new AccountingError('invalid_receipt_item_allocation');
                }
                $verify($row['sourceLineId'], $row['minor']);
                $seen[$row['sourceLineId']] = true;
                $item = $receipt['parsed']['items'][$index];
                $net = $item['lineTotalCents'] + array_sum(array_column($item['discounts'], 'amountCents'));
                if ($row['minor'] !== $net || $row['minor'] === 0) {
                    throw new AccountingError('receipt_item_allocation_mismatch');
                }
                $covered = Money::minor($covered + $row['minor']);
            }
            if ($covered > $receipt['totalMinor']) {
                throw new AccountingError('allocation_mismatch');
            }
            $allocation = $items;
            if ($covered < $receipt['totalMinor']) {
                $allocation[] = ['accountId' => 'expense:unallocated', 'purposeId' => 'unallocated', 'minor' => $receipt['totalMinor'] - $covered];
            }
        } elseif ($allocation !== null) {
            $clearing = count($allocation) === 1 && ($allocation[0]['accountId'] ?? null) === 'expense:unallocated' && ($allocation[0]['purposeId'] ?? null) === 'unallocated' && ($allocation[0]['minor'] ?? null) === $receipt['totalMinor'];
            if (! $clearing) {
                foreach ($receipt['parsed']['items'] as $index => $item) {
                    $verify(SourceIdentity::line($receipt['revisionId'], $index + 1), $item['lineTotalCents']);
                }
            }
        } else {
            return null;
        }
        $sum = 0;
        $combined = [];
        foreach ($allocation as $row) {
            if (Money::minor($row['minor']) === 0) {
                throw new AccountingError('allocation_mismatch');
            }
            $account = $this->repository->query('accounts')->where('id', $row['accountId'])->first();
            if ($account === null || ! $account->posting || ! $account->enabled || ! in_array($account->type, ['expense', 'asset'], true) || ($account->currency !== null && $account->currency !== 'ARS') || $this->repository->query('accounts')->where('parent_id', $account->id)->exists()) {
                throw new AccountingError('invalid_posting_account');
            }
            if ($account->primary_purpose_id !== null && $account->primary_purpose_id !== $row['purposeId']) {
                throw new AccountingError('invalid_primary_purpose');
            }
            $sum = Money::minor($sum + $row['minor']);
            $key = LedgerRepository::json([$row['accountId'], $row['purposeId']]);
            $combined[$key] = ['accountId' => $row['accountId'], 'purposeId' => $row['purposeId'], 'minor' => Money::minor(($combined[$key]['minor'] ?? 0) + $row['minor'])];
        }
        if ($sum !== $receipt['totalMinor']) {
            throw new AccountingError('allocation_mismatch');
        }

        return array_values($combined);
    }

    private function adoptStatements(array $rows, array $receipt, array $purchase, array $input, array &$result, callable $review): void
    {
        usort($rows, fn ($a, $b) => [$a['line']['installment_number'] ?? 1, $a['closingDate'], $a['lineId']] <=> [$b['line']['installment_number'] ?? 1, $b['closingDate'], $b['lineId']]);
        $commands = new FinancialCommands($this->repository);
        foreach ($rows as $observation) {
            $line = $observation['line'];
            $identity = ['sourceLineId' => $observation['lineId'], 'purchaseId' => $purchase['purchaseId'], 'cardId' => $input['cardId'], 'currency' => 'ARS', 'purchaseDate' => $line['date'], 'voucher' => $line['voucher'] ?? null, 'installment' => $line['installment_number'] ?? null, 'installmentCount' => $line['installment_count'] ?? null, 'amountMinor' => Money::source($line['ars'])];
            $candidates = $this->repository->query('source_purchase_identities')->where('card_id', $input['cardId'])->where('currency', 'ARS')->where('purchase_date', $line['date'])->get()->map(fn ($row) => json_decode($row->payload, true, flags: JSON_THROW_ON_ERROR))->all();
            $decision = SourceIdentity::identify($identity, $candidates);
            if ($decision['status'] === 'review') {
                $review($decision['reason']);

                continue;
            }
            if (($decision['status'] === 'matched' && $decision['purchaseId'] !== $purchase['purchaseId']) || ($decision['status'] === 'new' && $this->repository->query('source_purchase_identities')->where('purchase_id', $purchase['purchaseId'])->exists())) {
                $review('receipt_statement_identity_conflict');

                continue;
            }
            $billing = $commands->bill(['key' => 'receipt:'.$receipt['revisionId'].':adopt:'.$observation['lineId'], 'purchaseId' => $purchase['purchaseId'], 'cardId' => $input['cardId'], 'currency' => 'ARS', 'installment' => $line['installment_number'] ?? 1, 'amountMinor' => Money::source($line['ars']), 'effectiveDate' => $observation['closingDate'], 'recordedAt' => $input['recordedAt'], 'evidenceIds' => [$observation['lineId'], $receipt['revisionId']]]);
            if ($billing['status'] === 'review') {
                $review($billing['reviewCode']);

                continue;
            }
            if ($billing['status'] === 'posted') {
                array_push($result['postedJournalIds'], ...$billing['journalIds']);
            }
            $this->repository->insert('source_purchase_identities', ['source_line_id' => $observation['lineId'], 'currency' => 'ARS', 'purchase_id' => $purchase['purchaseId'], 'card_id' => $input['cardId'], 'purchase_date' => $line['date'], 'payload' => LedgerRepository::json($identity)], false);
            (new MerchantReviews($this->repository))->register($purchase['purchaseId'], $input['cardId'], $line['description'], $observation['lineId']);
            $history = $this->repository->query('review_events')->where('subject_id', $observation['revisionId'])->whereIn('code', ['receipt_purchase_unlinked', 'missing_supported_principal', 'missing_installment_history'])->get();
            foreach ($history as $event) {
                if ($event->state === 'open' && ! $history->contains(fn ($child) => $child->prior_decision_id === $event->id) && in_array($observation['lineId'], json_decode($event->source_line_ids, true), true)) {
                    $this->repository->insert('review_events', ['id' => Str::uuid()->toString(), 'subject_id' => $observation['revisionId'], 'prior_decision_id' => $event->id, 'code' => $event->code, 'params' => $event->params, 'source_line_ids' => $event->source_line_ids, 'state' => 'reviewed', 'recorded_at' => $input['recordedAt']]);
                }
            }
        }
    }

    public function reconcile(array $input): array
    {
        return $this->repository->transaction(function () use ($input) {
            $key = 'source:'.$input['receiptRevisionId'].':reconcile:'.$input['key'];
            $digest = FinancialCommands::digest($input);
            $saved = $this->repository->query('source_import_commands')->where('key', $key)->first();
            if ($saved !== null) {
                if ($saved->digest !== $digest) {
                    throw new AccountingError('command_conflict');
                }

                return [...json_decode($saved->result, true), 'postedJournalIds' => [], 'duplicate' => true];
            }
            $receipt = $this->receipts->facts($input['receiptRevisionId']);
            $source = $this->receipts->source($input['receiptRevisionId']);
            if ($receipt === null || ($source['admission'] ?? null) !== 'accepted' || ! ReceiptVerification::verify($receipt['parsed'])['ok'] || ! $receipt['date'] || $receipt['totalMinor'] === null) {
                throw new AccountingError('receipt_not_accepted');
            }
            $previous = $this->latest($receipt['receiptId']);
            if (array_key_exists('expectedPreviousDecisionId', $input) && $input['expectedPreviousDecisionId'] !== ($previous['id'] ?? null)) {
                throw new AccountingError('stale_receipt_link');
            }
            $needsPaymentVerification = $this->requiresPaymentVerification($previous, $receipt['receiptId']);
            if ($needsPaymentVerification && (! $input['paymentVerified'] || $input['cardId'] === null)) {
                throw new AccountingError('receipt_payment_unresolved');
            }
            $result = ['sourceRevisionId' => $receipt['revisionId'], 'purchaseIds' => [], 'postedJournalIds' => [], 'reviews' => [], 'duplicate' => false];
            $review = function (string $code, array $params = []) use (&$result): void {
                $result['reviews'][] = ['code' => $code, 'params' => (object) $params, 'sourceLineIds' => []];
            };
            $target = $input['purchaseId'] ?? (($previous['action'] ?? null) === 'link' ? $previous['purchaseId'] : 'receipt-purchase:'.$receipt['receiptId']);
            $target = $target === null ? null : $this->repository->purchase($target);
            if (($input['purchaseId'] ?? null) !== null && $target === null) {
                throw new AccountingError('missing_supported_purchase');
            }
            if ($target === null) {
                $nearby = $this->candidates($receipt, $input['cardId']);
                $candidates = array_values(array_filter($nearby, fn ($row) => $row['principalMinor'] === $receipt['totalMinor']));
                if (count($candidates) > 1) {
                    $review('multiple_receipt_candidates', ['count' => count($candidates)]);
                } elseif (count($candidates) === 1) {
                    $target = $candidates[0];
                } elseif ($nearby !== []) {
                    $review('receipt_amount_mismatch');
                }
            }
            $unposted = ($target === null || ($input['paymentVerified'] && $input['cardId'] !== null)) && $result['reviews'] === [] ? $this->unposted($receipt, $input['cardId']) : ['rows' => [], 'ambiguous' => false];
            if ($unposted['ambiguous']) {
                $review('multiple_statement_candidates', ['count' => count($unposted['rows'])]);
            }
            $historical = (new HistoricalAssociations($this->receipts))->latest($receipt['receiptId']);
            if (($historical['action'] ?? null) === 'link' && ! array_filter($unposted['rows'], fn ($row) => $row['lineId'] === $historical['sourceLineId'] && $row['cardId'] === $input['cardId'])) {
                $review('receipt_has_historical_association');
            }
            $allocation = $this->allocations($receipt, $input);
            if ($target !== null) {
                foreach ($this->active() as $link) {
                    if ($link['purchaseId'] === $target['purchaseId'] && $link['receiptId'] !== $receipt['receiptId']) {
                        $review('purchase_already_linked');
                        $target = null;
                        break;
                    }
                }
            }
            if ($target !== null && ($target['currency'] !== 'ARS' || $target['principalMinor'] !== $receipt['totalMinor'] || ($input['cardId'] !== null && $target['cardId'] !== $input['cardId']))) {
                $review('receipt_amount_or_card_mismatch');
                $target = null;
            }
            // Keep financial state and its allocation/link decision consistent on review.
            DB::statement('SAVEPOINT receipt_financial_work');
            $commands = new FinancialCommands($this->repository);
            $existingPurchase = $target !== null;
            if ($target === null && $result['reviews'] === []) {
                $opening = $input['cardId'] === null ? null : $this->repository->query('journals')->where('card_id', $input['cardId'])->where('currency', 'ARS')->where('kind', 'opening')->orderBy('effective_date')->value('effective_date');
                $header = $receipt['parsed']['header'];
                if ($opening !== null && $receipt['date'] <= $opening) {
                    $review('historical_receipt_requires_opening_reconciliation', ['openingDate' => $opening]);
                } elseif (! $input['paymentVerified'] || $input['cardId'] === null || ! $header['paymentMethod'] || $header['paymentCents'] !== $receipt['totalMinor']) {
                    $review('receipt_payment_unresolved');
                } elseif (! $this->repository->query('accounts')->where('id', $input['cardId'].':ARS:unbilled')->exists()) {
                    $review('unknown_card');
                } else {
                    $id = 'receipt-purchase:'.$receipt['receiptId'];
                    $posted = $commands->purchase(['key' => 'receipt-entity:'.$receipt['receiptId'].':purchase', 'purchaseId' => $id, 'cardId' => $input['cardId'], 'currency' => 'ARS', 'effectiveDate' => $receipt['date'], 'recordedAt' => $input['recordedAt'], 'evidenceIds' => [$receipt['revisionId']], 'principalMinor' => $receipt['totalMinor'], 'allocations' => $allocation ?? [['accountId' => 'expense:unallocated', 'purposeId' => 'unallocated', 'minor' => $receipt['totalMinor']]]]);
                    if ($posted['status'] === 'review') {
                        $review($posted['reviewCode']);
                    } else {
                        $result['postedJournalIds'] = $posted['status'] === 'posted' ? $posted['journalIds'] : [];
                        $target = $this->repository->purchase($id);
                    }
                }
            }
            if ($target !== null && $result['reviews'] === []) {
                if (($existingPurchase && $allocation !== null && ! isset($input['expectedPurchaseVersion'])) || (isset($input['expectedPurchaseVersion']) && $target['version'] !== $input['expectedPurchaseVersion'])) {
                    throw new AccountingError('stale_purchase_version');
                }
                $this->adoptStatements($unposted['rows'], $receipt, $target, $input, $result, $review);
                if ($allocation !== null && $allocation !== $target['allocations']) {
                    $post = $commands->correct(['key' => 'receipt:'.$receipt['revisionId'].':allocation:'.$input['key'], 'cardId' => $target['cardId'], 'purchaseId' => $target['purchaseId'], 'expectedVersion' => $target['version'], 'replacement' => [...$target, 'allocations' => $allocation, 'evidenceIds' => array_values(array_unique([...$target['evidenceIds'], $receipt['revisionId']]))], 'recordedAt' => $input['recordedAt'], 'reason' => 'reviewed receipt item allocation']);
                    if ($post['status'] === 'review') {
                        $review($post['reviewCode']);
                    } elseif ($post['status'] === 'posted') {
                        array_push($result['postedJournalIds'], ...$post['journalIds']);
                    }
                }
                if ($result['reviews'] === []) {
                    $retainedItems = ($input['allocation'] ?? null) === null && ($previous['purchaseId'] ?? null) === $target['purchaseId'] && ($previous['receiptRevisionId'] ?? null) === $receipt['revisionId'] ? ($previous['itemAllocations'] ?? []) : [];
                    $link = ['id' => Str::uuid()->toString(), 'key' => $key, 'receiptId' => $receipt['receiptId'], 'receiptRevisionId' => $receipt['revisionId'], 'purchaseId' => $target['purchaseId'], 'cardId' => $target['cardId'], 'paymentVerified' => $input['paymentVerified'] || (($previous['purchaseId'] ?? null) === $target['purchaseId'] && ($previous['paymentVerified'] ?? false)), 'action' => 'link', 'recordedAt' => $input['recordedAt'], 'previousDecisionId' => $previous['id'] ?? null, 'allocation' => $allocation, 'itemAllocations' => $input['itemAllocations'] ?? $retainedItems];
                    $this->appendLink($link);
                    $result['purchaseIds'][] = $target['purchaseId'];
                    $history = $this->repository->query('review_events')->where('subject_id', $receipt['revisionId'])->get();
                    foreach ($history as $event) {
                        $resolved = in_array($event->code, ['receipt_payment_unresolved', 'multiple_receipt_candidates', 'receipt_amount_mismatch', 'multiple_statement_candidates', 'purchase_already_linked', 'receipt_amount_or_card_mismatch', 'unknown_card'], true) || ($event->code === 'missing_installment_history' && $input['paymentVerified'] && $input['cardId'] !== null);
                        if ($resolved && $event->state === 'open' && ! $history->contains(fn ($child) => $child->prior_decision_id === $event->id)) {
                            $this->repository->insert('review_events', ['id' => Str::uuid()->toString(), 'subject_id' => $receipt['revisionId'], 'prior_decision_id' => $event->id, 'code' => $event->code, 'params' => $event->params, 'source_line_ids' => $event->source_line_ids, 'state' => 'reviewed', 'recorded_at' => $input['recordedAt']]);
                        }
                    }
                }
            }
            if ($result['reviews'] !== []) {
                DB::statement('ROLLBACK TO SAVEPOINT receipt_financial_work');
                $result['purchaseIds'] = [];
                $result['postedJournalIds'] = [];
            }
            DB::statement('RELEASE SAVEPOINT receipt_financial_work');
            foreach ($result['reviews'] as $event) {
                $this->receipts->appendReview($receipt['revisionId'], $event['code'], $input['recordedAt'], (array) $event['params']);
            }
            $this->repository->insert('source_import_commands', ['key' => $key, 'digest' => $digest, 'result' => LedgerRepository::json($result)]);

            return $result;
        });
    }

    private function appendLink(array $link): void
    {
        $this->repository->insert('receipt_link_decisions', ['id' => $link['id'], 'key' => $link['key'], 'receipt_id' => $link['receiptId'], 'receipt_revision_id' => $link['receiptRevisionId'], 'purchase_id' => $link['purchaseId'], 'card_id' => $link['cardId'], 'action' => $link['action'], 'previous_decision_id' => $link['previousDecisionId'], 'recorded_at' => $link['recordedAt'], 'payload' => LedgerRepository::json($link)]);
    }

    public function unlink(array $input): void
    {
        $this->repository->transaction(function () use ($input): void {
            $receipt = $this->receipts->facts($input['receiptRevisionId']);
            if ($receipt === null) {
                throw new AccountingError('missing_receipt_facts');
            }
            $key = 'source:'.$receipt['revisionId'].':unlink:'.$input['key'];
            $saved = $this->repository->query('source_import_commands')->where('key', $key)->first();
            $digest = FinancialCommands::digest($input);
            if ($saved !== null) {
                if ($saved->digest !== $digest) {
                    throw new AccountingError('command_conflict');
                }

                return;
            }
            $previous = $this->latest($receipt['receiptId']);
            if (($input['expectedPreviousDecisionId'] ?? null) !== ($previous['id'] ?? null)) {
                throw new AccountingError('stale_receipt_link');
            }
            $this->appendLink(['id' => Str::uuid()->toString(), 'key' => $key, 'receiptId' => $receipt['receiptId'], 'receiptRevisionId' => $receipt['revisionId'], 'purchaseId' => $previous['purchaseId'] ?? null, 'cardId' => $previous['cardId'] ?? null, 'paymentVerified' => false, 'action' => 'unlink', 'recordedAt' => $input['recordedAt'], 'previousDecisionId' => $previous['id'] ?? null, 'allocation' => null, 'itemAllocations' => []]);
            $this->repository->insert('source_import_commands', ['key' => $key, 'digest' => $digest, 'result' => '{}']);
        });
    }

    public function statementOrigin(array $input): array
    {
        if ($input['currency'] !== 'ARS' || ! self::retailer($input['description'])) {
            return ['purchaseId' => null, 'reviewCode' => null];
        }
        $candidates = [];
        $unlinked = false;
        foreach ($this->latestDecisions() as $link) {
            $detached = $this->requiresPaymentVerification($link, $link['receiptId']);
            if ($link['cardId'] !== $input['cardId'] || (! $detached && ! $link['paymentVerified']) || ($detached && $link['purchaseId'] !== 'receipt-purchase:'.$link['receiptId'])) {
                continue;
            }
            if ($this->repository->query('source_purchase_identities')->where('purchase_id', $link['purchaseId'])->exists()) {
                continue;
            }
            $receipt = $this->receipts->facts($link['receiptRevisionId']);
            if (! $receipt || self::days($receipt['date'], $input['date']) > 3) {
                continue;
            }
            $count = $input['installmentCount'] ?? 1;
            if (! is_int($count) || $count < 1 || $count > 9007199254740991) {
                continue;
            }
            if (BigInteger::of($input['amountMinor'])->multipliedBy($count)->minus($receipt['totalMinor'])->abs()->isGreaterThan(BigInteger::of($count)->multipliedBy($count - 1))) {
                continue;
            }
            $purchase = $this->repository->purchase($link['purchaseId']);
            if ($purchase === null || $purchase['principalMinor'] !== $receipt['totalMinor'] || ! in_array($receipt['revisionId'], $purchase['evidenceIds'], true)) {
                continue;
            }
            $candidates[$purchase['purchaseId']] = true;
            $unlinked = $unlinked || $detached;
        }

        if ($unlinked) {
            return ['purchaseId' => null, 'reviewCode' => 'receipt_purchase_unlinked'];
        }

        return ['purchaseId' => count($candidates) === 1 ? array_key_first($candidates) : null, 'reviewCode' => count($candidates) > 1 ? 'multiple_receipt_candidates' : null];
    }

    public function reconcileAll(string $key, string $recordedAt): array
    {
        $results = [];
        foreach ($this->receipts->currentReceipts() as $receipt) {
            if ($receipt['admission'] !== 'accepted' || $this->requiresPaymentVerification($this->latest($receipt['receiptId']), $receipt['receiptId'])) {
                continue;
            }
            $results[] = $this->reconcile(['key' => $key, 'receiptRevisionId' => $receipt['revisionId'], 'cardId' => null, 'paymentVerified' => false, 'purchaseId' => null, 'allocation' => null, 'recordedAt' => $recordedAt]);
        }

        return $results;
    }
}
