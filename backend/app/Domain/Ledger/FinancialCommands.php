<?php

namespace App\Domain\Ledger;

use Illuminate\Support\Str;

class FinancialCommands
{
    public function __construct(private LedgerRepository $repository) {}

    public static function digest(array $input): string
    {
        $canonical = function ($value) use (&$canonical) {
            if (! is_array($value)) {
                return $value;
            }
            if (! array_is_list($value)) {
                unset($value['recordedAt']);
                ksort($value, SORT_STRING);
            }

            return array_map($canonical, $value);
        };

        return hash('sha256', LedgerRepository::json($canonical($input)));
    }

    private static function key(string $card, string $key): string
    {
        if (trim($key) === '' || trim($card) === '') {
            throw new AccountingError('invalid_identity');
        }

        return 'card:'.rawurlencode($card).':'.rawurlencode($key);
    }

    private static function posted(string ...$ids): array
    {
        return ['status' => 'posted', 'journalIds' => $ids, 'reviewCode' => null];
    }

    private static function review(string $code): array
    {
        return ['status' => 'review', 'journalIds' => [], 'reviewCode' => $code];
    }

    private function command(array $input, callable $work): array
    {
        return $this->repository->transaction(function () use ($input, $work) {
            $key = self::key($input['cardId'], $input['key']);
            if (! $this->repository->query('cards')->where('id', $input['cardId'])->exists()) {
                throw new AccountingError('unknown_card');
            }
            $digest = self::digest($input);
            $saved = $this->repository->query('commands')->where('key', $key)->first();
            if ($saved !== null) {
                if (! hash_equals($saved->digest, $digest)) {
                    throw new AccountingError('command_conflict');
                }
                $result = json_decode($saved->result, true, flags: JSON_THROW_ON_ERROR);
                $result['status'] = $result['status'] === 'review' ? 'review' : 'duplicate';

                return $result;
            }
            $result = $work($key);
            $this->repository->insert('commands', ['key' => $key, 'card_id' => $input['cardId'], 'digest' => $digest, 'result' => LedgerRepository::json($result)]);

            return $result;
        });
    }

    private static function validDate(string $date): bool
    {
        if (! preg_match('/^\d{4}-\d{2}-\d{2}$/D', $date)) {
            return false;
        }

        return checkdate((int) substr($date, 5, 2), (int) substr($date, 8, 2), (int) substr($date, 0, 4));
    }

    private function validateJournal(array $journal): void
    {
        foreach (['id', 'commandKey', 'cardId'] as $key) {
            if (! is_string($journal[$key]) || trim($journal[$key]) === '') {
                throw new AccountingError('invalid_identity');
            }
        }
        if (! in_array($journal['currency'], ['ARS', 'USD'], true)) {
            throw new AccountingError('invalid_currency');
        }
        if (! self::validDate($journal['effectiveDate']) || ! self::validDate(substr($journal['recordedAt'], 0, 10)) || ! preg_match('/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/D', $journal['recordedAt']) || strtotime($journal['recordedAt']) === false) {
            throw new AccountingError('invalid_date');
        }
        if (! in_array($journal['kind'], ['purchase', 'billing', 'repayment', 'credit', 'cost', 'opening', 'reversal', 'replacement'], true)) {
            throw new AccountingError('invalid_journal_kind');
        }
        if ($journal['evidenceIds'] === [] || count(array_unique($journal['evidenceIds'])) !== count($journal['evidenceIds'])) {
            throw new AccountingError('missing_evidence');
        }
        foreach ($journal['evidenceIds'] as $id) {
            if (trim($id) === '' || ! $this->repository->query('evidence')->where('id', $id)->exists()) {
                throw new AccountingError('missing_evidence');
            }
        }
        $debit = 0;
        $credit = 0;
        foreach ($journal['lines'] as $line) {
            $debit = Money::minor($debit + Money::minor($line['debitMinor']));
            $credit = Money::minor($credit + Money::minor($line['creditMinor']));
            if (trim($line['accountId']) === '' || ($line['debitMinor'] > 0) === ($line['creditMinor'] > 0)) {
                throw new AccountingError('invalid_journal_line');
            }
            $account = $this->repository->query('accounts')->where('id', $line['accountId'])->first();
            if ($account === null || ! $account->enabled || ! $account->posting || $this->repository->query('accounts')->where('parent_id', $account->id)->exists()) {
                throw new AccountingError('invalid_posting_account');
            }
            if ($account->currency !== null && $account->currency !== $journal['currency']) {
                throw new AccountingError('account_currency_mismatch');
            }
        }
        if (count($journal['lines']) < 2 || $debit === 0 || $debit !== $credit) {
            throw new AccountingError('unbalanced_journal');
        }
    }

    private function append(array $journal): void
    {
        $this->validateJournal($journal);
        $this->repository->appendJournal($journal);
    }

    private static function line(string $account, int $debit, int $credit, ?string $purchase = null, ?string $purpose = null): array
    {
        return ['accountId' => $account, 'debitMinor' => $debit, 'creditMinor' => $credit, 'purchaseId' => $purchase, 'purposeId' => $purpose];
    }

    private static function header(array $input, string $kind, array $lines): array
    {
        return ['id' => Str::uuid()->toString(), 'commandKey' => self::key($input['cardId'], $input['key']), 'cardId' => $input['cardId'], 'currency' => $input['currency'], 'effectiveDate' => $input['effectiveDate'], 'recordedAt' => $input['recordedAt'], 'evidenceIds' => $input['evidenceIds'], 'kind' => $kind, 'reversesId' => null, 'lines' => $lines];
    }

    private static function purchaseLines(array $input): array
    {
        if (trim($input['purchaseId']) === '' || $input['allocations'] === [] || Money::minor($input['principalMinor']) === 0) {
            throw new AccountingError('invalid_purchase');
        }
        $sum = 0;
        $lines = [];
        foreach ($input['allocations'] as $allocation) {
            if (trim($allocation['purposeId']) === '' || trim($allocation['accountId']) === '' || Money::minor($allocation['minor']) === 0) {
                throw new AccountingError('invalid_allocation');
            }
            $sum = Money::minor($sum + $allocation['minor']);
            $lines[] = self::line($allocation['accountId'], $allocation['minor'], 0, $input['purchaseId'], $allocation['purposeId']);
        }
        if ($sum !== $input['principalMinor']) {
            throw new AccountingError('allocation_mismatch');
        }
        $lines[] = self::line($input['cardId'].':'.$input['currency'].':unbilled', 0, $input['principalMinor'], $input['purchaseId']);

        return $lines;
    }

    private function supportedAllocations(array $input): bool
    {
        foreach ($input['allocations'] as $allocation) {
            $account = $this->repository->query('accounts')->where('id', $allocation['accountId'])->first();
            if ($account !== null && ! in_array($account->type, ['expense', 'asset'], true)) {
                return false;
            }
        }

        return true;
    }

    public function purchase(array $input): array
    {
        $lines = self::purchaseLines($input);

        return $this->command($input, function () use ($input, $lines) {
            if ($this->repository->purchase($input['purchaseId']) !== null) {
                return self::review('purchase_already_recorded');
            }
            if (! $this->supportedAllocations($input)) {
                return self::review('unsupported_financial_nature');
            }
            $journal = self::header($input, 'purchase', $lines);
            $this->append($journal);
            $this->repository->appendPurchase([...$input, 'version' => 1, 'journalId' => $journal['id']]);

            return self::posted($journal['id']);
        });
    }

    public function bill(array $input): array
    {
        if (! is_int($input['installment']) || $input['installment'] < 1 || Money::minor($input['amountMinor']) === 0) {
            throw new AccountingError('invalid_billing');
        }

        return $this->command($input, function () use ($input) {
            $purchase = $this->repository->purchase($input['purchaseId']);
            if ($purchase === null || $purchase['cardId'] !== $input['cardId'] || $purchase['currency'] !== $input['currency']) {
                return self::review('missing_supported_purchase');
            }
            if ($input['effectiveDate'] < $purchase['effectiveDate']) {
                return self::review('billing_before_purchase');
            }
            $billings = $this->repository->payloads('billings', ['purchase_id' => $input['purchaseId']]);
            foreach ($billings as $billing) {
                if ($billing['installment'] === $input['installment']) {
                    return $billing['amountMinor'] === $input['amountMinor'] && $billing['effectiveDate'] === $input['effectiveDate'] ? ['status' => 'duplicate', 'journalIds' => [$billing['journalId']], 'reviewCode' => null] : self::review('conflicting_installment');
                }
            }
            $credits = array_values(array_filter($this->repository->state($input['cardId'], $input['currency'])['credits'], fn ($credit) => $credit['purchaseId'] === $input['purchaseId']));
            if (Money::minor(array_sum(array_column($billings, 'amountMinor')) + $input['amountMinor'] + array_sum(array_column($credits, 'unbilledReductionMinor'))) > $purchase['principalMinor']) {
                return self::review('billing_exceeds_principal');
            }
            $this->appendBilling($input, $purchase['allocations'], $purchase['effectiveDate']);
            $this->repository->replay($input['cardId'], $input['currency']);
            $latest = $this->repository->query('billings')->where('purchase_id', $input['purchaseId'])->where('installment', $input['installment'])->first();

            return self::posted($latest->journal_id);
        });
    }

    private function appendBilling(array $input, array $allocations, string $purchaseDate, ?string $opening = null): string
    {
        $purchase = $input['purchaseId'] ?? null;
        $journal = self::header($input, 'billing', [self::line($input['cardId'].':'.$input['currency'].':unbilled', $input['amountMinor'], 0, $purchase), self::line($input['cardId'].':'.$input['currency'].':billed', 0, $input['amountMinor'], $purchase)]);
        $shares = Money::split($input['amountMinor'], array_column($allocations, 'minor'));
        $components = [];
        foreach ($allocations as $index => $allocation) {
            if ($shares[$index] > 0) {
                $components[] = ['id' => $journal['id'].':'.$index, 'purposeId' => $allocation['purposeId'], 'minor' => $shares[$index]];
            }
        }
        $this->append($journal);
        $billing = ['id' => $journal['id'], 'purchaseId' => $purchase, 'cardId' => $input['cardId'], 'currency' => $input['currency'], 'installment' => $input['installment'], 'amountMinor' => $input['amountMinor'], 'effectiveDate' => $input['effectiveDate'], 'purchaseDate' => $purchaseDate, 'journalId' => $journal['id'], 'components' => $components];
        if ($opening !== null) {
            $billing['origin'] = 'opening_installment';
            $billing['openingObligationId'] = $opening;
        }
        $this->repository->appendBilling($billing);

        return $journal['id'];
    }

    public function repay(array $input): array
    {
        if (Money::minor($input['amountMinor']) === 0) {
            throw new AccountingError('invalid_payment');
        }

        return $this->command($input, function () use ($input) {
            $journal = self::header($input, 'repayment', [self::line($input['cardId'].':'.$input['currency'].':billed', $input['amountMinor'], 0), self::line('clearing:'.$input['currency'].':unresolved-source', 0, $input['amountMinor'])]);
            $payment = [...$input, 'id' => $journal['id'], 'journalId' => $journal['id'], 'unappliedMinor' => $input['amountMinor']];
            $state = $this->repository->state($input['cardId'], $input['currency']);
            $state['payments'][] = $payment;
            $decisions = Attribution::replay($state);
            $decision = array_values(array_filter($decisions, fn ($row) => $row['paymentId'] === $payment['id']))[0];
            $payment['unappliedMinor'] = $decision['unappliedMinor'];
            $this->append($journal);
            $this->repository->insert('payments', ['id' => $payment['id'], 'card_id' => $input['cardId'], 'currency' => $input['currency'], 'amount_minor' => $input['amountMinor'], 'journal_id' => $journal['id'], 'payload' => LedgerRepository::json($payment)]);
            $this->repository->replay($input['cardId'], $input['currency']);

            return self::posted($journal['id']);
        });
    }

    public function credit(array $input): array
    {
        if (Money::minor($input['amountMinor']) === 0 || Money::minor(Money::minor($input['billedReductionMinor']) + Money::minor($input['unbilledReductionMinor'])) !== $input['amountMinor']) {
            throw new AccountingError('invalid_credit_split');
        }

        return $this->command($input, function () use ($input) {
            $purchase = $this->repository->purchase($input['purchaseId']);
            if ($purchase === null || $purchase['cardId'] !== $input['cardId'] || $purchase['currency'] !== $input['currency']) {
                return self::review('missing_supported_purchase');
            }
            $state = $this->repository->state($input['cardId'], $input['currency']);
            $credits = array_values(array_filter($state['credits'], fn ($row) => $row['purchaseId'] === $input['purchaseId']));
            $billings = array_values(array_filter($state['billings'], fn ($row) => $row['purchaseId'] === $input['purchaseId']));
            $billed = array_sum(array_column($billings, 'amountMinor'));
            if (Money::minor(array_sum(array_column($credits, 'amountMinor')) + $input['amountMinor']) > $purchase['principalMinor'] || $input['billedReductionMinor'] > $billed - array_sum(array_column($credits, 'billedReductionMinor')) || $input['unbilledReductionMinor'] > $purchase['principalMinor'] - $billed - array_sum(array_column($credits, 'unbilledReductionMinor'))) {
                return self::review('unsupported_credit_schedule');
            }
            $weights = array_column($purchase['allocations'], 'minor');
            foreach ($credits as $credit) {
                foreach ($credit['allocationReductions'] as $reduction) {
                    $weights[$reduction['allocationIndex']] -= $reduction['minor'];
                }
            }
            $shares = Money::split($input['amountMinor'], $weights);
            $journal = self::header($input, 'credit', $this->creditLines($input, $purchase['allocations'], $shares));
            $components = array_values(array_filter(Attribution::outstanding($state['billings'], $state['attributions'], $state['credits'], $state['componentRevisions'], $state['attributionRevisions'], $state['payments']), fn ($row) => $row['purchaseId'] === $input['purchaseId']));
            $allocated = Attribution::oldest($input['billedReductionMinor'], $components);
            $credit = [...$input, 'id' => $journal['id'], 'journalId' => $journal['id'], 'allocationReductions' => array_map(fn ($minor, $index) => ['allocationIndex' => $index, 'minor' => $minor], $shares, array_keys($shares)), 'componentReductions' => array_map(fn ($row) => ['componentId' => $row['componentId'], 'minor' => $row['minor']], $allocated['assigned'])];
            $this->append($journal);
            $this->repository->insert('linked_credits', ['id' => $credit['id'], 'purchase_id' => $credit['purchaseId'], 'journal_id' => $journal['id'], 'amount_minor' => $credit['amountMinor'], 'payload' => LedgerRepository::json($credit)]);
            $this->repository->replay($input['cardId'], $input['currency']);

            return self::posted($journal['id']);
        });
    }

    private function creditLines(array $input, array $allocations, array $shares): array
    {
        $lines = [];
        foreach ($allocations as $index => $allocation) {
            if ($shares[$index] > 0) {
                $lines[] = self::line($allocation['accountId'], 0, $shares[$index], $input['purchaseId'], $allocation['purposeId']);
            }
        }
        foreach (['billed', 'unbilled'] as $state) {
            if ($input[$state.'ReductionMinor'] > 0) {
                $lines[] = self::line($input['cardId'].':'.$input['currency'].':'.$state, $input[$state.'ReductionMinor'], 0, $input['purchaseId']);
            }
        }

        return $lines;
    }

    private function reverse(array $journal, string $key, string $recorded): array
    {
        return [...$journal, 'id' => Str::uuid()->toString(), 'commandKey' => $key, 'kind' => 'reversal', 'recordedAt' => $recorded, 'reversesId' => $journal['id'], 'lines' => array_map(fn ($line) => [...$line, 'debitMinor' => $line['creditMinor'], 'creditMinor' => $line['debitMinor']], $journal['lines'])];
    }

    public function correct(array $input): array
    {
        if (trim($input['reason']) === '' || ! is_int($input['expectedVersion']) || $input['expectedVersion'] < 1) {
            throw new AccountingError('invalid_correction');
        }

        return $this->command($input, function ($key) use ($input) {
            $current = $this->repository->purchase($input['purchaseId']);
            if ($current === null) {
                return self::review('missing_supported_purchase');
            }
            if ($current['version'] !== $input['expectedVersion']) {
                throw new AccountingError('stale_purchase_version');
            }
            $replacement = [...$input['replacement'], 'key' => $input['key'], 'recordedAt' => $input['recordedAt']];
            if ($current['cardId'] !== $input['cardId'] || $replacement['cardId'] !== $input['cardId'] || $replacement['purchaseId'] !== $input['purchaseId'] || $replacement['currency'] !== $current['currency']) {
                throw new AccountingError('correction_identity_mismatch');
            }
            $original = $this->repository->journal($current['journalId']);
            if ($original === null) {
                throw new AccountingError('missing_original_journal');
            }
            $state = $this->repository->state($input['cardId'], $current['currency']);
            $billings = array_values(array_filter($state['billings'], fn ($row) => $row['purchaseId'] === $input['purchaseId']));
            $credits = array_values(array_filter($state['credits'], fn ($row) => $row['purchaseId'] === $input['purchaseId']));
            if (($billings !== [] || $credits !== []) && $replacement['principalMinor'] !== $current['principalMinor']) {
                return self::review('correction_requires_schedule_revalidation');
            }
            foreach ($billings as $billing) {
                if ($billing['effectiveDate'] < $replacement['effectiveDate']) {
                    return self::review('billing_before_purchase');
                }
            }
            if (! $this->supportedAllocations($replacement)) {
                return self::review('unsupported_financial_nature');
            }
            $reversal = $this->reverse($original, $key, $input['recordedAt']);
            $new = [...$original, 'id' => Str::uuid()->toString(), 'commandKey' => $key, 'kind' => 'replacement', 'recordedAt' => $input['recordedAt'], 'reversesId' => null, 'effectiveDate' => $replacement['effectiveDate'], 'evidenceIds' => $replacement['evidenceIds'], 'lines' => self::purchaseLines($replacement)];
            $version = $current['version'] + 1;
            $componentRevisions = [];
            foreach ($billings as $billing) {
                $amounts = Money::split($billing['amountMinor'], array_column($replacement['allocations'], 'minor'));
                $known = array_fill_keys(array_column($billing['components'], 'id'), true);
                foreach ($state['componentRevisions'] as $revision) {
                    if ($revision['billingId'] === $billing['id']) {
                        $known[$revision['componentId']] = true;
                    }
                }
                foreach ($replacement['allocations'] as $index => $allocation) {
                    $id = $billing['id'].':'.$index;
                    if ($amounts[$index] === 0 && ! isset($known[$id])) {
                        continue;
                    }
                    unset($known[$id]);
                    $componentRevisions[] = ['id' => Str::uuid()->toString(), 'componentId' => $id, 'billingId' => $billing['id'], 'revision' => $version, 'purposeId' => $allocation['purposeId'], 'minor' => $amounts[$index], 'purchaseDate' => $replacement['effectiveDate']];
                }
                foreach (array_keys($known) as $id) {
                    $componentRevisions[] = ['id' => Str::uuid()->toString(), 'componentId' => $id, 'billingId' => $billing['id'], 'revision' => $version, 'purposeId' => null, 'minor' => 0, 'purchaseDate' => $replacement['effectiveDate']];
                }
            }
            $revisions = array_merge($state['componentRevisions'], $componentRevisions);
            try {
                $decisions = Attribution::replay([...$state, 'componentRevisions' => $revisions]);
            } catch (AccountingError $error) {
                if ($error->errorCode === 'invalid_issuer_allocation') {
                    return self::review('correction_conflicts_with_issuer_allocation');
                }
                throw $error;
            }
            $newAttributions = [];
            $markers = [];
            foreach ($decisions as $decision) {
                $payment = array_values(array_filter($state['payments'], fn ($row) => $row['id'] === $decision['paymentId']))[0];
                $revision = 1;
                foreach (array_merge($state['attributions'], $state['attributionRevisions']) as $row) {
                    if ($row['paymentId'] === $payment['id']) {
                        $revision = max($revision, $row['revision'] + 1);
                    }
                }
                $markers[] = ['paymentId' => $payment['id'], 'revision' => $revision, 'unappliedMinor' => $decision['unappliedMinor']];
                foreach ($decision['assigned'] as $allocation) {
                    $newAttributions[] = [...$allocation, 'id' => Str::uuid()->toString(), 'paymentId' => $payment['id'], 'revision' => $revision, 'method' => $payment['issuerAllocations'] === null ? 'oldest_billed_first' : 'issuer'];
                }
            }
            $weights = array_column($replacement['allocations'], 'minor');
            $revisedCredits = [];
            $creditPairs = [];
            $events = array_merge(array_map(fn ($row) => [...$row, 'type' => 'payment'], $state['payments']), array_map(fn ($row) => [...$row, 'type' => 'credit'], $state['credits']));
            usort($events, Attribution::eventOrder(...));
            foreach ($events as $event) {
                if ($event['type'] === 'payment') {
                    continue;
                }
                unset($event['type']);
                if ($event['purchaseId'] !== $input['purchaseId']) {
                    $revisedCredits[] = $event;

                    continue;
                }
                $earlier = array_column(array_filter($state['payments'], fn ($row) => Attribution::eventOrder($row, $event) <= 0), 'id');
                $earlierRows = array_values(array_filter($newAttributions, fn ($row) => in_array($row['paymentId'], $earlier, true)));
                $components = array_values(array_filter(Attribution::outstanding($state['billings'], $earlierRows, $revisedCredits, $revisions, $markers, $state['payments']), fn ($row) => $row['billedDate'] <= $event['effectiveDate'] && $row['purchaseId'] === $input['purchaseId']));
                $shares = Money::split($event['amountMinor'], $weights);
                foreach ($shares as $index => $minor) {
                    $weights[$index] -= $minor;
                }
                $old = $this->repository->journal($event['journalId']);
                if ($old === null) {
                    throw new AccountingError('missing_original_credit');
                }
                $creditReversal = $this->reverse($old, $key, $input['recordedAt']);
                $creditReplacement = [...$old, 'id' => Str::uuid()->toString(), 'commandKey' => $key, 'kind' => 'replacement', 'recordedAt' => $input['recordedAt'], 'reversesId' => null, 'lines' => $this->creditLines($event, $replacement['allocations'], $shares)];
                $allocated = Attribution::oldest($event['billedReductionMinor'], $components);
                $updated = [...$event, 'journalId' => $creditReplacement['id'], 'allocationReductions' => array_map(fn ($minor, $index) => ['allocationIndex' => $index, 'minor' => $minor], $shares, array_keys($shares)), 'componentReductions' => array_map(fn ($row) => ['componentId' => $row['componentId'], 'minor' => $row['minor']], $allocated['assigned'])];
                $revisedCredits[] = $updated;
                $creditPairs[] = ['reversal' => $creditReversal, 'replacement' => $creditReplacement, 'credit' => $updated];
            }
            $this->append($reversal);
            $this->append($new);
            $this->repository->appendPurchase([...$replacement, 'version' => $version, 'journalId' => $new['id']]);
            $this->repository->insert('correction_links', ['id' => Str::uuid()->toString(), 'purchase_id' => $input['purchaseId'], 'from_version' => $current['version'], 'to_version' => $version, 'reversal_journal_id' => $reversal['id'], 'replacement_journal_id' => $new['id'], 'reason' => $input['reason'], 'recorded_at' => $input['recordedAt']]);
            foreach ($componentRevisions as $revision) {
                $this->repository->appendComponentRevision($revision);
            }
            foreach ($newAttributions as $row) {
                $this->repository->insert('attributions', ['id' => $row['id'], 'payment_id' => $row['paymentId'], 'component_id' => $row['componentId'], 'purpose_id' => $row['purposeId'], 'minor' => $row['minor'], 'method' => $row['method'], 'revision' => $row['revision']]);
            }
            foreach ($markers as $row) {
                $this->repository->insert('attribution_revisions', ['payment_id' => $row['paymentId'], 'revision' => $row['revision'], 'unapplied_minor' => $row['unappliedMinor']], false);
            }
            $ids = [$reversal['id'], $new['id']];
            foreach ($creditPairs as $pair) {
                $this->append($pair['reversal']);
                $this->append($pair['replacement']);
                $this->repository->insert('credit_revisions', ['id' => Str::uuid()->toString(), 'credit_id' => $pair['credit']['id'], 'purchase_version' => $version, 'reversal_journal_id' => $pair['reversal']['id'], 'replacement_journal_id' => $pair['replacement']['id'], 'recorded_at' => $input['recordedAt'], 'payload' => LedgerRepository::json($pair['credit'])]);
                array_push($ids, $pair['reversal']['id'], $pair['replacement']['id']);
            }

            return self::posted(...$ids);
        });
    }

    public function registerOpening(array $obligation): void
    {
        $this->repository->transaction(function () use ($obligation): void {
            $existing = $this->repository->query('opening_obligations')->where('id', $obligation['id'])->first();
            if ($existing !== null) {
                if (self::digest(json_decode($existing->payload, true, flags: JSON_THROW_ON_ERROR)) !== self::digest($obligation)) {
                    throw new AccountingError('opening_obligation_conflict');
                }

                return;
            }
            $journal = $this->repository->journal($obligation['openingJournalId']);
            if (trim($obligation['id']) === '' || ! self::validDate($obligation['purchaseDate']) || $journal === null || $journal['kind'] !== 'opening' || $journal['cardId'] !== $obligation['cardId'] || $journal['currency'] !== $obligation['currency'] || $obligation['purchaseDate'] > $journal['effectiveDate'] || $obligation['evidenceIds'] === [] || count(array_unique($obligation['evidenceIds'])) !== count($obligation['evidenceIds'])) {
                throw new AccountingError('invalid_opening_obligation');
            }
            foreach ($obligation['evidenceIds'] as $id) {
                if (! $this->repository->query('evidence')->where('id', $id)->exists()) {
                    throw new AccountingError('missing_evidence');
                }
            }
            if (Money::minor($obligation['originalPrincipalMinor']) === 0 || Money::minor($obligation['remainingMinor']) === 0 || Money::minor($obligation['alreadyBilledMinor']) + $obligation['remainingMinor'] !== $obligation['originalPrincipalMinor'] || ! is_int($obligation['lastBilledInstallment']) || $obligation['lastBilledInstallment'] < 0 || ! is_int($obligation['installmentCount']) || $obligation['installmentCount'] <= $obligation['lastBilledInstallment'] || ($obligation['alreadyBilledMinor'] === 0) !== ($obligation['lastBilledInstallment'] === 0)) {
                throw new AccountingError('invalid_opening_obligation');
            }
            $sum = 0;
            foreach ($obligation['allocations'] as $allocation) {
                if (Money::minor($allocation['minor']) === 0) {
                    throw new AccountingError('invalid_opening_obligation_allocation');
                }
                $sum = Money::minor($sum + $allocation['minor']);
            }
            if ($sum !== $obligation['remainingMinor']) {
                throw new AccountingError('invalid_opening_obligation_allocation');
            }
            $capacity = 0;
            foreach ($journal['lines'] as $line) {
                if ($line['accountId'] === $obligation['cardId'].':'.$obligation['currency'].':unbilled') {
                    $capacity += $line['creditMinor'] - $line['debitMinor'];
                }
            }
            $registered = array_sum(array_column($this->repository->payloads('opening_obligations', ['opening_journal_id' => $journal['id']]), 'remainingMinor'));
            if ($registered + $obligation['remainingMinor'] > $capacity) {
                throw new AccountingError('opening_obligation_exceeds_balance');
            }
            $this->repository->insert('opening_obligations', ['id' => $obligation['id'], 'card_id' => $obligation['cardId'], 'currency' => $obligation['currency'], 'opening_journal_id' => $journal['id'], 'payload' => LedgerRepository::json($obligation)]);
            foreach ($obligation['evidenceIds'] as $id) {
                $this->repository->insert('opening_obligation_evidence', ['obligation_id' => $obligation['id'], 'evidence_id' => $id], false);
            }
        });
    }

    public function billOpening(array $input): array
    {
        if (! is_int($input['installment']) || $input['installment'] < 1 || Money::minor($input['amountMinor']) === 0 || $input['evidenceIds'] === []) {
            throw new AccountingError('invalid_billing');
        }

        return $this->command($input, function () use ($input) {
            $row = $this->repository->query('opening_obligations')->where('id', $input['openingObligationId'])->first();
            $obligation = $row === null ? null : json_decode($row->payload, true, flags: JSON_THROW_ON_ERROR);
            if ($obligation === null || $obligation['cardId'] !== $input['cardId'] || $obligation['currency'] !== $input['currency']) {
                return self::review('missing_supported_opening_obligation');
            }
            $opening = $this->repository->journal($obligation['openingJournalId']);
            if ($opening === null || $input['effectiveDate'] <= $opening['effectiveDate'] || $input['installment'] <= $obligation['lastBilledInstallment'] || $input['installment'] > $obligation['installmentCount']) {
                return self::review('unsupported_opening_installment');
            }
            $billings = $this->repository->payloads('billings', ['opening_obligation_id' => $obligation['id']]);
            foreach ($billings as $billing) {
                if ($billing['installment'] === $input['installment']) {
                    return $billing['amountMinor'] === $input['amountMinor'] && $billing['effectiveDate'] === $input['effectiveDate'] ? ['status' => 'duplicate', 'journalIds' => [$billing['journalId']], 'reviewCode' => null] : self::review('conflicting_installment');
                }
            }
            if (Money::minor(array_sum(array_column($billings, 'amountMinor')) + $input['amountMinor']) > $obligation['remainingMinor']) {
                return self::review('billing_exceeds_opening_remaining');
            }
            $id = $this->appendBilling($input, $obligation['allocations'], $obligation['purchaseDate'], $obligation['id']);
            $this->repository->replay($input['cardId'], $input['currency']);

            return self::posted($id);
        });
    }

    public function post(array $journal): array
    {
        $input = ['key' => $journal['commandKey'], 'cardId' => $journal['cardId'], ...$journal];
        unset($input['id']);

        return $this->command($input, function ($key) use ($journal) {
            $this->append([...$journal, 'commandKey' => $key]);

            return self::posted($journal['id']);
        });
    }
}
