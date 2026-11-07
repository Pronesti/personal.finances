<?php

namespace Tests\Postgres;

use App\Domain\Evidence\DocumentStore;
use App\Domain\Evidence\SourceIdentity;
use App\Domain\Evidence\StatementImporter;
use App\Domain\Ledger\AccountingError;
use App\Domain\Ledger\CatalogBootstrap;
use App\Domain\Ledger\LedgerRepository;
use App\Models\Ledger;
use Illuminate\Support\Facades\DB;
use Tests\PostgresTestCase;

class StatementAdmissionTest extends PostgresTestCase
{
    private function fresh(): array
    {
        $repository = new LedgerRepository(Ledger::factory()->create());
        app(CatalogBootstrap::class)->initialize($repository, json_decode(file_get_contents(base_path('../docs/rebuild/fixtures/cards.json')), true));

        return [$repository, new StatementImporter($repository, app(DocumentStore::class))];
    }

    private function input(string $brand, string $card): array
    {
        $raw = file_get_contents(base_path('../docs/rebuild/fixtures/'.$brand.'.expected.json'));
        $json = json_decode($raw);

        return ['key' => 'synthetic:shared-command', 'cardId' => $card, 'filename' => $json->file, 'pdf' => file_get_contents(base_path('../docs/rebuild/fixtures/pdf/'.$json->file)), 'rawJson' => $raw, 'recordedAt' => '2026-02-02T12:00:00Z', 'appRevision' => 'synthetic-acceptance'];
    }

    public function test_source_digest_and_fingerprint_vectors_remain_frozen(): void
    {
        $vectors = json_decode(file_get_contents(base_path('../docs/rebuild/fixtures/identity-vectors.json')));
        $json = json_decode(file_get_contents(base_path('../docs/rebuild/fixtures/visa.expected.json')));
        $this->assertSame($vectors->sourcePayloadDigest->sha256, SourceIdentity::payloadDigest($json));
        $line = $vectors->fingerprints->input;
        $this->assertSame($vectors->fingerprints->first, SourceIdentity::fingerprint($line->brand, $line, 1));
        $this->assertSame($vectors->fingerprints->second, SourceIdentity::fingerprint($line->brand, $line, 2));
    }

    public function test_all_three_statement_import_fixtures_per_owner_preserve_evidence_native_balances_and_renamed_replay(): void
    {
        $outcomes = json_decode(file_get_contents(base_path('../docs/rebuild/fixtures/outcomes.json')), true)['imports'];
        DB::beginTransaction();
        try {
            foreach (['a', 'b'] as $owner) {
                foreach (['visa' => 'synthetic-visa-a', 'mastercard' => 'synthetic-mastercard', 'mercadopago' => 'synthetic-mp'] as $brand => $card) {
                    [$repository, $importer] = $this->fresh();
                    $input = $this->input($brand, $card);
                    $result = $importer->import($input);
                    $expected = $outcomes[$brand];
                    $this->assertCount($expected['purchases'], $result['purchaseIds']);
                    $this->assertCount($expected['journals'], $result['postedJournalIds']);
                    $this->assertSame($expected['reviewCodes'], array_column($result['reviews'], 'code'));
                    foreach (['ARS', 'USD'] as $currency) {
                        if (! isset($expected[$currency])) {
                            continue;
                        }
                        $balance = DB::selectOne("SELECT COALESCE(sum(CASE WHEN a.type='expense' THEN l.debit_minor-l.credit_minor ELSE 0 END),0) AS expense,COALESCE(sum(CASE WHEN a.id=? THEN l.credit_minor-l.debit_minor ELSE 0 END),0) AS billed,COALESCE(sum(CASE WHEN a.id=? THEN l.credit_minor-l.debit_minor ELSE 0 END),0) AS unbilled,COALESCE(sum(CASE WHEN a.id=? THEN l.debit_minor-l.credit_minor ELSE 0 END),0) AS clearing FROM accounting.journal_lines l JOIN accounting.journals j ON j.ledger_id=l.ledger_id AND j.id=l.journal_id JOIN accounting.accounts a ON a.ledger_id=l.ledger_id AND a.id=l.account_id WHERE l.ledger_id=? AND j.currency=? AND j.status='posted'", [$card.':'.$currency.':billed', $card.':'.$currency.':unbilled', 'clearing:'.$currency.':unresolved-source', $repository->ledger->id, $currency]);
                        $this->assertSame($expected[$currency], ['expenseMinor' => (int) $balance->expense, 'billedMinor' => (int) $balance->billed, 'unbilledMinor' => (int) $balance->unbilled, 'clearingMinor' => (int) $balance->clearing]);
                    }
                    $extracted = json_decode($input['rawJson']);
                    $lines = $repository->query('source_lines')->where('revision_id', $result['sourceRevisionId'])->orderBy('occurrence')->get()->map(fn ($row) => json_decode($row->payload))->all();
                    $this->assertEquals($extracted->transactions, $lines);
                    $replay = $importer->import([...$input, 'key' => 'renamed', 'filename' => 'renamed_2026.pdf']);
                    $this->assertTrue($replay['duplicate']);
                    $this->assertSame($result['sourceRevisionId'], $replay['sourceRevisionId']);
                    $this->assertSame([], $replay['postedJournalIds']);
                    $this->assertSame($expected['journals'], $repository->query('journals')->count());
                    $this->assertSame(1, $repository->query('source_revisions')->count());
                    $changed = json_decode($input['rawJson']);
                    $changed->transactions[0]->description .= ' REVISED';
                    $pending = $importer->import([...$input, 'key' => 'revised', 'rawJson' => json_encode($changed)]);
                    $this->assertContains('source_revision_requires_review', array_column($pending['reviews'], 'code'));
                    $this->assertSame([], $pending['postedJournalIds']);
                    $this->assertSame('accepted', json_decode($repository->query('source_revisions')->where('id', $result['sourceRevisionId'])->value('payload'))->admission);
                }
            }
        } finally {
            DB::rollBack();
        }
    }

    public function test_same_document_cannot_switch_actual_cards_and_importer_pending_does_not_post(): void
    {
        DB::beginTransaction();
        try {
            [$repository, $importer] = $this->fresh();
            $input = $this->input('visa', 'synthetic-visa-a');
            $importer->import($input);
            try {
                $importer->import([...$input, 'cardId' => 'synthetic-visa-b', 'key' => 'other-card']);
                $this->fail('Identical statement document changed card');
            } catch (AccountingError $error) {
                $this->assertSame('document_identity_conflict', $error->errorCode);
            }
            $this->assertSame(4, $repository->query('journals')->count());
            foreach (['totals', 'unsupported'] as $case) {
                [$other, $separate] = $this->fresh();
                $json = json_decode($input['rawJson']);
                if ($case === 'totals') {
                    $json->declared_totals[0]->ars = 100.01;
                } else {
                    $json->brand = 'unsupported';
                }
                $result = $separate->import([...$input, 'rawJson' => json_encode($json)]);
                $this->assertSame($case === 'totals' ? 'statement_totals_conflict' : 'unsupported_statement_layout', $result['reviews'][0]['code']);
                $this->assertSame(0, $other->query('journals')->count());
                $this->assertSame('pending', json_decode($other->query('source_revisions')->first()->payload)->admission);
            }
        } finally {
            DB::rollBack();
        }
    }
}
