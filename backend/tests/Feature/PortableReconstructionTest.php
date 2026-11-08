<?php

namespace Tests\Feature;

use App\Domain\Evidence\DocumentStore;
use App\Domain\Evidence\StatementImporter;
use App\Domain\Ledger\LedgerRepository;
use App\Domain\Recovery\PortableReconstruction;
use App\Models\Ledger;
use App\Support\PrivateRoots;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Tests\PostgresTestCase;

class PortableReconstructionTest extends PostgresTestCase
{
    private function input(string $mode): array
    {
        $root = PrivateRoots::canonical((string) config('tarjetas.test_target.temp_root')).'/portable-'.bin2hex(random_bytes(8));
        mkdir($root, 0700);
        $pdf = 'synthetic_visa_2026_02.pdf';
        $json = 'visa.json';
        $raw = file_get_contents(base_path('../docs/rebuild/fixtures/visa.expected.json'));
        $parsed = json_decode($raw, true);
        file_put_contents($root.'/'.$pdf, file_get_contents(base_path('../docs/rebuild/fixtures/pdf/'.$pdf)));
        file_put_contents($root.'/'.$json, $raw);
        chmod($root.'/'.$pdf, 0600);
        chmod($root.'/'.$json, 0600);
        $objects = [];
        foreach ([$pdf, $json] as $path) {
            $objects[] = ['path' => $path, 'sha256' => hash_file('sha256', $root.'/'.$path), 'bytes' => filesize($root.'/'.$path)];
        }
        $rows = [['table' => 'statements', 'sourceId' => '1', 'payload' => ['id' => 1, 'closing_date' => '2026-02-01']], ['table' => 'schema_migrations', 'sourceId' => '9', 'payload' => ['version' => 9, 'object' => (object) [], 'array' => [], 'recordedAt' => 'literal-preserved']]];
        foreach ($parsed['transactions'] as $i => $transaction) {
            $rows[] = ['table' => 'transactions', 'sourceId' => (string) ($i + 1), 'payload' => $transaction];
        }
        $expected = [];
        foreach (['ARS' => 10000, 'USD' => 500] as $currency => $minor) {
            $expected['synthetic-card/'.$currency.'/'.($mode === 'opening' ? 'equity:opening' : 'expense:unallocated')] = (string) $minor;
            $expected['synthetic-card/'.$currency.'/synthetic-card:'.$currency.':billed'] = (string) -$minor;
            if ($mode === 'historical') {
                $expected['synthetic-card/'.$currency.'/synthetic-card:'.$currency.':unbilled'] = '0';
            }
        }
        $input = ['format' => 'tarjetas-portable-synthetic-v1', 'mode' => $mode, 'cutoffDate' => '2026-02-01', 'cards' => [['id' => 'synthetic-card', 'displayName' => 'Synthetic card']], 'rows' => $rows, 'objects' => $objects, 'statements' => [['source' => ['table' => 'statements', 'sourceId' => '1'], 'cardId' => 'synthetic-card', 'pdfPath' => $pdf, 'jsonPath' => $json, 'lines' => [['source' => ['table' => 'transactions', 'sourceId' => '1'], 'occurrence' => 1], ['source' => ['table' => 'transactions', 'sourceId' => '2'], 'occurrence' => 2]]]], 'openings' => [], 'expectedNative' => $expected];
        if ($mode === 'opening') {
            foreach (['ARS' => 10000, 'USD' => 500] as $currency => $minor) {
                $input['openings'][] = ['statementSource' => ['table' => 'statements', 'sourceId' => '1'], 'cardId' => 'synthetic-card', 'currency' => $currency, 'observationDate' => '2026-02-01', 'billedMinor' => $minor, 'unbilledMinor' => 0, 'supportingPaths' => [$pdf, $json], 'obligations' => []];
            }
        }
        $manifest = $root.'/manifest.json';
        file_put_contents($manifest, json_encode($input, JSON_THROW_ON_ERROR));
        chmod($manifest, 0600);

        return [$manifest, $input];
    }

    public function test_two_owner_reconstruction_retains_original_shapes_objects_maps_parity_and_idempotency(): void
    {
        foreach (['historical', 'opening'] as $mode) {
            [$manifest,$input] = $this->input($mode);
            $before = hash_file('sha256', $manifest);
            $r = new LedgerRepository(Ledger::factory()->create());
            $service = new PortableReconstruction($r, app(DocumentStore::class));
            $report = $service->execute($manifest);
            $this->assertSame(4, $report['retainedRows']);
            $this->assertSame(3, $report['retainedObjects']);
            $this->assertSame(3, $report['mappedRows']);
            $this->assertSame([], $report['unexplainedDifferences']);
            $this->assertSame($mode === 'historical', $report['complete']);
            $this->assertSame($mode === 'historical' ? 2 : 0, $r->query('purchases')->count());
            $this->assertSame($mode === 'historical' ? 4 : 2, $r->query('journals')->count());
            $this->assertTrue($service->execute($manifest)['duplicate']);
            $this->assertSame($before, hash_file('sha256', $manifest));
            $schema = json_decode($r->query('legacy_rows')->where('table_name', 'schema_migrations')->value('payload'));
            $this->assertInstanceOf(\stdClass::class, $schema->object);
            $this->assertSame([], $schema->array);
            $this->assertSame('literal-preserved', $schema->recordedAt);
            foreach ($r->query('legacy_objects')->get() as $object) {
                $ref = $r->query('object_references')->where('reference_id', $object->object_reference_id)->first();
                $bytes = app(DocumentStore::class)->read($r->ledger, $ref->sha256, (int) $ref->byte_length);
                $this->assertSame($object->sha256, hash('sha256', $bytes));
            }
            if ($mode === 'opening') {
                $this->assertFalse($report['completeHistoricalCoverage']);
                $this->assertContains('opening_is_not_complete_history', array_column($report['unresolved'], 'code'));
            }
            $owners[] = $r;
        }
        $a = $owners[0];
        $b = $owners[1];
        $row = $b->query('legacy_rows')->first();
        $a->transaction(function () use ($a, $row) {
            DB::statement('SAVEPOINT foreign_reconstruction');
            try {
                $a->insert('legacy_id_map', ['run_id' => $row->run_id, 'table_name' => $row->table_name, 'source_id' => $row->source_id, 'target_kind' => 'source_revision', 'target_id' => $a->query('source_revisions')->value('id')]);
                $this->fail('Cross-owner reconstruction map accepted');
            } catch (QueryException $e) {
                $this->assertSame('23503', $e->errorInfo[0]);
                DB::statement('ROLLBACK TO SAVEPOINT foreign_reconstruction');
            }
        });
    }

    public function test_corrupt_paths_inconsistent_mappings_and_unsupported_opening_roll_back_all_admission(): void
    {
        foreach (['corrupt', 'path', 'mapping', 'opening'] as $case) {
            [$manifest,$input] = $this->input($case === 'opening' ? 'opening' : 'historical');
            if ($case === 'corrupt') {
                $input['objects'][0]['sha256'] = str_repeat('0', 64);
            } elseif ($case === 'path') {
                $input['objects'][0]['path'] = '../unsafe.pdf';
            } elseif ($case === 'mapping') {
                $input['rows'][2]['payload']['ars'] = 999;
            } else {
                $input['openings'][0]['billedMinor']++;
            }
            file_put_contents($manifest, json_encode($input));
            $r = new LedgerRepository(Ledger::factory()->create());
            try {
                (new PortableReconstruction($r, app(DocumentStore::class)))->execute($manifest);
                $this->fail('Invalid reconstruction accepted');
            } catch (\RuntimeException $error) {
                $this->assertContains($error->getMessage(), ['reconstruction_object_integrity', 'unsafe_reconstruction_path', 'legacy_line_mapping_mismatch', 'unsupported_opening_evidence']);
            }
            $this->assertSame(0, $r->query('reconstruction_runs')->count());
            $this->assertSame(0, $r->query('journals')->count());
            $this->assertSame(0, $r->query('object_references')->count());
        }
    }

    public function test_verified_receipt_principal_supports_opening_installments_without_fabricating_an_acquisition(): void
    {
        config(['tarjetas.python' => base_path('.venv/bin/python')]);
        [$manifest,$input] = $this->input('opening');
        $root = dirname($manifest);
        $raw = json_decode(file_get_contents($root.'/visa.json'), true);
        $raw['declared_totals'] = [];
        $raw['transactions'][0]['ars'] = 65;
        $raw['transactions'][0]['installment_number'] = 1;
        $raw['transactions'][0]['installment_count'] = 2;
        file_put_contents($root.'/visa.json', json_encode($raw));
        $input['rows'][2]['payload'] = $raw['transactions'][0];
        $input['objects'][1]['sha256'] = hash_file('sha256', $root.'/visa.json');
        $input['objects'][1]['bytes'] = filesize($root.'/visa.json');
        foreach (['receipt.pdf' => 'pdf/synthetic_coto.pdf', 'receipt.rows.txt' => 'receipt-valid.rows.txt'] as $file => $fixture) {
            file_put_contents($root.'/'.$file, file_get_contents(base_path('../docs/rebuild/fixtures/'.$fixture)));
            chmod($root.'/'.$file, 0600);
            $input['objects'][] = ['path' => $file, 'sha256' => hash_file('sha256', $root.'/'.$file), 'bytes' => filesize($root.'/'.$file)];
        }
        $input['rows'][] = ['table' => 'receipts', 'sourceId' => '1', 'payload' => ['id' => 1, 'date' => '2026-01-15', 'total_cents' => 13000]];
        $input['openings'][0]['unbilledMinor'] = 6500;
        $input['openings'][0]['obligations'] = [['originalPrincipalMinor' => 13000, 'alreadyBilledMinor' => 6500, 'remainingMinor' => 6500, 'purchaseDate' => '2026-01-15', 'lastBilledInstallment' => 1, 'installmentCount' => 2, 'allocations' => [['purposeId' => 'unallocated', 'minor' => 6500]], 'principalEvidence' => ['pdfPath' => 'receipt.pdf', 'rowsPath' => 'receipt.rows.txt', 'statementOccurrence' => 1, 'fundingConfirmed' => true, 'source' => ['table' => 'receipts', 'sourceId' => '1']]]];
        $input['expectedNative']['synthetic-card/ARS/equity:opening'] = '16500';
        $input['expectedNative']['synthetic-card/ARS/synthetic-card:ARS:unbilled'] = '-6500';
        file_put_contents($manifest, json_encode($input));
        $r = new LedgerRepository(Ledger::factory()->create());
        $report = (new PortableReconstruction($r, app(DocumentStore::class)))->execute($manifest);
        $this->assertFalse($report['complete']);
        $this->assertSame([], $report['unexplainedDifferences']);
        $this->assertSame(0, $r->query('purchases')->count());
        $this->assertSame(1, $r->query('opening_obligations')->count());
        $this->assertSame(1, $r->query('receipt_entities')->count());
        $raw['period']['closing_date'] = '2026-03-01';
        $raw['transactions'] = [$raw['transactions'][0]];
        $raw['transactions'][0]['installment_number'] = 2;
        $result = (new StatementImporter($r, app(DocumentStore::class)))->import(['key' => 'later-opening-bill', 'cardId' => 'synthetic-card', 'filename' => 'synthetic_visa_2026_03.pdf', 'pdf' => file_get_contents($root.'/synthetic_visa_2026_02.pdf')."\n%synthetic-later-opening-bill", 'rawJson' => json_encode($raw), 'recordedAt' => '2026-03-02T00:00:00Z', 'appRevision' => 'synthetic-opening']);
        $this->assertSame([], $result['purchaseIds']);
        $this->assertCount(1, $result['postedJournalIds']);
        $this->assertSame(0, $r->query('purchases')->count());
        $this->assertSame(3, $r->query('journals')->count());
    }
}
