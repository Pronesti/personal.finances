<?php

namespace App\Domain\Evidence;

use App\Domain\Ledger\AccountingError;
use App\Domain\Ledger\FinancialCommands;
use App\Domain\Ledger\LedgerRepository;
use App\Domain\Ledger\Money;
use Brick\Math\BigInteger;
use Illuminate\Support\Str;

/** Evidence associations never fabricate acquisitions or change opening books. */
class HistoricalAssociations
{
    public function __construct(private ReceiptService $receipts) {}

    public function latest(int $receipt): ?array
    {
        $payload = $this->receipts->repository->query('historical_receipt_associations')->where('receipt_id', $receipt)->orderByDesc('ordinal')->value('payload');

        return $payload === null ? null : json_decode($payload, true);
    }

    public function current(): array
    {
        $latest = [];
        foreach ($this->receipts->repository->query('historical_receipt_associations')->orderBy('ordinal')->get() as $row) {
            $latest[$row->receipt_id] = json_decode($row->payload, true);
        }

        return array_values(array_filter($latest, fn ($row) => $row['action'] === 'link'));
    }

    public function decide(array $input): array
    {
        return $this->receipts->repository->transaction(function () use ($input) {
            $repository = $this->receipts->repository;
            $key = 'historical-association:'.rawurlencode($input['key']);
            $digest = FinancialCommands::digest($input);
            $saved = $repository->query('historical_receipt_associations')->where('key', $key)->first();
            if ($saved !== null) {
                if ($saved->digest !== $digest) {
                    throw new AccountingError('command_conflict');
                }

return json_decode($saved->payload, true);
            }
            $receipt = $this->receipts->facts($input['receiptRevisionId']);
            if ($receipt === null || ($this->receipts->source($input['receiptRevisionId'])['admission'] ?? null) !== 'accepted' || ! ReceiptVerification::verify($receipt['parsed'])['ok'] || ! $receipt['date'] || ! $receipt['totalMinor']) {
                throw new AccountingError('historical_association_source_unavailable');
            }
            $previous = $this->latest($receipt['receiptId']);
            if ($input['expectedPreviousDecisionId'] !== ($previous['id'] ?? null)) {
                throw new AccountingError('stale_historical_association');
            }
            $source = $input['sourceLineId'] ?? ($input['action'] === 'unlink' ? ($previous['sourceLineId'] ?? null) : null);
            if (! $source || ! in_array($input['action'], ['link', 'unlink'], true) || ($input['action'] === 'unlink' && (($previous['action'] ?? null) !== 'link' || $source !== $previous['sourceLineId']))) {
                throw new AccountingError('invalid_historical_association');
            }
            $line = $repository->query('source_lines')->where('id', $source)->first();
            $revision = $line === null ? null : $this->receipts->source($line->revision_id);
            if ($line === null || ($revision['kind'] ?? null) !== 'statement' || $revision['admission'] !== 'accepted' || ! $revision['cardId']) {
                throw new AccountingError('historical_association_source_unavailable');
            }
            $row = json_decode($line->payload, true);
            $count = $row['installment_count'] ?? 1;
            if (($row['section'] ?? null) !== 'purchases' || ($row['ars'] ?? 0) <= 0 || ($row['usd'] ?? 0) != 0 || ! is_string($row['date'] ?? null) || ! preg_match('/^\d{4}-\d{2}-\d{2}$/D', $row['date']) || ! checkdate((int) substr($row['date'], 5, 2), (int) substr($row['date'], 8, 2), (int) substr($row['date'], 0, 4)) || ! preg_match('/(?:^|[^A-Z])COTO(?:[^A-Z]|$)/i', $row['description'] ?? '')) {
                throw new AccountingError('historical_association_currency_or_amount');
            }
            if (! is_int($count) || $count < 1 || $count > Money::MAX || ($row['installment_number'] ?? 1) !== 1 || abs(strtotime($row['date'].'T00:00:00Z') - strtotime($receipt['date'].'T00:00:00Z')) > 3 * 86400 || BigInteger::of(Money::source($row['ars']))->multipliedBy($count)->minus($receipt['totalMinor'])->abs()->isGreaterThan(BigInteger::of($count)->multipliedBy($count - 1))) {
                throw new AccountingError('historical_association_evidence_mismatch');
            }
            if ($input['action'] === 'link') {
                foreach ($this->current() as $link) {
                    if ($link['sourceLineId'] === $source && $link['receiptId'] !== $receipt['receiptId']) {
                        throw new AccountingError('source_charge_already_linked');
                    }
                }
                $purchases = $repository->query('source_purchase_identities')->where('source_line_id', $source)->where('currency', 'ARS')->pluck('purchase_id')->all();
                foreach ((new ReceiptReconciliation($this->receipts))->active() as $link) {
                    if ($link['receiptId'] === $receipt['receiptId'] && ! in_array($link['purchaseId'], $purchases, true)) {
                        throw new AccountingError('receipt_has_financial_link');
                    }
                    if ($link['receiptId'] !== $receipt['receiptId'] && in_array($link['purchaseId'], $purchases, true)) {
                        throw new AccountingError('source_charge_already_linked');
                    }
                }
            }
            $decision = ['id' => Str::uuid()->toString(), 'key' => $key, 'receiptId' => $receipt['receiptId'], 'receiptRevisionId' => $receipt['revisionId'], 'sourceLineId' => $source, 'cardId' => $revision['cardId'], 'currency' => 'ARS', 'receiptMinor' => $receipt['totalMinor'], 'statementMinor' => Money::source($row['ars']), 'installmentCount' => $row['installment_count'] ?? null, 'action' => $input['action'], 'previousDecisionId' => $previous['id'] ?? null, 'method' => 'manual', 'recordedAt' => $input['recordedAt']];
            $repository->insert('historical_receipt_associations', ['id' => $decision['id'], 'key' => $key, 'digest' => $digest, 'receipt_id' => $receipt['receiptId'], 'receipt_revision_id' => $receipt['revisionId'], 'source_line_id' => $source, 'card_id' => $revision['cardId'], 'action' => $input['action'], 'previous_decision_id' => $decision['previousDecisionId'], 'recorded_at' => $input['recordedAt'], 'payload' => LedgerRepository::json($decision)]);

            return $decision;
        });
    }
}
