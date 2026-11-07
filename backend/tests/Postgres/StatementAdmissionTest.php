<?php

namespace Tests\Postgres;

use App\Domain\Evidence\DocumentStore;
use App\Domain\Evidence\SourceIdentity;
use App\Domain\Evidence\StatementImporter;
use App\Domain\Ledger\AccountingError;
use App\Domain\Ledger\CatalogBootstrap;
use App\Domain\Ledger\FinancialCommands;
use App\Domain\Ledger\LedgerRepository;
use App\Models\Ledger;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
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

    public function test_supported_costs_post_without_purchase_and_uncertain_tax_recovery_stays_in_review(): void
    {
        foreach (['a', 'b'] as $owner) {
            [$repository, $importer] = $this->fresh();
            $input = $this->input('visa', 'synthetic-visa-a');
            $raw = json_decode($input['rawJson']);
            $raw->declared_totals = [];
            $raw->transactions = [];
            foreach ([['INTERESES FINANCIACION', 10], ['COMISION SERVICIO', 5], ['IVA PERCEPCION', 3]] as [$description, $amount]) {
                $raw->transactions[] = (object) ['section' => 'taxes_and_charges', 'date' => '2026-01-31', 'description' => $description, 'ars' => $amount, 'usd' => null, 'installment_number' => null, 'installment_count' => null, 'raw_line' => $description];
            }
            $result = $importer->import([...$input, 'rawJson' => json_encode($raw)]);
            $this->assertCount(2, $result['postedJournalIds']);
            $this->assertSame([], $result['purchaseIds']);
            $this->assertSame(['tax_recoverability_review'], array_column($result['reviews'], 'code'));
            $journals = $repository->query('journals')->pluck('id')->map(fn ($id) => $repository->journal($id))->all();
            $this->assertSame(['cost', 'cost'], array_column($journals, 'kind'));
            $this->assertSame(1500, array_sum(array_map(fn ($journal) => $journal['lines'][0]['debitMinor'], $journals)));
            $replay = $importer->import([...$input, 'rawJson' => json_encode($raw)]);
            $this->assertTrue($replay['duplicate']);
            $this->assertSame(2, $repository->query('journals')->count());
        }
    }

    public function test_statement_matches_supported_opening_installment_by_owned_original_evidence_without_acquisition(): void
    {
        foreach (['a', 'b'] as $owner) {
            [$repository, $importer] = $this->fresh();
            $input = $this->input('visa', 'synthetic-visa-a');
            $raw = json_decode($input['rawJson']);
            $raw->declared_totals = [];
            $raw->transactions = [(object) ['section' => 'purchases', 'date' => '2026-01-15', 'description' => 'SYNTHETIC OPENING PLAN', 'voucher' => 'original', 'ars' => 200, 'usd' => null, 'installment_number' => 1, 'installment_count' => 6, 'raw_line' => 'SYNTHETIC OPENING PLAN 01/06 200,00']];
            $original = $importer->import([...$input, 'rawJson' => json_encode($raw), 'observationOnly' => true]);
            $line = SourceIdentity::line($original['sourceRevisionId'], 1);
            $commands = new FinancialCommands($repository);
            $openingId = Str::uuid()->toString();
            $commands->post(['id' => $openingId, 'commandKey' => 'opening', 'cardId' => 'synthetic-visa-a', 'currency' => 'ARS', 'effectiveDate' => '2026-02-28', 'recordedAt' => '2026-02-28T12:00:00Z', 'kind' => 'opening', 'reversesId' => null, 'evidenceIds' => [$line], 'lines' => [['accountId' => 'equity:opening', 'debitMinor' => 100000, 'creditMinor' => 0, 'purchaseId' => null, 'purposeId' => null], ['accountId' => 'synthetic-visa-a:ARS:unbilled', 'debitMinor' => 0, 'creditMinor' => 100000, 'purchaseId' => null, 'purposeId' => null]]]);
            $commands->registerOpening(['id' => 'opening:shared', 'cardId' => 'synthetic-visa-a', 'currency' => 'ARS', 'openingJournalId' => $openingId, 'purchaseDate' => '2026-01-15', 'originalPrincipalMinor' => 120000, 'alreadyBilledMinor' => 20000, 'remainingMinor' => 100000, 'lastBilledInstallment' => 1, 'installmentCount' => 6, 'evidenceIds' => [$line], 'allocations' => [['accountId' => 'expense:food:groceries:pantry', 'purposeId' => 'food', 'minor' => 100000]]]);
            $raw->period->closing_date = '2026-03-01';
            $raw->transactions[0]->installment_number = 2;
            $raw->transactions[0]->voucher = 'later-cycle';
            $later = [...$input, 'key' => 'later', 'pdf' => $input['pdf']."\n% later synthetic cycle", 'rawJson' => json_encode($raw)];
            $result = $importer->import($later);
            $this->assertSame([], $result['purchaseIds']);
            $this->assertSame([], $result['reviews']);
            $this->assertCount(1, $result['postedJournalIds']);
            $this->assertSame('billing', $repository->journal($result['postedJournalIds'][0])['kind']);
            $this->assertSame(0, $repository->query('purchases')->count());
            $this->assertSame('opening:shared', $repository->payloads('billings')[0]['openingObligationId']);
            $this->assertTrue($importer->import($later)['duplicate']);
            $this->assertSame(2, $repository->query('journals')->count());
        }
    }
}
