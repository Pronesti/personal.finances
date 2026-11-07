<?php

namespace App\Domain\Evidence;

use App\Domain\Ledger\AccountingError;
use App\Domain\Ledger\FinancialCommands;
use App\Domain\Ledger\LedgerRepository;
use App\Domain\Ledger\Money;
use Illuminate\Support\Str;
use stdClass;

/** Parser output admission; HTTP processing and receipt reconciliation are separate boundaries. */
class StatementImporter
{
    public function __construct(private LedgerRepository $repository, private DocumentStore $documents) {}

    private static function date(mixed $date): bool
    {
        return is_string($date) && preg_match('/^\d{4}-\d{2}-\d{2}$/D', $date) && checkdate((int) substr($date, 5, 2), (int) substr($date, 8, 2), (int) substr($date, 0, 4));
    }

    private function object(array $object): void
    {
        $existing = $this->repository->query('source_documents')->where('sha256', $object['sha256'])->first();
        if ($existing !== null) {
            if ((int) $existing->byte_length !== $object['byte_length'] || $existing->relative_path !== $object['relative_path']) {
                throw new AccountingError('document_hash_mismatch');
            }

            return;
        }
        $this->repository->insert('source_documents', $object);
    }

    private function reference(string $id, array $object): void
    {
        if (! $this->repository->query('object_references')->where('kind', 'object')->where('reference_id', $id)->exists()) {
            $this->repository->insert('object_references', ['kind' => 'object', 'reference_id' => $id, ...$object]);
        }
    }

    private function totalsConflict(stdClass $json): bool
    {
        foreach ($json->declared_totals ?? [] as $total) {
            foreach (['ars', 'usd'] as $currency) {
                if (($total->$currency ?? null) === null) {
                    continue;
                }
                if (str_starts_with($total->concept, 'TOTAL CONSUMOS') && ($total->block ?? null) !== null) {
                    $actual = 0;
                    foreach ($json->transactions as $line) {
                        if ($line->section === 'purchases' && ($line->block ?? null) === $total->block) {
                            $actual += Money::source($line->$currency ?? 0);
                        }
                    }
                    if (abs($actual) > Money::MAX || $actual !== Money::source($total->$currency)) {
                        return true;
                    }
                }
                if ($total->concept === 'SALDO ACTUAL') {
                    $field = $currency === 'ars' ? 'current_ars' : 'current_usd';
                    if (isset($json->balances->$field) && Money::source($json->balances->$field) !== Money::source($total->$currency)) {
                        return true;
                    }
                }
            }
        }

        return false;
    }

    public function import(array $input): array
    {
        $filename = trim($input['filename']);
        if (! preg_match('/^[A-Za-z0-9][A-Za-z0-9._ -]*\.pdf$/iD', $filename) || strlen($filename) > 200) {
            throw new AccountingError('bad_name');
        }
        if (trim($input['cardId']) === '' || trim($input['key']) === '') {
            throw new AccountingError('missing_card_identity');
        }
        if (strlen($input['pdf']) > 10485760) {
            throw new AccountingError('too_large');
        }
        if (! str_starts_with($input['pdf'], '%PDF-')) {
            throw new AccountingError('not_pdf');
        }
        if (strlen($input['rawJson']) > 4 * 1024 * 1024 || trim($input['appRevision']) === '') {
            throw new AccountingError('invalid_source_metadata');
        }
        $json = json_decode($input['rawJson'], flags: JSON_THROW_ON_ERROR);
        if (! $json instanceof stdClass || ! self::date($json->period->closing_date ?? null) || ! is_array($json->transactions ?? null) || ! self::date(substr($input['recordedAt'], 0, 10))) {
            throw new AccountingError('invalid_statement');
        }
        $json->file = $filename;
        $hash = hash('sha256', $input['pdf']);
        $payloadDigest = SourceIdentity::payloadDigest($json);
        $sourceKey = LedgerRepository::json(['statement', $input['cardId'], $json->period->closing_date]);
        $commandKey = 'card:'.rawurlencode($input['cardId']).':statement:'.rawurlencode($input['key']);
        $normalized = clone $json;
        $normalized->file = null;
        $digest = hash('sha256', SourceIdentity::canonical(['cardId' => $input['cardId'], 'documentHash' => $hash, 'json' => $normalized, 'observationOnly' => $input['observationOnly'] ?? false]));
        $pdfObject = $this->documents->put($this->repository->ledger, $input['pdf']);
        $rawObject = $this->documents->put($this->repository->ledger, $input['rawJson']);

        return $this->repository->transaction(function () use ($input, $json, $hash, $payloadDigest, $sourceKey, $commandKey, $digest, $pdfObject, $rawObject) {
            $saved = $this->repository->query('source_import_commands')->where('key', $commandKey)->first();
            if ($saved !== null) {
                if (! hash_equals($saved->digest, $digest)) {
                    throw new AccountingError('command_conflict');
                }
                $result = json_decode($saved->result, true, flags: JSON_THROW_ON_ERROR);

                return [...$result, 'postedJournalIds' => [], 'duplicate' => true];
            }
            if (! $this->repository->query('accounts')->whereIn('id', [$input['cardId'].':ARS:billed', $input['cardId'].':USD:billed'])->exists()) {
                throw new AccountingError('unknown_card');
            }
            $sameDocument = $this->repository->query('source_revisions')->where('kind', 'statement')->where('document_hash', $hash)->orderByDesc('ordinal')->first();
            if ($sameDocument !== null && $sameDocument->card_id !== $input['cardId']) {
                throw new AccountingError('document_identity_conflict');
            }
            $duplicate = $this->repository->query('source_revisions')->where('kind', 'statement')->where('document_hash', $hash)->where('payload_digest', $payloadDigest)->first();
            $result = ['sourceRevisionId' => $duplicate?->id, 'purchaseIds' => [], 'postedJournalIds' => [], 'reviews' => [], 'duplicate' => $duplicate !== null];
            if ($duplicate !== null) {
                if ($duplicate->source_key !== $sourceKey) {
                    throw new AccountingError('document_identity_conflict');
                }
                $result['reviews'] = $this->repository->query('review_events')->where('subject_id', $duplicate->id)->orderBy('ordinal')->get()->map(fn ($row) => ['code' => $row->code, 'params' => json_decode($row->params), 'sourceLineIds' => json_decode($row->source_line_ids)])->all();
            } else {
                $previous = $this->repository->query('source_revisions')->where('source_key', $sourceKey)->orderByDesc('ordinal')->first() ?? $sameDocument;
                $conflict = $this->totalsConflict($json);
                $supported = in_array($json->brand, ['visa', 'mastercard', 'mercadopago'], true);
                $admission = $previous !== null || $conflict || ! $supported ? 'pending' : 'accepted';
                $revision = 'source:statement:'.$hash.':'.$payloadDigest;
                $result['sourceRevisionId'] = $revision;
                $this->object($pdfObject);
                $this->object($rawObject);
                $payload = ['id' => $revision, 'kind' => 'statement', 'cardId' => $input['cardId'], 'documentHash' => $hash, 'rawPayload' => $json, 'sourceKey' => $sourceKey, 'previousRevisionId' => $previous?->id, 'recordedAt' => $input['recordedAt'], 'admission' => $admission, 'appRevision' => $input['appRevision']];
                $this->repository->insert('evidence', ['id' => $revision, 'kind' => 'statement', 'metadata' => LedgerRepository::json($payload)]);
                $this->repository->insert('source_revisions', ['id' => $revision, 'source_key' => $sourceKey, 'kind' => 'statement', 'card_id' => $input['cardId'], 'document_hash' => $hash, 'raw_object_hash' => $rawObject['sha256'], 'previous_revision_id' => $previous?->id, 'recorded_at' => $input['recordedAt'], 'payload_digest' => $payloadDigest, 'app_revision' => $input['appRevision'], 'payload' => LedgerRepository::json($payload)]);
                $this->reference($revision.':document', $pdfObject);
                $this->reference($revision.':extraction', $rawObject);
                $seen = [];
                foreach ($json->transactions as $index => $line) {
                    $id = SourceIdentity::line($revision, $index + 1);
                    $fingerprint = SourceIdentity::fingerprint($json->brand, $line, 0);
                    $seen[$fingerprint] = ($seen[$fingerprint] ?? 0) + 1;
                    $this->repository->insert('evidence', ['id' => $id, 'kind' => 'statement', 'metadata' => LedgerRepository::json(['revisionId' => $revision, 'occurrence' => $index + 1])]);
                    $this->repository->insert('source_lines', ['id' => $id, 'revision_id' => $revision, 'occurrence' => $index + 1, 'payload' => LedgerRepository::json($line), 'legacy_fingerprint' => SourceIdentity::fingerprint($json->brand, $line, $seen[$fingerprint])]);
                }
                $this->repository->insert('statement_cycles', ['revision_id' => $revision, 'card_id' => $input['cardId'], 'closing_date' => $json->period->closing_date, 'period' => LedgerRepository::json($json->period)]);
                $this->repository->insert('statement_terms', ['revision_id' => $revision, 'payload' => LedgerRepository::json(['balances' => $json->balances ?? null, 'limits' => $json->limits ?? null, 'rates' => $json->rates ?? null, 'accountSummary' => $json->account_summary ?? null])]);
                foreach ($json->upcoming_installments ?? [] as $index => $schedule) {
                    $this->repository->insert('issuer_schedules', ['revision_id' => $revision, 'ordinal' => $index + 1, 'payload' => LedgerRepository::json($schedule)], false);
                }
                $review = function (string $code, array $ids = [], array $params = []) use (&$result, $revision, $input): void {
                    $result['reviews'][] = ['code' => $code, 'params' => (object) $params, 'sourceLineIds' => $ids];
                    $this->repository->insert('review_events', ['id' => Str::uuid()->toString(), 'subject_id' => $revision, 'prior_decision_id' => null, 'code' => $code, 'params' => LedgerRepository::json((object) $params), 'source_line_ids' => LedgerRepository::json($ids), 'state' => 'open', 'recorded_at' => $input['recordedAt']]);
                };
                if ($previous !== null) {
                    $review('source_revision_requires_review', [], ['previousRevisionId' => $previous->id]);
                }
                if ($conflict) {
                    $review('statement_totals_conflict');
                }
                if (! $supported) {
                    $review('unsupported_statement_layout');
                }
                if ($admission === 'accepted' && ! ($input['observationOnly'] ?? false)) {
                    $this->postRows($json, $input, $revision, $result, $review);
                    $receipts = new ReceiptReconciliation(new ReceiptService($this->repository, $this->documents));
                    foreach ($receipts->reconcileAll('statement:'.$revision, $input['recordedAt']) as $reconciled) {
                        $result['purchaseIds'] = array_values(array_unique([...$result['purchaseIds'], ...$reconciled['purchaseIds']]));
                        array_push($result['postedJournalIds'], ...$reconciled['postedJournalIds']);
                    }
                }
            }
            $this->repository->insert('source_import_commands', ['key' => $commandKey, 'digest' => $digest, 'result' => LedgerRepository::json($result)]);

            return $result;
        });
    }

    private function postRows(stdClass $json, array $input, string $revision, array &$result, callable $review): void
    {
        $commands = new FinancialCommands($this->repository);
        foreach ($json->transactions as $index => $line) {
            $lineId = SourceIdentity::line($revision, $index + 1);
            $payment = $line->section === 'payments' && preg_match('/^(SU PAGO|PAGO RECIBIDO|PAGO DEL? RESUMEN)\b/iu', $line->description);
            if (($line->ars ?? 0) != 0 && ($line->usd ?? 0) != 0 && ! ($payment && $line->ars < 0 && $line->usd < 0)) {
                $review('ambiguous_dual_currency_line', [$lineId]);

                continue;
            }
            foreach (['ars' => 'ARS', 'usd' => 'USD'] as $field => $currency) {
                if (($line->$field ?? null) === null) {
                    continue;
                }
                $minor = Money::source($line->$field);
                if ($minor === 0) {
                    continue;
                }
                if (! self::date($line->date)) {
                    $review('missing_effective_date', [$lineId], ['currency' => $currency]);

                    continue;
                }
                $opening = $this->repository->query('journals')->where('card_id', $input['cardId'])->where('currency', $currency)->where('kind', 'opening')->where('status', 'posted')->orderBy('effective_date')->value('effective_date');
                if ($opening !== null && $json->period->closing_date <= $opening) {
                    $review('historical_source_requires_opening_reconciliation', [$lineId], ['currency' => $currency, 'openingDate' => $opening]);

                    continue;
                }
                $common = ['key' => 'statement:'.$lineId.':'.$currency, 'cardId' => $input['cardId'], 'currency' => $currency, 'effectiveDate' => $line->date, 'recordedAt' => $input['recordedAt'], 'evidenceIds' => [$lineId]];
                $collect = function ($post) use (&$result, $review, $lineId, $currency): void {
                    if ($post['status'] === 'posted') {
                        array_push($result['postedJournalIds'], ...$post['journalIds']);
                    }
                    if ($post['status'] === 'review') {
                        $review($post['reviewCode'] ?? 'financial_review', [$lineId], ['currency' => $currency]);
                    }
                };
                if ($payment && $minor < 0) {
                    $collect($commands->repay([...$common, 'amountMinor' => -$minor, 'issuerAllocations' => null]));

                    continue;
                }
                if ($line->section === 'purchases' && $minor > 0) {
                    if (preg_match('/(PLAN\s*[OÓ]VALO|ADELANTO|PR[EÉ]STAMO|EXTRACCI[OÓ]N|EFECTIVO)/iu', $line->description)) {
                        $review('unsupported_financial_nature', [$lineId], ['currency' => $currency]);

                        continue;
                    }
                    $identity = ['cardId' => $input['cardId'], 'currency' => $currency, 'purchaseDate' => $line->date, 'voucher' => $line->voucher ?? null, 'installment' => $line->installment_number ?? null, 'installmentCount' => $line->installment_count ?? null, 'amountMinor' => $minor, 'sourceLineId' => $lineId];
                    $candidates = $this->repository->query('source_purchase_identities')->where('card_id', $input['cardId'])->where('currency', $currency)->where('purchase_date', $line->date)->get()->map(fn ($row) => json_decode($row->payload, true, flags: JSON_THROW_ON_ERROR))->all();
                    $receipts = new ReceiptReconciliation(new ReceiptService($this->repository, $this->documents));
                    $origin = $receipts->statementOrigin(['cardId' => $input['cardId'], 'currency' => $currency, 'date' => $line->date, 'amountMinor' => $minor, 'description' => $line->description, 'installmentCount' => $line->installment_count ?? null, 'sourceLineId' => $lineId]);
                    if ($origin['reviewCode'] !== null) {
                        $review($origin['reviewCode'], [$lineId], ['currency' => $currency]);

                        continue;
                    }
                    $decision = $origin['purchaseId'] !== null ? ['status' => 'matched', 'purchaseId' => $origin['purchaseId']] : SourceIdentity::identify($identity, $candidates);
                    if ($decision['status'] === 'review') {
                        $review($decision['reason'], [$lineId], ['currency' => $currency]);

                        continue;
                    }
                    if ($decision['status'] === 'new' && ($line->installment_count ?? 1) > 1) {
                        $review('missing_supported_principal', [$lineId], ['currency' => $currency, 'installment' => $line->installment_number ?? 0]);

                        continue;
                    }
                    $purchase = $decision['purchaseId'] ?? Str::uuid()->toString();
                    if ($decision['status'] === 'new') {
                        $post = $commands->purchase([...$common, 'purchaseId' => $purchase, 'principalMinor' => $minor, 'allocations' => [['accountId' => 'expense:unallocated', 'purposeId' => 'unallocated', 'minor' => $minor]]]);
                        $collect($post);
                        if ($post['status'] === 'review') {
                            continue;
                        }
                    }
                    $this->repository->insert('source_purchase_identities', ['source_line_id' => $lineId, 'currency' => $currency, 'purchase_id' => $purchase, 'card_id' => $input['cardId'], 'purchase_date' => $line->date, 'payload' => LedgerRepository::json([...$identity, 'purchaseId' => $purchase])], false);
                    if (! in_array($purchase, $result['purchaseIds'], true)) {
                        $result['purchaseIds'][] = $purchase;
                    }
                    $collect($commands->bill([...$common, 'key' => $common['key'].':billing', 'purchaseId' => $purchase, 'installment' => $line->installment_number ?? 1, 'amountMinor' => $minor, 'effectiveDate' => $json->period->closing_date]));

                    continue;
                }
                $review($minor < 0 && $line->section === 'purchases' ? 'unlinked_credit' : 'unsupported_financial_nature', [$lineId], ['currency' => $currency]);
            }
        }
    }
}
