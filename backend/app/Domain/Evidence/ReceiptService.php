<?php

namespace App\Domain\Evidence;

use App\Domain\Ledger\AccountingError;
use App\Domain\Ledger\FinancialCommands;
use App\Domain\Ledger\LedgerRepository;
use App\Domain\Processing\ProcessingBudget;
use App\Domain\Processing\ReceiptExtraction;
use Illuminate\Support\Str;

class ReceiptService
{
    public function __construct(public readonly LedgerRepository $repository, private DocumentStore $documents) {}

    public function acceptedForHash(string $hash): ?array
    {
        $revision = $this->repository->query('source_revisions')->where('kind', 'receipt')->where('document_hash', $hash)->whereRaw("payload->>'admission'='accepted'")->orderBy('ordinal')->first();

        return $revision === null ? null : $this->facts($revision->id);
    }

    public function facts(string $revision): ?array
    {
        $row = $this->repository->query('receipt_facts')->where('revision_id', $revision)->first();

        return $row === null ? null : json_decode($row->payload, true, flags: JSON_THROW_ON_ERROR);
    }

    public function source(string $revision): ?array
    {
        $payload = $this->repository->query('source_revisions')->where('id', $revision)->value('payload');

        return $payload === null ? null : json_decode($payload, true, flags: JSON_THROW_ON_ERROR);
    }

    public function currentReceipts(): array
    {
        $values = [];
        foreach ($this->repository->query('source_revisions')->where('kind', 'receipt')->orderBy('ordinal')->get() as $revision) {
            $facts = $this->facts($revision->id);
            if ($facts === null) {
                continue;
            }
            $source = json_decode($revision->payload, true, flags: JSON_THROW_ON_ERROR);
            $facts['admission'] = $source['admission'];
            if (! isset($values[$facts['receiptId']]) || $values[$facts['receiptId']]['admission'] !== 'accepted') {
                $values[$facts['receiptId']] = $facts;
            }
        }

        return array_values($values);
    }

    public function detail(int $id): ?array
    {
        $entity = $this->repository->query('receipt_entities')->where('id', $id)->first();
        if ($entity === null) {
            return null;
        }
        $facts = array_values(array_filter($this->currentReceipts(), fn ($row) => $row['receiptId'] === $id))[0] ?? null;
        if ($facts === null) {
            return null;
        }
        $products = new ReceiptProducts($this->repository);
        $lines = $this->repository->query('source_lines')->where('revision_id', $facts['revisionId'])->orderBy('occurrence')->get()->map(function ($row) use ($products) {
            $match = $products->latest('product_match_revisions', 'id', $row->id);

            return ['id' => $row->id, 'item' => json_decode($row->payload, true), 'match' => $match, 'product' => $match === null ? null : $products->product($match['productId'])];
        })->all();
        $history = $this->repository->query('receipt_facts')->where('receipt_id', $id)->get()->map(fn ($row) => ['facts' => json_decode($row->payload, true), 'source' => $this->source($row->revision_id)])->all();
        $link = (new ReceiptReconciliation($this))->latest($id);
        $purchase = ($link['purchaseId'] ?? null) === null ? null : $this->repository->purchase($link['purchaseId']);

        return [...$facts, 'items' => $lines, 'history' => $history, 'link' => $link, 'purchaseVersion' => $purchase['version'] ?? null, 'documentHash' => $this->source($facts['revisionId'])['documentHash']];
    }

    private function object(array $object): void
    {
        $existing = $this->repository->query('source_documents')->where('sha256', $object['sha256'])->first();
        if ($existing === null) {
            $this->repository->insert('source_documents', $object);
        } elseif ((int) $existing->byte_length !== $object['byte_length'] || $existing->relative_path !== $object['relative_path']) {
            throw new AccountingError('document_hash_mismatch');
        }
    }

    private function reference(string $kind, string $id, array $object): void
    {
        if (! $this->repository->query('object_references')->where('kind', $kind)->where('reference_id', $id)->exists()) {
            $this->repository->insert('object_references', ['kind' => $kind, 'reference_id' => $id, ...$object]);
        }
    }

    public function readObject(string $hash): string
    {
        $object = $this->repository->query('source_documents')->where('sha256', $hash)->first();
        if ($object === null) {
            throw new AccountingError('missing_source_object');
        }

        return $this->documents->read($this->repository->ledger, $hash, (int) $object->byte_length);
    }

    private function entity(string $hash, ?string $fiscal, ?int $previous): int
    {
        $keys = ['sha256:'.$hash];
        if ($fiscal !== null) {
            $keys[] = 'fiscal:'.$fiscal;
        }
        $ids = $this->repository->query('receipt_entity_keys')->where('chain', 'coto')->whereIn('identity_key', $keys)->pluck('receipt_id')->map(fn ($value) => (int) $value)->all();
        if ($previous !== null) {
            $ids[] = $previous;
        }
        $ids = array_unique($ids);
        if (count($ids) > 1) {
            throw new AccountingError('receipt_identity_conflict');
        }
        $id = $ids === [] ? null : array_values($ids)[0];
        if ($id === null) {
            $rowId = Str::uuid()->toString();
            $this->repository->insert('receipt_entities', ['row_id' => $rowId, 'chain' => 'coto', 'fiscal_id' => $fiscal]);
            $id = (int) $this->repository->query('receipt_entities')->where('row_id', $rowId)->value('id');
        } else {
            $entity = $this->repository->query('receipt_entities')->where('id', $id)->first();
            if ($entity === null) {
                throw new AccountingError('receipt_identity_conflict');
            }
            if ($fiscal !== null && $entity->fiscal_id !== null && $entity->fiscal_id !== $fiscal) {
                throw new AccountingError('receipt_identity_conflict');
            }
            if ($fiscal !== null && $entity->fiscal_id === null) {
                $this->repository->query('receipt_entities')->where('id', $id)->update(['fiscal_id' => $fiscal]);
            }
        }
        foreach ($keys as $key) {
            if (! $this->repository->query('receipt_entity_keys')->where('chain', 'coto')->where('identity_key', $key)->exists()) {
                $this->repository->insert('receipt_entity_keys', ['chain' => 'coto', 'identity_key' => $key, 'receipt_id' => $id], false);
            }
        }

        return $id;
    }

    public function correction(string $hash, string $rows, string $key, string $recordedAt, ProcessingBudget $budget): array
    {
        if (! preg_match('/^[a-f0-9]{64}$/D', $hash)) {
            throw new AccountingError('invalid_hash');
        }
        $revision = $this->repository->query('source_revisions')->where('kind', 'receipt')->where('document_hash', $hash)->orderByDesc('ordinal')->first();
        abort_if($revision === null, 404);
        $facts = $this->facts($revision->id);
        $original = $this->readObject($facts['originalRowsObject']['sha256']);

        return $this->import(['key' => $key, 'bytes' => $this->readObject($hash), 'rowsText' => $original, 'correctedRowsText' => $rows, 'scale' => $facts['scale'], 'recordedAt' => $recordedAt, 'appRevision' => config('tarjetas.revision')], $budget);
    }

    public function import(array $input, ProcessingBudget $budget): array
    {
        if (trim($input['key']) === '' || trim((string) $input['appRevision']) === '') {
            throw new AccountingError('invalid_source_metadata');
        }
        if (strlen($input['bytes']) > 41943040) {
            throw new AccountingError('too_large');
        }
        if (! str_starts_with($input['bytes'], '%PDF-')) {
            throw new AccountingError('not_pdf');
        }
        $hash = hash('sha256', $input['bytes']);
        $corrected = $input['correctedRowsText'] ?? null;
        $key = 'receipt-import:'.rawurlencode($input['key']);
        $commandDigest = FinancialCommands::digest(['documentHash' => $hash, 'correctedRowsText' => $corrected]);
        $saved = $this->repository->query('source_import_commands')->where('key', $key)->first();
        if ($saved !== null) {
            if ($saved->digest !== $commandDigest) {
                throw new AccountingError('command_conflict');
            }
            $result = [...json_decode($saved->result, true), 'postedJournalIds' => [], 'duplicate' => true];
            $facts = $this->facts($result['sourceRevisionId']);
            if ($corrected === null && ($accepted = $this->acceptedForHash($hash)) !== null) {
                return ['sourceRevisionId' => $accepted['revisionId'], 'receiptId' => $accepted['receiptId'], 'purchaseIds' => [], 'postedJournalIds' => [], 'reviews' => [], 'duplicate' => true];
            }
            if (! $facts['report']['ok']) {
                throw new ReceiptRejected(['report' => $facts['report'], 'rowsText' => $this->readObject(($facts['correctedRowsObject'] ?? $facts['originalRowsObject'])['sha256']), 'sha256' => $hash, 'scale' => $facts['scale'], 'sourceRevisionId' => $result['sourceRevisionId'], 'receiptId' => $result['receiptId']]);
            }

            return $result;
        }
        if ($corrected === null && ($accepted = $this->acceptedForHash($hash)) !== null) {
            return $this->repository->transaction(function () use ($accepted, $key, $commandDigest, $budget) {
                $saved = $this->repository->query('source_import_commands')->where('key', $key)->first();
                if ($saved !== null && $saved->digest !== $commandDigest) {
                    throw new AccountingError('command_conflict');
                }
                $result = ['sourceRevisionId' => $accepted['revisionId'], 'receiptId' => $accepted['receiptId'], 'purchaseIds' => [], 'postedJournalIds' => [], 'reviews' => [], 'duplicate' => true];
                if ($saved === null) {
                    $budget->assertNonOcr();
                    $this->repository->insert('source_import_commands', ['key' => $key, 'digest' => $commandDigest, 'result' => LedgerRepository::json($result)]);
                }

                return $result;
            });
        }
        $extraction = app(ReceiptExtraction::class)->rows($corrected ?? $input['rowsText'], $budget);
        $parsed = $extraction['parsed'];
        $report = $extraction['report'];
        $fiscal = $parsed['header']['fiscalNumber'] ? 'coto:'.$parsed['header']['fiscalNumber'] : null;
        $rawPayload = ['parsed' => $parsed, 'report' => $report, 'scale' => $input['scale'], 'originalRowsText' => $input['rowsText'], 'correctedRowsText' => $corrected];
        $digest = SourceIdentity::payloadDigest((object) $rawPayload);
        $sourceKey = LedgerRepository::json($fiscal !== null ? ['receipt', 'fiscal', $fiscal] : ['receipt', 'sha256', $hash]);
        $revisionId = 'source:receipt:'.$hash.':'.$digest;
        $objects = [
            'document' => $this->documents->put($this->repository->ledger, $input['bytes']),
            'extraction' => $this->documents->put($this->repository->ledger, LedgerRepository::json($rawPayload)),
            'original' => $this->documents->put($this->repository->ledger, $input['rowsText']),
        ];
        if ($corrected !== null) {
            $objects['corrected'] = $this->documents->put($this->repository->ledger, $corrected);
        }
        $result = $this->repository->transaction(function () use ($input, $budget, $hash, $sourceKey, $revisionId, $digest, $objects, $rawPayload, $parsed, $report, $fiscal, $key, $commandDigest) {
            $saved = $this->repository->query('source_import_commands')->where('key', $key)->first();
            if ($saved !== null) {
                if ($saved->digest !== $commandDigest) {
                    throw new AccountingError('command_conflict');
                }

                return [...json_decode($saved->result, true), 'postedJournalIds' => [], 'duplicate' => true];
            }
            $duplicate = $this->repository->query('source_revisions')->where('kind', 'receipt')->where('document_hash', $hash)->where('payload_digest', $digest)->first();
            if ($duplicate !== null) {
                $facts = $this->facts($duplicate->id);

                $result = ['sourceRevisionId' => $duplicate->id, 'receiptId' => $facts['receiptId'], 'purchaseIds' => [], 'postedJournalIds' => [], 'reviews' => [], 'duplicate' => true];
                $budget->assertNonOcr();
                $this->repository->insert('source_import_commands', ['key' => $key, 'digest' => $commandDigest, 'result' => LedgerRepository::json($result)]);

                return $result;
            }
            $identityKeys = ['sha256:'.$hash];
            if ($report['ok'] && $fiscal !== null) {
                $identityKeys[] = 'fiscal:'.$fiscal;
            }
            $receiptIds = $this->repository->query('receipt_entity_keys')->where('chain', 'coto')->whereIn('identity_key', $identityKeys)->distinct()->pluck('receipt_id')->all();
            if (count($receiptIds) > 1) {
                throw new AccountingError('receipt_identity_conflict');
            }
            $previous = $receiptIds === [] ? null : $this->repository->query('source_revisions')->where('kind', 'receipt')->whereIn('id', $this->repository->query('receipt_facts')->where('receipt_id', $receiptIds[0])->select('revision_id'))->orderByDesc('ordinal')->first();
            if ($previous !== null) {
                $sourceKey = $previous->source_key;
            } else {
                $previous = $this->repository->query('source_revisions')->where('kind', 'receipt')->where('source_key', $sourceKey)->orderByDesc('ordinal')->first();
            }
            $priorAccepted = $this->repository->query('source_revisions')->where('source_key', $sourceKey)->whereRaw("payload->>'admission'='accepted'")->first();
            $admission = ! $report['ok'] ? 'rejected' : (($priorAccepted !== null || ($parsed['footer']['totalCents'] ?? 0) <= 0) ? 'pending' : 'accepted');
            $previousFacts = $previous === null ? null : $this->facts($previous->id);
            $receiptId = $this->entity($hash, $report['ok'] ? $fiscal : null, $previousFacts['receiptId'] ?? null);
            foreach ($objects as $object) {
                $this->object($object);
            }
            $payload = ['id' => $revisionId, 'kind' => 'receipt', 'cardId' => null, 'documentHash' => $hash, 'rawPayload' => $rawPayload, 'sourceKey' => $sourceKey, 'previousRevisionId' => $previous?->id, 'recordedAt' => $input['recordedAt'], 'admission' => $admission, 'appRevision' => $input['appRevision']];
            $this->repository->insert('evidence', ['id' => $revisionId, 'kind' => 'receipt', 'metadata' => LedgerRepository::json($payload)]);
            $this->repository->insert('source_revisions', ['id' => $revisionId, 'source_key' => $sourceKey, 'kind' => 'receipt', 'card_id' => null, 'document_hash' => $hash, 'raw_object_hash' => $objects['extraction']['sha256'], 'previous_revision_id' => $previous?->id, 'recorded_at' => $input['recordedAt'], 'payload_digest' => $digest, 'app_revision' => $input['appRevision'], 'payload' => LedgerRepository::json($payload)]);
            foreach ($objects as $name => $object) {
                $this->reference('object', $revisionId.':'.$name, $object);
            }
            foreach (['original' => $input['rowsText'], 'corrected' => $input['correctedRowsText'] ?? null] as $name => $text) {
                if ($text === null) {
                    continue;
                }
                $pending = 'receipt-'.hash('sha256', $revisionId.':'.$name);
                $object = $this->documents->put($this->repository->ledger, $text, $pending);
                $this->reference('pending', $pending, $object);
            }
            $facts = ['revisionId' => $revisionId, 'receiptId' => $receiptId, 'chain' => 'coto', 'fiscalId' => $fiscal, 'date' => $parsed['header']['date'], 'totalMinor' => $parsed['footer']['totalCents'], 'parsed' => $parsed, 'report' => $report, 'scale' => $input['scale'], 'originalRowsObject' => $objects['original'], 'correctedRowsObject' => $objects['corrected'] ?? null];
            $this->repository->insert('receipt_facts', ['revision_id' => $revisionId, 'receipt_id' => $receiptId, 'chain' => 'coto', 'fiscal_id' => $fiscal, 'receipt_date' => is_string($facts['date']) && preg_match('/^\d{4}-\d{2}-\d{2}$/D', $facts['date']) && checkdate((int) substr($facts['date'], 5, 2), (int) substr($facts['date'], 8, 2), (int) substr($facts['date'], 0, 4)) ? $facts['date'] : null, 'total_minor' => $facts['totalMinor'], 'original_rows_hash' => $objects['original']['sha256'], 'corrected_rows_hash' => $objects['corrected']['sha256'] ?? null, 'payload' => LedgerRepository::json($facts)]);
            foreach ($parsed['items'] as $index => $item) {
                $id = SourceIdentity::line($revisionId, $index + 1);
                $this->repository->insert('evidence', ['id' => $id, 'kind' => 'receipt', 'metadata' => LedgerRepository::json(['revisionId' => $revisionId, 'occurrence' => $index + 1])]);
                $this->repository->insert('source_lines', ['id' => $id, 'revision_id' => $revisionId, 'occurrence' => $index + 1, 'payload' => LedgerRepository::json($item), 'legacy_fingerprint' => null]);
            }
            $result = ['sourceRevisionId' => $revisionId, 'receiptId' => $receiptId, 'purchaseIds' => [], 'postedJournalIds' => [], 'reviews' => [], 'duplicate' => false];
            if ($admission === 'accepted') {
                (new ReceiptProducts($this->repository))->matchReceipt($revisionId);
                $reconciled = (new ReceiptReconciliation($this))->reconcile(['key' => 'import:'.$input['key'], 'receiptRevisionId' => $revisionId, 'cardId' => null, 'paymentVerified' => false, 'purchaseId' => null, 'allocation' => null, 'recordedAt' => $input['recordedAt']]);
                $result = [...$reconciled, 'receiptId' => $receiptId];
            } else {
                $code = ! $report['ok'] ? 'verification_failed' : ($priorAccepted !== null ? 'receipt_revision_requires_review' : 'unsupported_financial_nature');
                $this->appendReview($revisionId, $code, $input['recordedAt']);
                $result['reviews'][] = ['code' => $code, 'params' => (object) [], 'sourceLineIds' => []];
            }
            $budget->assertNonOcr();
            $this->repository->insert('source_import_commands', ['key' => $key, 'digest' => $commandDigest, 'result' => LedgerRepository::json($result)]);

            return $result;
        });
        if (! $report['ok']) {
            throw new ReceiptRejected(['report' => $report, 'rowsText' => $corrected ?? $input['rowsText'], 'sha256' => $hash, 'scale' => $input['scale'], 'sourceRevisionId' => $result['sourceRevisionId'], 'receiptId' => $result['receiptId']]);
        }

        return $result;
    }

    public function appendReview(string $revision, string $code, string $recordedAt, array $params = []): void
    {
        $this->repository->insert('review_events', ['id' => Str::uuid()->toString(), 'subject_id' => $revision, 'prior_decision_id' => null, 'code' => $code, 'params' => LedgerRepository::json((object) $params), 'source_line_ids' => '[]', 'state' => 'open', 'recorded_at' => $recordedAt]);
    }
}
