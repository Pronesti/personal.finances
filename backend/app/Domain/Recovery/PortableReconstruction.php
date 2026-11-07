<?php

namespace App\Domain\Recovery;

use App\Domain\Evidence\DocumentStore;
use App\Domain\Evidence\ReceiptService;
use App\Domain\Evidence\SourceIdentity;
use App\Domain\Evidence\StatementImporter;
use App\Domain\Ledger\CatalogBootstrap;
use App\Domain\Ledger\FinancialCommands;
use App\Domain\Ledger\LedgerRepository;
use App\Domain\Ledger\Money;
use App\Domain\Processing\ProcessingBudget;
use App\Support\PrivateRoots;
use Brick\Math\BigInteger;
use RuntimeException;

/** Portable, extracted synthetic source rehearsal; retained originals never imply financial approval. */
class PortableReconstruction
{
    public function __construct(private LedgerRepository $repository, private DocumentStore $documents) {}

    private function path(string $root, string $relative): string
    {
        if ($relative === '' || str_contains($relative, '\\') || str_starts_with($relative, '/') || array_any(explode('/', $relative), fn ($part) => in_array($part, ['', '.', '..'], true))) {
            throw new RuntimeException('unsafe_reconstruction_path');
        }
        $path = $root.'/'.$relative;
        if (realpath($path) !== $path || is_link($path) || ! is_file($path) || filesize($path) > 67108864) {
            throw new RuntimeException('unsafe_reconstruction_path');
        }

        return $path;
    }

    private function object(string $run, string $name, string $bytes): array
    {
        $object = $this->documents->put($this->repository->ledger, $bytes);
        $reference = $run.':'.hash('sha256', $name);
        $this->repository->insert('object_references', ['kind' => 'object', 'reference_id' => $reference, ...$object]);
        $this->repository->insert('legacy_objects', ['run_id' => $run, 'source_path' => $name, 'sha256' => $object['sha256'], 'byte_length' => $object['byte_length'], 'object_reference_id' => $reference]);

        return $object;
    }

    public function execute(string $manifest): array
    {
        $temp = PrivateRoots::canonical((string) config('tarjetas.test_target.temp_root'));
        if (! str_starts_with($manifest, $temp.'/') || realpath($manifest) !== $manifest || is_link($manifest) || ! is_file($manifest) || filesize($manifest) > 16777216) {
            throw new RuntimeException('synthetic_portable_manifest_required');
        }
        $root = dirname($manifest);
        $bytes = file_get_contents($manifest);
        $input = json_decode($bytes, true, flags: JSON_THROW_ON_ERROR);
        validator($input, ['format' => ['required', 'in:tarjetas-portable-synthetic-v1'], 'mode' => ['required', 'in:historical,opening'], 'cutoffDate' => ['required', 'date_format:Y-m-d'], 'cards' => ['required', 'array', 'min:1', 'max:100'], 'cards.*.id' => ['required', 'string', 'max:200', 'distinct'], 'cards.*.displayName' => ['required', 'string', 'max:200'], 'rows' => ['present', 'array', 'max:100000'], 'rows.*.table' => ['required', 'string', 'in:statements,transactions,upcoming_installments,alerts,alert_reviews,category_rules,category_proposals,rejected_merchants,merchant_aliases,receipts,receipt_items,receipt_discounts,receipt_transcripts,products,product_codes,product_rules,product_matches,receipt_charge_links,schema_migrations'], 'rows.*.sourceId' => ['required', 'string', 'max:1000'], 'rows.*.payload' => ['present', 'array'], 'objects' => ['present', 'array', 'max:10000'], 'objects.*.path' => ['required', 'string', 'max:1000', 'distinct'], 'objects.*.sha256' => ['required', 'regex:/^[a-f0-9]{64}$/D'], 'objects.*.bytes' => ['required', 'integer', 'min:0', 'max:67108864'], 'statements' => ['present', 'array', 'max:1000'], 'openings' => ['present', 'array', 'max:200']])->validate();
        $originalRows = json_decode($bytes, flags: JSON_THROW_ON_ERROR)->rows;
        $sourceDigest = hash('sha256', $bytes);
        $configuration = FinancialCommands::digest(['source' => $sourceDigest, 'revision' => config('tarjetas.revision')]);
        $run = 'reconstruction:'.$configuration;
        $objects = [];
        $size = 0;
        foreach ($input['objects'] as $object) {
            $path = $this->path($root, $object['path']);
            $size += filesize($path);
            if ($size > 536870912 || filesize($path) !== $object['bytes'] || ! hash_equals(hash_file('sha256', $path), $object['sha256'])) {
                throw new RuntimeException('reconstruction_object_integrity');
            }$objects[$object['path']] = [...$object, 'file' => $path];
        }

        return $this->repository->transaction(function () use ($input, $manifest, $bytes, $run, $sourceDigest, $configuration, $objects, $originalRows) {
            $existing = $this->repository->query('reconstruction_reports')->where('run_id', $run)->value('payload');
            if ($existing !== null) {
                return [...json_decode($existing, true), 'duplicate' => true];
            }
            if ($this->repository->query('journals')->exists() || $this->repository->query('source_revisions')->exists() || $this->repository->query('reconstruction_runs')->exists()) {
                throw new RuntimeException('reconstruction_requires_empty_ledger');
            }
            $this->repository->insert('reconstruction_runs', ['id' => $run, 'source_digest' => $sourceDigest, 'configuration_digest' => $configuration, 'cutoff_date' => $input['cutoffDate'], 'mode' => $input['mode'], 'created_at' => now()->toIso8601String()]);
            $rows = [];
            $unresolved = [];
            foreach ($input['rows'] as $index => $row) {
                $original = $originalRows[$index]->payload;
                $key = LedgerRepository::json([$row['table'], $row['sourceId']]);
                if (isset($rows[$key])) {
                    throw new RuntimeException('duplicate_legacy_identity');
                }$rows[$key] = $row;
                $this->repository->insert('legacy_rows', ['run_id' => $run, 'table_name' => $row['table'], 'source_id' => $row['sourceId'], 'row_hash' => hash('sha256', SourceIdentity::canonical($original)), 'payload' => LedgerRepository::json($original), 'disposition' => 'retained', 'reason' => 'Original retained; financial and operational acceptance separate']);
            }
            $this->object($run, '@portable-manifest', $bytes);
            foreach ($objects as $name => $object) {
                $this->object($run, $name, file_get_contents($object['file']));
            }
            app(CatalogBootstrap::class)->initialize($this->repository, $input['cards']);
            $mapped = [];
            $observations = [];
            $map = function (array $source, string $kind, string $target) use (&$mapped, $rows, $run) {
                $key = LedgerRepository::json([$source['table'] ?? null, $source['sourceId'] ?? null]);
                if (! isset($rows[$key])) {
                    throw new RuntimeException('missing_legacy_mapping_source');
                }$mapped[$key] = true;
                $this->repository->insert('legacy_id_map', ['run_id' => $run, 'table_name' => $source['table'], 'source_id' => $source['sourceId'], 'target_kind' => $kind, 'target_id' => $target]);
            };
            $statements = $input['statements'];
            foreach ($statements as $statement) {
                if (! isset($objects[$statement['pdfPath'] ?? ''],$objects[$statement['jsonPath'] ?? '']) || ($statement['source']['table'] ?? null) !== 'statements') {
                    throw new RuntimeException('invalid_portable_statement');
                }
            }usort($statements, fn ($a, $b) => strcmp(json_decode(file_get_contents($objects[$a['jsonPath']]['file']), true)['period']['closing_date'], json_decode(file_get_contents($objects[$b['jsonPath']]['file']), true)['period']['closing_date']));
            foreach ($statements as $i => $statement) {
                if (! isset($objects[$statement['pdfPath'] ?? ''],$objects[$statement['jsonPath'] ?? '']) || ! is_string($statement['cardId'] ?? null) || ! is_array($statement['source'] ?? null)) {
                    throw new RuntimeException('invalid_portable_statement');
                }
                $raw = file_get_contents($objects[$statement['jsonPath']]['file']);
                $json = json_decode($raw, true, flags: JSON_THROW_ON_ERROR);
                $closing = $json['period']['closing_date'] ?? null;
                if (! is_string($closing) || $closing > $input['cutoffDate']) {
                    $unresolved[] = ['source' => $statement['source'], 'code' => 'source_outside_cutoff'];

                    continue;
                }
                $result = (new StatementImporter($this->repository, $this->documents))->import(['key' => $run.':statement:'.$i, 'cardId' => $statement['cardId'], 'filename' => basename($statement['pdfPath']), 'pdf' => file_get_contents($objects[$statement['pdfPath']]['file']), 'rawJson' => $raw, 'recordedAt' => now()->toIso8601String(), 'appRevision' => config('tarjetas.revision'), 'observationOnly' => $input['mode'] === 'opening']);
                $map($statement['source'], 'source_revision', $result['sourceRevisionId']);
                foreach ($statement['lines'] ?? [] as $line) {
                    if (($line['source']['table'] ?? null) !== 'transactions') {
                        throw new RuntimeException('legacy_line_mapping_mismatch');
                    }$target = $this->repository->query('source_lines')->where('revision_id', $result['sourceRevisionId'])->where('occurrence', $line['occurrence'] ?? 0)->first();
                    if ($target === null) {
                        throw new RuntimeException('legacy_line_mapping_mismatch');
                    }$key = LedgerRepository::json([$line['source']['table'] ?? null, $line['source']['sourceId'] ?? null]);
                    $original = $rows[$key]['payload'] ?? null;
                    $parsed = json_decode($target->payload, true);
                    if (! is_array($original)) {
                        throw new RuntimeException('missing_legacy_mapping_source');
                    }
                    foreach (['section', 'description', 'date', 'ars', 'usd', 'installment_count', 'installment_number'] as $field) {
                        if (($original[$field] ?? null) !== ($parsed[$field] ?? null)) {
                            throw new RuntimeException('legacy_line_mapping_mismatch');
                        }
                    }$map($line['source'], 'source_line', $target->id);
                }
                foreach ($result['reviews'] as $review) {
                    $unresolved[] = $review;
                }
                $observations[] = ['source' => $statement['source'], 'cardId' => $statement['cardId'], 'json' => $json, 'revision' => $result['sourceRevisionId']];
            }
            if ($input['mode'] === 'historical' && $input['openings'] !== []) {
                throw new RuntimeException('opening_proof_requires_opening_mode');
            }
            $seen = [];
            $openingEvidence = [];
            $usedReceipts = [];
            foreach ($input['openings'] as $opening) {
                validator($opening, ['cardId' => ['required', 'string'], 'currency' => ['required', 'in:ARS,USD'], 'observationDate' => ['required', 'date_format:Y-m-d'], 'billedMinor' => ['required', 'integer', 'min:0'], 'unbilledMinor' => ['required', 'integer', 'min:0'], 'supportingPaths' => ['required', 'array', 'min:1'], 'statementSource' => ['required', 'array'], 'obligations' => ['present', 'array']])->validate();
                $key = $opening['cardId'].':'.$opening['currency'];
                if (isset($seen[$key])) {
                    throw new RuntimeException('ambiguous_opening_evidence');
                }$seen[$key] = true;
                $candidates = array_values(array_filter($observations, fn ($o) => $o['cardId'] === $opening['cardId']));
                usort($candidates, fn ($a, $b) => strcmp($b['json']['period']['closing_date'], $a['json']['period']['closing_date']));
                $latest = $candidates[0] ?? null;
                $field = $opening['currency'] === 'ARS' ? 'current_ars' : 'current_usd';
                if ($latest === null || $latest['source'] !== $opening['statementSource'] || $latest['json']['period']['closing_date'] !== $opening['observationDate'] || ! isset($latest['json']['balances'][$field]) || Money::source($latest['json']['balances'][$field]) !== $opening['billedMinor']) {
                    throw new RuntimeException('unsupported_opening_evidence');
                }
                foreach ($opening['supportingPaths'] as $path) {
                    if (! isset($objects[$path])) {
                        throw new RuntimeException('unsupported_opening_evidence');
                    }
                }
                $proofIds = [];
                foreach ($opening['obligations'] as $obligation) {
                    $proof = $obligation['principalEvidence'] ?? null;
                    if (! is_array($proof) || ($proof['fundingConfirmed'] ?? false) !== true || ! isset($objects[$proof['pdfPath'] ?? ''],$objects[$proof['rowsPath'] ?? '']) || ! is_int($obligation['installmentCount'] ?? null) || $obligation['installmentCount'] < 2 || $obligation['installmentCount'] > 240 || ! is_int($obligation['lastBilledInstallment'] ?? null) || $obligation['lastBilledInstallment'] < 1 || $obligation['lastBilledInstallment'] >= $obligation['installmentCount']) {
                        throw new RuntimeException('unsupported_opening_principal');
                    }
                    $receipts = new ReceiptService($this->repository, $this->documents);
                    $retained = $receipts->import(['key' => $run.':principal:'.$objects[$proof['pdfPath']]['sha256'], 'bytes' => file_get_contents($objects[$proof['pdfPath']]['file']), 'rowsText' => file_get_contents($objects[$proof['rowsPath']]['file']), 'scale' => 3, 'recordedAt' => now()->toIso8601String(), 'appRevision' => config('tarjetas.revision')], new ProcessingBudget(719000, 0));
                    $facts = $receipts->facts($retained['sourceRevisionId']);
                    if ($facts === null || ! $facts['report']['ok'] || isset($usedReceipts[$facts['receiptId']]) || $facts['totalMinor'] !== ($obligation['originalPrincipalMinor'] ?? null) || $facts['date'] !== ($obligation['purchaseDate'] ?? null)) {
                        throw new RuntimeException('unsupported_opening_principal');
                    }
                    $usedReceipts[$facts['receiptId']] = true;
                    $line = $this->repository->query('source_lines')->where('revision_id', $latest['revision'])->where('occurrence', $proof['statementOccurrence'] ?? 0)->first();
                    $printed = $line === null ? null : json_decode($line->payload, true);
                    $parts = array_map(fn ($i) => intdiv($facts['totalMinor'], $obligation['installmentCount']) + ($i < $facts['totalMinor'] % $obligation['installmentCount'] ? 1 : 0), range(0, $obligation['installmentCount'] - 1));
                    if ($printed === null || ($printed['installment_count'] ?? null) !== $obligation['installmentCount'] || ($printed['installment_number'] ?? null) !== $obligation['lastBilledInstallment'] || ! is_string($printed['date'] ?? null) || abs((new \DateTimeImmutable($printed['date']))->diff(new \DateTimeImmutable($facts['date']))->days) > 3 || Money::source($printed[$opening['currency'] === 'ARS' ? 'ars' : 'usd'] ?? 0) !== $parts[$obligation['lastBilledInstallment'] - 1] || array_sum(array_slice($parts, 0, $obligation['lastBilledInstallment'])) !== ($obligation['alreadyBilledMinor'] ?? null) || array_sum(array_slice($parts, $obligation['lastBilledInstallment'])) !== ($obligation['remainingMinor'] ?? null)) {
                        throw new RuntimeException('unsupported_opening_principal');
                    }
                    $proofIds[] = $retained['sourceRevisionId'];
                    $proofIds[] = $line->id;
                    if (isset($proof['source'])) {
                        $map($proof['source'], 'source_revision', $retained['sourceRevisionId']);
                    }
                }
                $supported = array_sum(array_column($opening['obligations'], 'remainingMinor'));
                if ($supported !== $opening['unbilledMinor']) {
                    throw new RuntimeException('unsupported_opening_principal');
                }
                $evidence = $run.':opening:'.$key;
                $this->repository->insert('evidence', ['id' => $evidence, 'kind' => 'statement', 'metadata' => LedgerRepository::json(['sourceRevision' => $latest['revision'], 'supportingPaths' => $opening['supportingPaths'], 'proof' => $opening])]);
                $total = Money::minor($opening['billedMinor'] + $opening['unbilledMinor']);
                if ($total === 0) {
                    continue;
                }
                $journal = $evidence.':journal';
                $lines = [['accountId' => 'equity:opening', 'debitMinor' => $total, 'creditMinor' => 0, 'purchaseId' => null, 'purposeId' => null]];
                foreach (['billed', 'unbilled'] as $part) {
                    $amount = $opening[$part.'Minor'];
                    if ($amount > 0) {
                        $lines[] = ['accountId' => $opening['cardId'].':'.$opening['currency'].':'.$part, 'debitMinor' => 0, 'creditMinor' => $amount, 'purchaseId' => null, 'purposeId' => null];
                    }
                }
                $commands = new FinancialCommands($this->repository);
                $commands->post(['id' => $journal, 'commandKey' => $journal, 'cardId' => $opening['cardId'], 'currency' => $opening['currency'], 'effectiveDate' => $opening['observationDate'], 'recordedAt' => now()->toIso8601String(), 'kind' => 'opening', 'reversesId' => null, 'evidenceIds' => [$evidence], 'lines' => $lines]);
                if ($opening['billedMinor'] > 0) {
                    $this->repository->appendBilling(['id' => $journal, 'journalId' => $journal, 'purchaseId' => null, 'origin' => 'opening_balance', 'cardId' => $opening['cardId'], 'currency' => $opening['currency'], 'installment' => 1, 'amountMinor' => $opening['billedMinor'], 'effectiveDate' => $opening['observationDate'], 'purchaseDate' => $opening['observationDate'], 'components' => [['id' => $journal.':billed', 'purposeId' => null, 'minor' => $opening['billedMinor']]]]);
                }
                foreach ($opening['obligations'] as $i => $obligation) {
                    $commands->registerOpening([...$obligation, 'id' => $run.':obligation:'.$key.':'.$i, 'cardId' => $opening['cardId'], 'currency' => $opening['currency'], 'openingJournalId' => $journal, 'evidenceIds' => [$evidence, $latest['revision'], ...$proofIds]]);
                }
                $openingEvidence[] = $key;
                $unresolved[] = ['code' => 'opening_is_not_complete_history', 'cardId' => $opening['cardId'], 'currency' => $opening['currency']];
                if ($opening['observationDate'] !== $input['cutoffDate']) {
                    $unresolved[] = ['code' => 'cutoff_activity_not_reconciled', 'cardId' => $opening['cardId']];
                }
            }
            foreach ($rows as $key => $row) {
                if (! isset($mapped[$key]) && $row['table'] !== 'schema_migrations') {
                    $unresolved[] = ['source' => ['table' => $row['table'], 'sourceId' => $row['sourceId']], 'code' => 'retained_operation_requires_review'];
                }
            }
            $actual = $this->repository->query('legacy_rows')->where('run_id', $run)->get();
            foreach ($actual as $row) {
                if (! hash_equals($row->row_hash, hash('sha256', SourceIdentity::canonical(json_decode($row->payload))))) {
                    throw new RuntimeException('retention_digest_mismatch');
                }
            }
            $native = $this->native();
            $expected = $input['expectedNative'] ?? null;
            $differences = [];
            if ($expected === null) {
                $unresolved[] = ['code' => 'native_parity_not_supplied'];
            } elseif (FinancialCommands::digest($expected) !== FinancialCommands::digest($native)) {
                $differences[] = ['code' => 'native_report_difference', 'expected' => $expected, 'actual' => $native];
            }
            if ($input['mode'] === 'opening' && $openingEvidence === []) {
                $unresolved[] = ['code' => 'opening_balance_not_proven'];
            }
            foreach ($objects as $object) {
                if (hash_file('sha256', $object['file']) !== $object['sha256']) {
                    throw new RuntimeException('source_changed_during_reconstruction');
                }
            }
            if (hash_file('sha256', $manifest) !== $sourceDigest) {
                throw new RuntimeException('source_changed_during_reconstruction');
            }
            $report = ['runId' => $run, 'sourceDigest' => $sourceDigest, 'configurationDigest' => $configuration, 'mode' => $input['mode'], 'cutoffDate' => $input['cutoffDate'], 'retainedRows' => count($rows), 'retainedObjects' => count($objects) + 1, 'mappedRows' => count($mapped), 'unresolved' => $unresolved, 'unexplainedDifferences' => $differences, 'native' => $native, 'openingCoverage' => $openingEvidence, 'coverageScope' => 'supplied portable corpus only', 'completeHistoricalCoverage' => $input['mode'] === 'historical' && $unresolved === [] && $differences === [], 'complete' => $input['mode'] === 'historical' && $unresolved === [] && $differences === [], 'duplicate' => false];
            $this->repository->insert('reconstruction_reports', ['run_id' => $run, 'payload' => LedgerRepository::json($report)]);

            return $report;
        });
    }

    private function native(): array
    {
        $result = [];
        foreach ($this->repository->query('journals')->where('status', 'posted')->pluck('id') as $id) {
            $journal = $this->repository->journal($id);
            foreach ($journal['lines'] as $line) {
                $key = $journal['cardId'].'/'.$journal['currency'].'/'.$line['accountId'];
                $result[$key] = (string) BigInteger::of($result[$key] ?? 0)->plus($line['debitMinor'])->minus($line['creditMinor']);
            }
        }ksort($result, SORT_STRING);

        return $result;
    }
}
