<?php

namespace App\Domain\Evidence;

use App\Domain\Ledger\AccountingError;
use App\Domain\Ledger\FinancialCommands;
use App\Domain\Ledger\LedgerRepository;
use App\Domain\Ledger\Money;
use Illuminate\Support\Str;

/** Narrow explicit full refund of a retained pre-opening one-off acquisition. */
class HistoricalRefund
{
    public function __construct(private ReceiptService $sources) {}

    public function post(array $input): array
    {
        if (($input['confirmedFullRefund'] ?? false) !== true) {
            throw new AccountingError('full_refund_confirmation_required');
        }

        return $this->sources->repository->transaction(function () use ($input) {
            $repository = $this->sources->repository;
            if (! in_array($input['currency'], ['ARS', 'USD'], true)) {
                throw new AccountingError('invalid_currency');
            }
            $key = 'historical-refund:'.rawurlencode($input['refundSourceLineId']);
            $digest = FinancialCommands::digest([...$input, 'key' => '']);
            $saved = $repository->query('review_decisions')->where('key', $key)->first();
            if ($saved !== null) {
                if ($saved->digest !== $digest) {
                    throw new AccountingError('command_conflict');
                }

                return [...json_decode($saved->payload, true)['result'], 'status' => 'duplicate'];
            }
            $original = $repository->query('source_lines')->where('id', $input['originalSourceLineId'])->first();
            $refund = $repository->query('source_lines')->where('id', $input['refundSourceLineId'])->first();
            $originalRevision = $original === null ? null : $this->sources->source($original->revision_id);
            $refundRevision = $refund === null ? null : $this->sources->source($refund->revision_id);
            if ($original === null || $refund === null || ($originalRevision['kind'] ?? null) !== 'statement' || ($refundRevision['kind'] ?? null) !== 'statement' || $originalRevision['admission'] !== 'accepted' || $refundRevision['admission'] !== 'accepted' || $originalRevision['cardId'] !== $input['cardId'] || $refundRevision['cardId'] !== $input['cardId']) {
                throw new AccountingError('historical_refund_source_mismatch');
            }
            $opening = $repository->query('journals')->where('kind', 'opening')->where('status', 'posted')->where('card_id', $input['cardId'])->where('currency', $input['currency'])->orderBy('effective_date')->value('effective_date');
            $acquisition = json_decode($original->payload, true);
            $credit = json_decode($refund->payload, true);
            $field = $input['currency'] === 'ARS' ? 'ars' : 'usd';
            $other = $field === 'ars' ? 'usd' : 'ars';
            $validDate = fn ($date) => is_string($date) && preg_match('/^\d{4}-\d{2}-\d{2}$/D', $date) && checkdate((int) substr($date, 5, 2), (int) substr($date, 8, 2), (int) substr($date, 0, 4));
            if (! $opening || $originalRevision['rawPayload']['period']['closing_date'] > $opening || ($acquisition['section'] ?? null) !== 'purchases' || ! $validDate($acquisition['date'] ?? null) || $acquisition['date'] > $opening || ($acquisition['installment_count'] ?? 1) !== 1 || ($acquisition['installment_number'] ?? 1) !== 1 || ($acquisition[$field] ?? 0) <= 0 || ($acquisition[$other] ?? 0) != 0 || preg_match('/(PLAN\s*[OÓ]VALO|ADELANTO|PR[EÉ]STAMO|EXTRACCI[OÓ]N|EFECTIVO)/iu', $acquisition['description'] ?? '') || ! $validDate($credit['date'] ?? null) || $credit['date'] <= $opening || ($credit[$field] ?? 0) >= 0 || ($credit[$other] ?? 0) != 0 || ! in_array($credit['section'] ?? null, ['payments', 'purchases'], true) || ! preg_match('/REEMBOLSO|DEVOLUCI[OÓ]N|REFUND/iu', $credit['description'] ?? '')) {
                throw new AccountingError('historical_refund_evidence_mismatch');
            }
            $amount = Money::source(-$credit[$field]);
            if ($amount !== Money::source($acquisition[$field])) {
                throw new AccountingError('full_refund_amount_mismatch');
            }
            if ($repository->query('source_purchase_identities')->where('source_line_id', $original->id)->exists()) {
                throw new AccountingError('refund_requires_posted_purchase_link');
            }
            if ($repository->query('review_decisions')->where('subject_id', $original->id)->where('kind', 'historical_refund')->exists()) {
                throw new AccountingError('historical_purchase_already_refunded');
            }
            $account = $repository->query('accounts')->where('id', $input['accountId'])->first();
            if ($account === null || $account->type !== 'expense' || ($account->primary_purpose_id !== null && $account->primary_purpose_id !== $input['purposeId'])) {
                throw new AccountingError('unsupported_historical_refund_account');
            }
            $journal = ['id' => Str::uuid()->toString(), 'commandKey' => $key, 'cardId' => $input['cardId'], 'currency' => $input['currency'], 'effectiveDate' => $credit['date'], 'recordedAt' => $input['recordedAt'], 'kind' => 'credit', 'reversesId' => null, 'evidenceIds' => [$refund->id, $original->id], 'lines' => [['accountId' => $input['cardId'].':'.$input['currency'].':billed', 'debitMinor' => $amount, 'creditMinor' => 0, 'purchaseId' => null, 'purposeId' => null], ['accountId' => $input['accountId'], 'debitMinor' => 0, 'creditMinor' => $amount, 'purchaseId' => null, 'purposeId' => $input['purposeId']]]];
            $result = (new FinancialCommands($repository))->post($journal);
            if ($result['status'] === 'review') {
                throw new AccountingError($result['reviewCode'] ?? 'historical_refund_review');
            }
            $priorClassification = $repository->query('review_events')->where('subject_id', $original->id)->where('code', 'historical_source_classification')->orderByDesc('ordinal')->value('id');
            $repository->insert('review_events', ['id' => Str::uuid()->toString(), 'subject_id' => $original->id, 'prior_decision_id' => $priorClassification, 'code' => 'historical_source_classification', 'params' => LedgerRepository::json(['accountId' => $input['accountId'], 'purposeId' => $input['purposeId']]), 'source_line_ids' => LedgerRepository::json([$original->id]), 'state' => 'reviewed', 'recorded_at' => $input['recordedAt']]);
            $events = $repository->query('review_events')->where('subject_id', $refund->revision_id)->get();
            foreach ($events as $event) {
                if ($event->state === 'open' && in_array($refund->id, json_decode($event->source_line_ids, true), true) && ! $events->contains(fn ($child) => $child->prior_decision_id === $event->id)) {
                    $repository->insert('review_events', ['id' => Str::uuid()->toString(), 'subject_id' => $refund->revision_id, 'prior_decision_id' => $event->id, 'code' => $event->code, 'params' => LedgerRepository::json([...json_decode($event->params, true), 'resolution' => 'verified_full_historical_refund', 'originalSourceLineId' => $original->id, 'refundJournalId' => $journal['id']]), 'source_line_ids' => $event->source_line_ids, 'state' => 'reviewed', 'recorded_at' => $input['recordedAt']]);
                }
            }
            $repository->insert('review_decisions', ['id' => Str::uuid()->toString(), 'key' => $key, 'digest' => $digest, 'subject_id' => $original->id, 'kind' => 'historical_refund', 'payload' => LedgerRepository::json(['input' => $input, 'result' => $result, 'amountMinor' => $amount, 'originalPurchaseDate' => $acquisition['date'], 'effectiveDate' => $credit['date']]), 'recorded_at' => $input['recordedAt']]);

            return $result;
        });
    }
}
