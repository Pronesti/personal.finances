<?php

namespace Tests\Postgres;

use App\Domain\Evidence\DocumentStore;
use App\Domain\Evidence\HistoricalAssociations;
use App\Domain\Evidence\HistoricalRefund;
use App\Domain\Evidence\ReceiptProducts;
use App\Domain\Evidence\ReceiptReconciliation;
use App\Domain\Evidence\ReceiptRejected;
use App\Domain\Evidence\ReceiptService;
use App\Domain\Evidence\SourceIdentity;
use App\Domain\Evidence\StatementImporter;
use App\Domain\Ledger\AccountingError;
use App\Domain\Ledger\CatalogBootstrap;
use App\Domain\Ledger\FinancialCommands;
use App\Domain\Ledger\LedgerRepository;
use App\Domain\Processing\ProcessingBudget;
use App\Domain\Reports\FinancialFacts;
use App\Domain\Reports\ReportCalculator;
use App\Domain\Reports\ReportSnapshot;
use App\Domain\Reviews\MerchantReviews;
use App\Domain\Reviews\SourceClassification;
use App\Models\Ledger;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\PostgresTestCase;

class ReceiptWorkflowsTest extends PostgresTestCase
{
    private function setupLedger(): array
    {
        config(['tarjetas.python' => base_path('.venv/bin/python'), 'tarjetas.revision' => 'receipt-acceptance']);
        $repository = new LedgerRepository(Ledger::factory()->create());
        app(CatalogBootstrap::class)->initialize($repository, json_decode(file_get_contents(base_path('../docs/rebuild/fixtures/cards.json')), true));
        $service = new ReceiptService($repository, app(DocumentStore::class));

        return [$repository, $service, new ReceiptReconciliation($service)];
    }

    private function input(string $transcript = 'receipt-valid.rows.txt'): array
    {
        return ['key' => 'synthetic:shared-receipt', 'bytes' => file_get_contents(base_path('../docs/rebuild/fixtures/pdf/synthetic_coto.pdf')), 'rowsText' => file_get_contents(base_path('../docs/rebuild/fixtures/'.$transcript)), 'correctedRowsText' => null, 'scale' => 3, 'recordedAt' => '2026-01-16T12:00:00Z', 'appRevision' => 'receipt-acceptance'];
    }

    private function statement(LedgerRepository $repository, bool $observationOnly = false, ?string $closingDate = null, array $transaction = []): array
    {
        $raw = json_decode(file_get_contents(base_path('../docs/rebuild/fixtures/visa.expected.json')));
        $raw->transactions = [(object) ['section' => 'purchases', 'block' => 1, 'block_cardholder' => 'SYNTHETIC HOLDER', 'date' => '2026-01-15', 'description' => 'COTO SYNTHETIC', 'voucher' => '123456', 'ars' => 130, 'usd' => null, 'installment_number' => null, 'installment_count' => null, 'raw_line' => '15-ene-26 COTO SYNTHETIC 123456 130,00']];
        $raw->declared_totals = [];
        if ($closingDate !== null) {
            $raw->period->closing_date = $closingDate;
        }
        $raw->transactions[0] = (object) [...get_object_vars($raw->transactions[0]), ...$transaction];
        $suffix = $closingDate === null && $transaction === [] ? '' : hash('sha256', LedgerRepository::json([$closingDate, $transaction]));

        return (new StatementImporter($repository, app(DocumentStore::class)))->import(['key' => 'coto-statement'.$suffix, 'cardId' => 'synthetic-visa-a', 'filename' => 'synthetic_visa_2026_02.pdf', 'pdf' => file_get_contents(base_path('../docs/rebuild/fixtures/pdf/synthetic_visa_2026_02.pdf')).($suffix === '' ? '' : "\n% synthetic statement seam ".$suffix), 'rawJson' => json_encode($raw), 'recordedAt' => '2026-02-02T12:00:00Z', 'appRevision' => 'receipt-acceptance', 'observationOnly' => $observationOnly]);
    }

    private function expense(LedgerRepository $repository): int
    {
        return (int) DB::selectOne("SELECT COALESCE(sum(l.debit_minor-l.credit_minor),0) AS amount FROM accounting.journal_lines l JOIN accounting.accounts a ON a.ledger_id=l.ledger_id AND a.id=l.account_id WHERE l.ledger_id=? AND a.type='expense'", [$repository->ledger->id])->amount;
    }

    public function test_rejection_commits_evidence_correction_retains_both_transcripts_and_reuses_identity(): void
    {
        [$repository,$service] = $this->setupLedger();
        $input = $this->input('receipt-one-cent-error.rows.txt');
        try {
            $service->import($input, new ProcessingBudget(719000, 0));
            $this->fail('One cent error accepted');
        } catch (ReceiptRejected $rejected) {
            $payload = $rejected->receiptPayload;
        }
        $this->assertSame(0, $repository->query('journals')->count());
        $this->assertSame(1, $repository->query('receipt_facts')->count());
        $rejected = $service->facts($payload['sourceRevisionId']);
        $corrected = $service->correction(hash('sha256', $input['bytes']), file_get_contents(base_path('../docs/rebuild/fixtures/receipt-corrected.rows.txt')), 'corrected', '2026-01-17T12:00:00Z', new ProcessingBudget(719000, 0));
        $this->assertSame($rejected['receiptId'], $corrected['receiptId']);
        $accepted = $service->facts($corrected['sourceRevisionId']);
        $this->assertTrue($accepted['report']['ok']);
        $this->assertSame($payload['sourceRevisionId'], $service->source($corrected['sourceRevisionId'])['previousRevisionId']);
        $this->assertSame($input['rowsText'], $service->readObject($accepted['originalRowsObject']['sha256']));
        $this->assertSame(file_get_contents(base_path('../docs/rebuild/fixtures/receipt-corrected.rows.txt')), $service->readObject($accepted['correctedRowsObject']['sha256']));
        $this->assertSame(0, $repository->query('journals')->count());
        $this->assertContains('receipt_payment_unresolved', array_column($corrected['reviews'], 'code'));
        $count = $repository->query('source_revisions')->count();
        $this->assertTrue($service->import($input, new ProcessingBudget(719000, 0))['duplicate']);
        $this->assertSame($count, $repository->query('source_revisions')->count());
    }

    public function test_frozen_receipt_first_and_statement_first_converge_per_owner_without_duplicate_expense(): void
    {
        DB::beginTransaction();
        try {
            foreach (['a', 'b'] as $owner) {
                foreach (['receipt-first', 'statement-first'] as $order) {
                    [$repository,$service,$reconciliation] = $this->setupLedger();
                    if ($order === 'statement-first') {
                        $this->statement($repository);
                    }
                    $receipt = $service->import($this->input(), new ProcessingBudget(719000, 0));
                    $revision = $receipt['sourceRevisionId'];
                    if ($order === 'receipt-first') {
                        $this->assertSame(0, $repository->query('journals')->count());
                        $funded = $reconciliation->reconcile(['key' => 'fund', 'receiptRevisionId' => $revision, 'cardId' => 'synthetic-visa-a', 'paymentVerified' => true, 'purchaseId' => null, 'allocation' => null, 'expectedPreviousDecisionId' => null, 'recordedAt' => '2026-01-17T12:00:00Z']);
                        $this->assertCount(1, $funded['purchaseIds']);
                    }
                    $this->assertSame(13000, $this->expense($repository));
                    $products = new ReceiptProducts($repository);
                    foreach ([1, 2] as $occurrence) {
                        $line = SourceIdentity::line($revision, $occurrence);
                        $match = $products->latest('product_match_revisions', 'id', $line);
                        $product = $products->product($match['productId']);
                        $products->decide(['key' => 'product:'.$occurrence, 'kind' => 'product_update', 'subjectId' => $product['id'], 'payload' => ['name' => $product['name'], 'category' => $occurrence === 1 ? 'pantry' : 'personal_care', 'unit' => 'un'], 'recordedAt' => '2026-01-17T12:00:00Z']);
                        $products->decide(['key' => 'approve:'.$occurrence, 'kind' => 'product_match', 'subjectId' => $line, 'payload' => ['productId' => $product['id']], 'recordedAt' => '2026-01-17T12:00:00Z']);
                    }
                    $allocation = [['sourceLineId' => SourceIdentity::line($revision, 1), 'accountId' => 'expense:food:groceries:pantry', 'purposeId' => 'food', 'minor' => 8000]];
                    $base = ['receiptRevisionId' => $revision, 'cardId' => 'synthetic-visa-a', 'paymentVerified' => true, 'purchaseId' => null, 'allocation' => null, 'recordedAt' => '2026-01-18T12:00:00Z'];
                    $partial = $reconciliation->reconcile([...$base, 'key' => 'partial', 'expectedPurchaseVersion' => $repository->purchase($reconciliation->latest($receipt['receiptId'])['purchaseId'])['version'], 'itemAllocations' => $allocation]);
                    $purchase = $repository->purchase($partial['purchaseIds'][0]);
                    $this->assertSame([8000, 5000], array_column($purchase['allocations'], 'minor'));
                    $this->assertSame('expense:unallocated', $purchase['allocations'][1]['accountId']);
                    $allocation[] = ['sourceLineId' => SourceIdentity::line($revision, 2), 'accountId' => 'expense:personal:hygiene', 'purposeId' => 'personal', 'minor' => 5000];
                    $reconciliation->reconcile([...$base, 'key' => 'full', 'expectedPurchaseVersion' => $purchase['version'], 'itemAllocations' => $allocation]);
                    if ($order === 'receipt-first') {
                        $this->statement($repository);
                    }
                    $this->assertSame(1, $repository->query('purchases')->count());
                    $this->assertSame(13000, $this->expense($repository));
                    $report = (new ReportSnapshot($repository))->read();
                    $this->assertSame(13000, array_sum(array_column(array_filter($report['facts'], fn ($fact) => $fact['kind'] === 'purchase'), 'minor')));
                    $this->assertSame(13000, array_sum(array_column(array_filter($report['facts'], fn ($fact) => $fact['kind'] === 'billing'), 'minor')));
                    $this->assertSame(13000, array_sum(array_column($report['allocations'], 'netMinor')));

                    $balances = DB::selectOne("SELECT sum(CASE WHEN account_id='synthetic-visa-a:ARS:billed' THEN credit_minor-debit_minor ELSE 0 END) AS billed,sum(CASE WHEN account_id='synthetic-visa-a:ARS:unbilled' THEN credit_minor-debit_minor ELSE 0 END) AS unbilled FROM accounting.journal_lines WHERE ledger_id=?", [$repository->ledger->id]);
                    $this->assertSame([13000, 0], [(int) $balances->billed, (int) $balances->unbilled]);
                    $replay = $service->import($this->input(), new ProcessingBudget(719000, 0));
                    $this->assertTrue($replay['duplicate']);
                    $this->assertSame(1, $repository->query('purchases')->count());
                }
            }
        } finally {
            DB::rollBack();
        }
    }

    public function test_unlink_before_statement_requires_review_then_explicit_relink_bills_original_purchase(): void
    {
        DB::beginTransaction();
        try {
            foreach (['a', 'b'] as $owner) {
                [$repository, $service, $links, $receipt, $base, $items, $purchaseId] = $this->allocatedReceipt();
                $active = $links->latest($receipt['receiptId']);
                $links->unlink(['key' => 'unlink-before-statement', 'receiptRevisionId' => $base['receiptRevisionId'], 'expectedPreviousDecisionId' => $active['id'], 'recordedAt' => $base['recordedAt']]);
                $unlinked = $links->latest($receipt['receiptId']);
                $journals = $repository->query('journals')->count();
                $statement = $this->statement($repository);
                $this->assertContains('receipt_purchase_unlinked', array_column($statement['reviews'], 'code'));
                $this->assertSame(1, $repository->query('purchases')->count());
                $this->assertSame(13000, $this->expense($repository));
                $this->assertSame($journals, $repository->query('journals')->count());
                $this->assertSame($unlinked['id'], $links->latest($receipt['receiptId'])['id']);
                $this->assertTrue($this->statement($repository)['duplicate']);
                $relinked = $links->reconcile([...$base, 'key' => 'explicit-relink', 'expectedPreviousDecisionId' => $unlinked['id'], 'expectedPurchaseVersion' => 2]);
                $this->assertSame([$purchaseId], $relinked['purchaseIds']);
                $this->assertEquals($items, $links->latest($receipt['receiptId'])['itemAllocations']);
                $this->assertSame($purchaseId, $repository->query('source_purchase_identities')->value('purchase_id'));
                $this->assertSame($journals + 1, $repository->query('journals')->count());
                $this->assertSame(13000, $this->expense($repository));
                $billed = DB::selectOne("SELECT sum(credit_minor-debit_minor) AS minor FROM accounting.journal_lines WHERE ledger_id=? AND account_id='synthetic-visa-a:ARS:billed'", [$repository->ledger->id]);
                $unbilled = DB::selectOne("SELECT sum(credit_minor-debit_minor) AS minor FROM accounting.journal_lines WHERE ledger_id=? AND account_id='synthetic-visa-a:ARS:unbilled'", [$repository->ledger->id]);
                $this->assertSame(13000, (int) $billed->minor);
                $this->assertSame(0, (int) $unbilled->minor);
                $this->assertSame('reviewed', $repository->query('review_events')->where('code', 'receipt_purchase_unlinked')->orderByDesc('ordinal')->value('state'));
                $this->assertTrue($links->reconcile([...$base, 'key' => 'explicit-relink', 'expectedPreviousDecisionId' => $unlinked['id'], 'expectedPurchaseVersion' => 2])['duplicate']);
                $this->assertSame($journals + 1, $repository->query('journals')->count());
            }
        } finally {
            DB::rollBack();
        }
    }

    public function test_receipt_origin_cannot_override_established_voucher_identity_across_cycles(): void
    {
        DB::beginTransaction();
        try {
            foreach (['a', 'b'] as $owner) {
                foreach (['distinct', 'same', 'conflicting', 'missing'] as $case) {
                    [$repository, $service, $links, $receipt, $base, $items, $purchaseId] = $this->allocatedReceipt();
                    $this->statement($repository);
                    $transaction = match ($case) {
                        'distinct' => ['voucher' => '654321'],
                        'same' => [],
                        'conflicting' => ['installment_number' => 1, 'installment_count' => 1],
                        'missing' => ['voucher' => null],
                    };
                    $result = $this->statement($repository, false, '2026-03-31', $transaction);
                    $line = SourceIdentity::line($result['sourceRevisionId'], 1);
                    $identity = $repository->query('source_purchase_identities')->where('source_line_id', $line)->value('purchase_id');
                    if ($case === 'distinct') {
                        $this->assertSame(2, $repository->query('purchases')->count());
                        $this->assertNotNull($identity);
                        $this->assertNotSame($purchaseId, $identity);
                        $this->assertSame(26000, $this->expense($repository));
                        $this->assertSame([], $result['reviews']);
                    } else {
                        $this->assertSame(1, $repository->query('purchases')->count());
                        $this->assertSame(13000, $this->expense($repository));
                        $this->assertSame($case === 'same' ? $purchaseId : null, $identity);
                        $this->assertContains(match ($case) {
                            'same' => 'conflicting_installment', 'conflicting' => 'voucher_facts_conflict', 'missing' => 'insufficient_identity_evidence'
                        }, array_column($result['reviews'], 'code'));
                    }
                    $this->assertSame($purchaseId, $links->latest($receipt['receiptId'])['purchaseId']);
                    $journals = $repository->query('journals')->count();
                    $this->assertTrue($this->statement($repository, false, '2026-03-31', $transaction)['duplicate']);
                    $this->assertSame($journals, $repository->query('journals')->count());
                }
            }
        } finally {
            DB::rollBack();
        }
    }

    public function test_negative_item_net_is_retained_rejected_and_correctable_without_poisoning_reports(): void
    {
        DB::beginTransaction();
        try {
            foreach (['a', 'b'] as $owner) {
                [$repository, $service, $links] = $this->setupLedger();
                $valid = $this->input();
                $sentinel = $service->import($valid, new ProcessingBudget(719000, 0));
                $links->reconcile(['key' => 'fund-sentinel', 'receiptRevisionId' => $sentinel['sourceRevisionId'], 'cardId' => 'synthetic-visa-a', 'paymentVerified' => true, 'purchaseId' => null, 'allocation' => null, 'recordedAt' => '2026-01-17T12:00:00Z']);
                $correctedRows = str_replace('9999-00000001', '9999-00000002', $valid['rowsText']);
                $rows = str_replace(['-20,00', '130,00'], ['-110,00', '40,00'], $correctedRows);
                $input = [...$valid, 'key' => 'negative-net', 'bytes' => $valid['bytes']."\n% synthetic negative item net", 'rowsText' => $rows];
                $journals = $repository->query('journals')->count();
                $previous = null;
                foreach ([false, true] as $replay) {
                    try {
                        $service->import($input, new ProcessingBudget(719000, 0));
                        $this->fail('Negative item net accepted');
                    } catch (ReceiptRejected $error) {
                        $result = $error->receiptPayload;
                    }
                    $this->assertSame(['item 1 has a negative net amount'], $result['report']['errors']);
                    $this->assertSame([true, true, true], array_column($result['report']['checks'], 'ok'));
                    $this->assertSame($rows, $result['rowsText']);
                    if ($replay) {
                        $this->assertSame($previous, $result['sourceRevisionId']);
                    }
                    $previous = $result['sourceRevisionId'];
                }
                $this->assertSame('rejected', $service->source($previous)['admission']);
                $this->assertSame($journals, $repository->query('journals')->count());
                $snapshot = (new ReportSnapshot($repository))->read();
                $this->assertCount(1, $snapshot['supermarket']['receipts']);
                $report = (new ReportCalculator)->calculate([...$snapshot, 'rates' => json_decode(file_get_contents(base_path('../docs/rebuild/fixtures/references.json')), true), 'scope' => ['basis' => 'purchase', 'value' => 'nominal', 'tax' => 'excl', 'granularity' => 'month', 'period' => null]], new ProcessingBudget(30000, 0));
                $this->assertEquals(130, $report['spending']['spending']['total']);
                $corrected = $service->correction($result['sha256'], $correctedRows, 'correct-negative', '2026-01-18T12:00:00Z', new ProcessingBudget(719000, 0));
                $this->assertSame($result['receiptId'], $corrected['receiptId']);
                $this->assertSame($previous, $service->source($corrected['sourceRevisionId'])['previousRevisionId']);
                $this->assertSame('accepted', $service->source($corrected['sourceRevisionId'])['admission']);
                $facts = $service->facts($corrected['sourceRevisionId']);
                $this->assertSame($rows, $service->readObject($facts['originalRowsObject']['sha256']));
                $this->assertSame($correctedRows, $service->readObject($facts['correctedRowsObject']['sha256']));
                $this->assertSame($journals, $repository->query('journals')->count());
                $this->assertCount(2, (new ReportSnapshot($repository))->read()['supermarket']['receipts']);
            }
        } finally {
            DB::rollBack();
        }
    }

    public function test_distinct_rejected_pdfs_do_not_share_unverified_fiscal_identity(): void
    {
        DB::beginTransaction();
        try {
            [$repository, $service] = $this->setupLedger();
            $invalid = $this->input('receipt-one-cent-error.rows.txt');
            $rejected = [];
            foreach (['a', 'b'] as $name) {
                $input = [...$invalid, 'key' => 'reject-'.$name, 'bytes' => $invalid['bytes']."\n% synthetic distinct receipt ".$name];
                try {
                    $service->import($input, new ProcessingBudget(719000, 0));
                    $this->fail('Invalid receipt accepted');
                } catch (ReceiptRejected $error) {
                    $rejected[$name] = $error->receiptPayload;
                }
            }
            $this->assertNotSame($rejected['a']['receiptId'], $rejected['b']['receiptId']);
            $this->assertSame(2, $repository->query('receipt_entities')->count());
            $this->assertSame(0, $repository->query('receipt_entity_keys')->where('identity_key', 'like', 'fiscal:%')->count());
            foreach (['a' => '9999-00000001', 'b' => '9999-00000002'] as $name => $fiscal) {
                $rows = str_replace('9999-00000001', $fiscal, $this->input()['rowsText']);
                $corrected = $service->correction($rejected[$name]['sha256'], $rows, 'correct-'.$name, '2026-02-01T12:00:00Z', new ProcessingBudget(719000, 0));
                $this->assertSame($rejected[$name]['receiptId'], $corrected['receiptId']);
                $source = $service->source($corrected['sourceRevisionId']);
                $this->assertSame('accepted', $source['admission']);
                $this->assertSame($rejected[$name]['sourceRevisionId'], $source['previousRevisionId']);
                $detail = $service->detail($corrected['receiptId']);
                $this->assertSame('coto:'.$fiscal, $detail['fiscalId']);
                $this->assertCount(2, $detail['history']);
                $this->assertSame($invalid['rowsText'], $service->readObject($detail['originalRowsObject']['sha256']));
                $this->assertSame($rows, $service->readObject($detail['correctedRowsObject']['sha256']));
                $this->assertTrue($service->correction($rejected[$name]['sha256'], $rows, 'correct-'.$name, '2026-02-02T12:00:00Z', new ProcessingBudget(719000, 0))['duplicate']);
            }
            $this->assertSame(0, $repository->query('journals')->count());
            [$other, $otherService] = $this->setupLedger();
            foreach ($rejected as $result) {
                $this->assertNull($otherService->detail($result['receiptId']));
                $this->assertNull($otherService->source($result['sourceRevisionId']));
            }
        } finally {
            DB::rollBack();
        }
    }

    public function test_historical_unverified_fiscal_key_does_not_bind_a_new_pdf(): void
    {
        DB::beginTransaction();
        try {
            [$repository, $service] = $this->setupLedger();
            $input = $this->input('receipt-one-cent-error.rows.txt');
            $store = app(DocumentStore::class);
            $pdf = $store->put($repository->ledger, $input['bytes']);
            $rows = $store->put($repository->ledger, $input['rowsText']);
            $sourceKey = LedgerRepository::json(['receipt', 'fiscal', 'coto:9999-00000001']);
            $source = ['id' => 'legacy-rejected', 'kind' => 'receipt', 'documentHash' => $pdf['sha256'], 'sourceKey' => $sourceKey, 'previousRevisionId' => null, 'recordedAt' => $input['recordedAt'], 'admission' => 'rejected', 'appRevision' => 'legacy-acceptance'];
            $repository->transaction(function () use ($repository, $pdf, $rows, $source, $sourceKey, $input) {
                $repository->insert('source_documents', $pdf);
                $repository->insert('source_documents', $rows);
                $rowId = Str::uuid()->toString();
                $repository->insert('receipt_entities', ['row_id' => $rowId, 'chain' => 'coto', 'fiscal_id' => null]);
                $id = (int) $repository->query('receipt_entities')->where('row_id', $rowId)->value('id');
                $repository->insert('receipt_entity_keys', ['chain' => 'coto', 'identity_key' => 'sha256:'.$pdf['sha256'], 'receipt_id' => $id], false);
                $repository->insert('evidence', ['id' => $source['id'], 'kind' => 'receipt', 'metadata' => LedgerRepository::json($source)]);
                $repository->insert('source_revisions', ['id' => $source['id'], 'source_key' => $sourceKey, 'kind' => 'receipt', 'document_hash' => $pdf['sha256'], 'previous_revision_id' => null, 'recorded_at' => $input['recordedAt'], 'payload_digest' => hash('sha256', 'legacy rejected receipt'), 'app_revision' => 'legacy-acceptance', 'payload' => LedgerRepository::json($source)]);
                $facts = ['revisionId' => $source['id'], 'receiptId' => $id, 'chain' => 'coto', 'fiscalId' => 'coto:9999-00000001', 'date' => '2026-01-15', 'totalMinor' => 13001, 'scale' => 3, 'originalRowsObject' => $rows, 'correctedRowsObject' => null, 'report' => ['ok' => false]];
                $repository->insert('receipt_facts', ['revision_id' => $source['id'], 'receipt_id' => $id, 'chain' => 'coto', 'fiscal_id' => $facts['fiscalId'], 'receipt_date' => $facts['date'], 'total_minor' => $facts['totalMinor'], 'original_rows_hash' => $rows['sha256'], 'payload' => LedgerRepository::json($facts)]);
            });
            $legacyId = $service->facts($source['id'])['receiptId'];
            $legacySource = $service->source($source['id']);
            $valid = $this->input();
            $new = $service->import([...$valid, 'key' => 'new-valid-pdf', 'bytes' => $valid['bytes']."\n% synthetic different history PDF"], new ProcessingBudget(719000, 0));
            $this->assertNotSame($legacyId, $new['receiptId']);
            $newSource = $service->source($new['sourceRevisionId']);
            $this->assertSame('accepted', $newSource['admission']);
            $this->assertNull($newSource['previousRevisionId']);
            $repaired = $service->correction($pdf['sha256'], str_replace('9999-00000001', '9999-00000002', $valid['rowsText']), 'repair-legacy', '2026-02-01T12:00:00Z', new ProcessingBudget(719000, 0));
            $this->assertSame($legacyId, $repaired['receiptId']);
            $this->assertSame('accepted', $service->source($repaired['sourceRevisionId'])['admission']);
            $this->assertSame($source['id'], $service->source($repaired['sourceRevisionId'])['previousRevisionId']);
            $this->assertSame($legacySource, $service->source($source['id']));
            $this->assertSame(2, $repository->query('receipt_entities')->count());
            $this->assertSame(0, $repository->query('journals')->count());
        } finally {
            DB::rollBack();
        }
    }

    public function test_fiscal_parse_failures_keep_a_linear_owned_receipt_correction_history(): void
    {
        DB::beginTransaction();
        try {
            foreach (['accepted', 'rejected'] as $initial) {
                [$repository, $service, $links] = $this->setupLedger();
                $valid = $this->input();
                $missing = str_replace(' NRO.T.:9999-00000001', '', $valid['rowsText']);
                $input = [...$valid, 'rowsText' => $initial === 'accepted' ? $valid['rowsText'] : $missing];
                try {
                    $first = $service->import($input, new ProcessingBudget(719000, 0));
                } catch (ReceiptRejected $error) {
                    $first = $error->receiptPayload;
                }
                $receiptId = $first['receiptId'];
                $accepted = $initial === 'accepted' ? $first['sourceRevisionId'] : null;
                $previous = $first['sourceRevisionId'];
                if ($initial === 'accepted') {
                    $links->reconcile(['key' => 'fund', 'receiptRevisionId' => $accepted, 'cardId' => 'synthetic-visa-a', 'paymentVerified' => true, 'purchaseId' => null, 'allocation' => null, 'recordedAt' => '2026-01-17T12:00:00Z']);
                    $copy = $service->import([...$valid, 'key' => 'same-fiscal-other-pdf', 'bytes' => $valid['bytes']."\n% synthetic same fiscal evidence"], new ProcessingBudget(719000, 0));
                    $this->assertSame($receiptId, $copy['receiptId']);
                    $previous = $copy['sourceRevisionId'];
                }
                $journals = $repository->query('journals')->get()->all();
                $hash = hash('sha256', $input['bytes']);
                $rows = [$missing, $this->input('receipt-one-cent-error.rows.txt')['rowsText'], str_replace('SYNTHETIC RICE', 'SYNTHETIC RICE RETRY', $missing), $valid['rowsText'], str_replace('SYNTHETIC RICE', 'SYNTHETIC RICE LATER', $missing), str_replace('SYNTHETIC RICE', 'SYNTHETIC RICE REVIEW', $valid['rowsText'])];
                foreach ($rows as $index => $text) {
                    $validCorrection = in_array($index, [3, 5], true);
                    try {
                        $result = $service->correction($hash, $text, 'fiscal-correction-'.$index, '2026-02-01T12:00:00Z', new ProcessingBudget(719000, 0));
                        $this->assertTrue($validCorrection);
                    } catch (ReceiptRejected $error) {
                        $this->assertFalse($validCorrection);
                        $result = $error->receiptPayload;
                        $this->assertFalse($result['report']['ok']);
                    }
                    $this->assertSame($receiptId, $result['receiptId']);
                    $source = $service->source($result['sourceRevisionId']);
                    $this->assertSame($previous, $source['previousRevisionId']);
                    $this->assertSame($validCorrection ? ($accepted === null ? 'accepted' : 'pending') : 'rejected', $source['admission']);
                    $facts = $service->facts($result['sourceRevisionId']);
                    $this->assertSame($input['rowsText'], $service->readObject($facts['originalRowsObject']['sha256']));
                    $this->assertSame($text, $service->readObject($facts['correctedRowsObject']['sha256']));
                    $this->assertSame($input['bytes'], $service->readObject($hash));
                    if ($source['admission'] === 'accepted') {
                        $accepted = $result['sourceRevisionId'];
                    }
                    if ($accepted !== null) {
                        $this->assertSame($accepted, $service->detail($receiptId)['revisionId']);
                    }
                    $previous = $result['sourceRevisionId'];
                    if ($initial === 'rejected' && $index === 3) {
                        $copy = $service->import([...$valid, 'key' => 'recovered-fiscal-other-pdf', 'bytes' => $valid['bytes']."\n% synthetic recovered fiscal evidence"], new ProcessingBudget(719000, 0));
                        $this->assertSame($receiptId, $copy['receiptId']);
                        $this->assertSame('pending', $service->source($copy['sourceRevisionId'])['admission']);
                        $this->assertSame($previous, $service->source($copy['sourceRevisionId'])['previousRevisionId']);
                        $previous = $copy['sourceRevisionId'];
                    }
                }
                $count = $repository->query('source_revisions')->count();
                $this->assertTrue($service->correction($hash, $rows[5], 'fiscal-correction-5', '2026-02-02T12:00:00Z', new ProcessingBudget(719000, 0))['duplicate']);
                $this->assertSame($count, $repository->query('source_revisions')->count());
                $this->assertEquals($journals, $repository->query('journals')->get()->all());
                [$other, $otherService] = $this->setupLedger();
                $this->assertNull($otherService->detail($receiptId));
                $this->assertNull($otherService->source($previous));
            }
        } finally {
            DB::rollBack();
        }
    }

    public function test_duplicate_corrections_reserve_keys_without_new_evidence_and_isolate_owners(): void
    {
        DB::beginTransaction();
        try {
            $digests = [];
            foreach (['a', 'b'] as $owner) {
                [$repository, $service] = $this->setupLedger();
                $input = $this->input();
                $service->import($input, new ProcessingBudget(719000, 0));
                $hash = hash('sha256', $input['bytes']);
                $rows = str_replace('SYNTHETIC RICE', 'SYNTHETIC RICE '.$owner, $input['rowsText']);
                $first = $service->correction($hash, $rows, 'first-correction', '2026-02-01T12:00:00Z', new ProcessingBudget(719000, 0));
                $revisions = $repository->query('source_revisions')->get()->all();
                $reviews = $repository->query('review_events')->get()->all();
                $journals = $repository->query('journals')->get()->all();
                $duplicate = $service->correction($hash, $rows, 'shared-duplicate-key', '2026-02-02T12:00:00Z', new ProcessingBudget(719000, 0));
                $this->assertTrue($duplicate['duplicate']);
                $this->assertSame($first['sourceRevisionId'], $duplicate['sourceRevisionId']);
                $this->assertSame([], $duplicate['postedJournalIds']);
                $record = $repository->query('source_import_commands')->where('key', 'receipt-import:shared-duplicate-key')->first();
                $this->assertNotNull($record);
                $digests[] = $record->digest;
                $this->assertEquals($duplicate, json_decode($record->result, true));
                $this->assertEquals($duplicate, $service->correction($hash, $rows, 'shared-duplicate-key', '2026-02-03T12:00:00Z', new ProcessingBudget(719000, 0)));
                $this->rejects('command_conflict', fn () => $service->correction($hash, str_replace('SYNTHETIC RICE', 'SYNTHETIC ALTERED RICE', $rows), 'shared-duplicate-key', '2026-02-04T12:00:00Z', new ProcessingBudget(719000, 0)));
                $this->assertEquals($revisions, $repository->query('source_revisions')->get()->all());
                $this->assertEquals($reviews, $repository->query('review_events')->get()->all());
                $this->assertEquals($journals, $repository->query('journals')->get()->all());
            }
            $this->assertNotSame($digests[0], $digests[1]);
        } finally {
            DB::rollBack();
        }
    }

    public function test_recovered_history_closes_only_resolved_receipt_reviews_and_preserves_audit(): void
    {
        DB::beginTransaction();
        try {
            [$repository, $service, $links] = $this->setupLedger();
            $this->statement($repository, false, '2026-03-01', ['ars' => 43.33, 'installment_number' => 2, 'installment_count' => 3]);
            $receipt = $service->import($this->input(), new ProcessingBudget(719000, 0));
            $base = ['receiptRevisionId' => $receipt['sourceRevisionId'], 'cardId' => 'synthetic-visa-a', 'paymentVerified' => true, 'purchaseId' => null, 'expectedPreviousDecisionId' => null, 'allocation' => null, 'recordedAt' => '2026-04-01T12:00:00Z'];
            $this->assertContains('missing_installment_history', array_column($links->reconcile([...$base, 'key' => 'too-early'])['reviews'], 'code'));
            $root = $repository->query('review_events')->where('subject_id', $receipt['sourceRevisionId'])->where('code', 'missing_installment_history')->first();
            $this->assertSame('open', $root->state);
            $repository->transaction(fn () => $service->appendReview($receipt['sourceRevisionId'], 'voucher_facts_conflict', $base['recordedAt'], ['source' => 'unrelated-conflict']));
            $this->statement($repository, false, '2026-02-01', ['ars' => 43.33, 'installment_number' => 1, 'installment_count' => 3]);
            $result = $links->reconcile([...$base, 'key' => 'recovered']);
            $this->assertSame([], $result['reviews']);
            $latest = $repository->query('review_events')->where('subject_id', $receipt['sourceRevisionId'])->where('code', 'missing_installment_history')->orderByDesc('ordinal')->first();
            $this->assertSame('reviewed', $latest->state);
            $this->assertSame($root->id, $latest->prior_decision_id);
            $this->assertSame('open', $repository->query('review_events')->where('id', $root->id)->value('state'));
            $this->assertSame('open', $repository->query('review_events')->where('subject_id', $receipt['sourceRevisionId'])->where('code', 'voucher_facts_conflict')->orderByDesc('ordinal')->value('state'));
            $reviews = $repository->query('review_events')->count();
            $this->assertTrue($links->reconcile([...$base, 'key' => 'recovered'])['duplicate']);
            $this->assertSame($reviews, $repository->query('review_events')->count());
        } finally {
            DB::rollBack();
        }
    }

    public function test_allocation_without_adoption_does_not_close_missing_history_review(): void
    {
        DB::beginTransaction();
        try {
            [$repository, $service, $links, $receipt, $base, $items, $purchaseId] = $this->allocatedReceipt();
            $this->statement($repository, false, null, ['ars' => 43.33, 'installment_number' => 1, 'installment_count' => 3]);
            $this->statement($repository, false, '2026-03-01', ['voucher' => '654321', 'ars' => 43.33, 'installment_number' => 2, 'installment_count' => 3]);
            $failed = $links->reconcile([...$base, 'key' => 'pending-history', 'expectedPreviousDecisionId' => $links->latest($receipt['receiptId'])['id']]);
            $this->assertContains('missing_installment_history', array_column($failed['reviews'], 'code'));
            $items[0] = [...$items[0], 'accountId' => 'expense:home:cleaning', 'purposeId' => 'home'];
            $result = $links->reconcile([...$base, 'key' => 'allocation-only', 'paymentVerified' => false, 'expectedPreviousDecisionId' => $links->latest($receipt['receiptId'])['id'], 'expectedPurchaseVersion' => 2, 'itemAllocations' => $items]);
            $this->assertSame([], $result['reviews']);
            $this->assertEquals($items, $service->detail($receipt['receiptId'])['link']['itemAllocations']);
            $this->assertSame('open', $repository->query('review_events')->where('subject_id', $receipt['sourceRevisionId'])->where('code', 'missing_installment_history')->orderByDesc('ordinal')->value('state'));
        } finally {
            DB::rollBack();
        }
    }

    public function test_installments_imported_one_three_two_share_one_purchase_and_preserve_conflict_checks(): void
    {
        DB::beginTransaction();
        try {
            foreach (['a', 'b'] as $owner) {
                [$repository, $service, $links, $receipt, $base, $items, $purchaseId] = $this->allocatedReceipt();
                foreach ([1, 3, 2] as $position) {
                    $transaction = ['ars' => 43.33, 'installment_number' => $position, 'installment_count' => 3];
                    $result = $this->statement($repository, false, '2026-0'.($position + 1).'-01', $transaction);
                    $this->assertSame([], $result['reviews']);
                    $this->assertSame($purchaseId, $repository->query('source_purchase_identities')->where('source_line_id', SourceIdentity::line($result['sourceRevisionId'], 1))->value('purchase_id'));
                }
                $this->assertSame(1, $repository->query('purchases')->count());
                $this->assertSame([1, 2, 3], $repository->query('billings')->orderBy('installment')->pluck('installment')->all());
                $this->assertSame(13000, $this->expense($repository));
                $this->assertSame(12999, (int) DB::selectOne("SELECT sum(credit_minor-debit_minor) AS minor FROM accounting.journal_lines WHERE ledger_id=? AND account_id='synthetic-visa-a:ARS:billed'", [$repository->ledger->id])->minor);
                $this->assertSame(1, (int) DB::selectOne("SELECT sum(credit_minor-debit_minor) AS minor FROM accounting.journal_lines WHERE ledger_id=? AND account_id='synthetic-visa-a:ARS:unbilled'", [$repository->ledger->id])->minor);
                $journals = $repository->query('journals')->get()->all();
                $this->assertTrue($this->statement($repository, false, '2026-03-01', $transaction)['duplicate']);
                $conflict = $this->statement($repository, false, '2026-05-01', ['ars' => 32.50, 'installment_number' => 2, 'installment_count' => 4]);
                $this->assertContains('voucher_facts_conflict', array_column($conflict['reviews'], 'code'));
                $this->assertNull($repository->query('source_purchase_identities')->where('source_line_id', SourceIdentity::line($conflict['sourceRevisionId'], 1))->value('purchase_id'));
                $this->assertEquals($journals, $repository->query('journals')->get()->all());
            }
        } finally {
            DB::rollBack();
        }
    }

    public function test_reviewed_relink_preserves_purchase_and_item_allocation_metadata(): void
    {
        DB::beginTransaction();
        try {
            foreach (['change', 'clear'] as $change) {
                [$repository, $service, $links, $receipt, $base, $items, $purchaseId] = $this->allocatedReceipt();
                $this->statement($repository, false, null, ['ars' => 43.33, 'installment_number' => 1, 'installment_count' => 3]);
                $links->unlink(['key' => 'unlink', 'receiptRevisionId' => $base['receiptRevisionId'], 'expectedPreviousDecisionId' => $links->latest($receipt['receiptId'])['id'], 'recordedAt' => $base['recordedAt']]);
                $this->statement($repository, false, '2026-03-31', ['ars' => 32.50, 'installment_number' => 2, 'installment_count' => 4]);
                $before = $service->detail($receipt['receiptId']);
                $purchase = $repository->purchase($purchaseId);
                $journals = $repository->query('journals')->get()->all();
                $replacement = $items;
                $replacement[0] = [...$replacement[0], 'accountId' => 'expense:home:cleaning', 'purposeId' => 'home'];
                $command = [...$base, 'key' => 'reviewed-allocation', 'expectedPreviousDecisionId' => $before['link']['id'], 'expectedPurchaseVersion' => 2, 'itemAllocations' => $change === 'clear' ? [] : $replacement, 'allocation' => $change === 'clear' ? [['accountId' => 'expense:unallocated', 'purposeId' => 'unallocated', 'minor' => 13000]] : null];
                $result = $links->reconcile($command);
                $this->assertContains('voucher_facts_conflict', array_column($result['reviews'], 'code'));
                $this->assertSame([], $result['postedJournalIds']);
                $this->assertEquals($purchase, $repository->purchase($purchaseId));
                $this->assertEquals($journals, $repository->query('journals')->get()->all());
                $this->assertEquals($before['link'], $service->detail($receipt['receiptId'])['link']);
                $this->assertEquals($items, $service->detail($receipt['receiptId'])['link']['itemAllocations']);
                $this->assertTrue($links->reconcile($command)['duplicate']);
                $this->assertEquals($journals, $repository->query('journals')->get()->all());
            }
        } finally {
            DB::rollBack();
        }
    }

    public function test_out_of_order_adoption_funds_and_bills_in_installment_order_and_recovers_partial_state(): void
    {
        DB::beginTransaction();
        try {
            foreach (['fresh', 'partial'] as $state) {
                [$repository, $service, $links] = $this->setupLedger();
                $second = $this->statement($repository, false, '2026-03-01', ['ars' => 43.33, 'installment_number' => 2, 'installment_count' => 3]);
                $first = $this->statement($repository, false, '2026-02-01', ['ars' => 43.33, 'installment_number' => 1, 'installment_count' => 3]);
                $receipt = $service->import($this->input(), new ProcessingBudget(719000, 0));
                $purchaseId = 'receipt-purchase:'.$receipt['receiptId'];
                if ($state === 'partial') {
                    $commands = new FinancialCommands($repository);
                    $commands->purchase(['key' => 'legacy-fund', 'purchaseId' => $purchaseId, 'cardId' => 'synthetic-visa-a', 'currency' => 'ARS', 'effectiveDate' => '2026-01-15', 'recordedAt' => '2026-04-01T12:00:00Z', 'evidenceIds' => [$receipt['sourceRevisionId']], 'principalMinor' => 13000, 'allocations' => [['accountId' => 'expense:unallocated', 'purposeId' => 'unallocated', 'minor' => 13000]]]);
                    $line = SourceIdentity::line($first['sourceRevisionId'], 1);
                    $commands->bill(['key' => 'legacy-first', 'purchaseId' => $purchaseId, 'cardId' => 'synthetic-visa-a', 'currency' => 'ARS', 'installment' => 1, 'amountMinor' => 4333, 'effectiveDate' => '2026-02-01', 'recordedAt' => '2026-04-01T12:00:00Z', 'evidenceIds' => [$line]]);
                    $identity = ['sourceLineId' => $line, 'purchaseId' => $purchaseId, 'cardId' => 'synthetic-visa-a', 'currency' => 'ARS', 'purchaseDate' => '2026-01-15', 'voucher' => '123456', 'installment' => 1, 'installmentCount' => 3, 'amountMinor' => 4333];
                    $repository->transaction(fn () => $repository->insert('source_purchase_identities', ['source_line_id' => $line, 'currency' => 'ARS', 'purchase_id' => $purchaseId, 'card_id' => 'synthetic-visa-a', 'purchase_date' => '2026-01-15', 'payload' => LedgerRepository::json($identity)], false));
                }
                $command = ['key' => 'ordered-funding', 'receiptRevisionId' => $receipt['sourceRevisionId'], 'cardId' => 'synthetic-visa-a', 'paymentVerified' => true, 'purchaseId' => null, 'expectedPreviousDecisionId' => null, 'allocation' => null, 'recordedAt' => '2026-04-01T12:00:00Z'];
                $result = $links->reconcile($command);
                $this->assertSame([], $result['reviews']);
                $this->assertSame([$purchaseId], $result['purchaseIds']);
                $this->assertCount($state === 'fresh' ? 3 : 1, $result['postedJournalIds']);
                $this->assertSame(1, $repository->query('purchases')->count());
                $this->assertSame(3, $repository->query('journals')->count());
                $this->assertSame(13000, $this->expense($repository));
                $this->assertSame('link', $links->latest($receipt['receiptId'])['action']);
                $this->assertSame([1, 2], $repository->query('billings')->orderBy('installment')->pluck('installment')->all());
                $this->assertSame([$purchaseId, $purchaseId], $repository->query('source_purchase_identities')->orderBy('source_line_id')->pluck('purchase_id')->all());
                $this->assertSame('reviewed', $repository->query('review_events')->where('subject_id', $second['sourceRevisionId'])->orderByDesc('ordinal')->value('state'));
                $journals = $repository->query('journals')->get()->all();
                $this->assertTrue($links->reconcile($command)['duplicate']);
                $this->assertEquals($journals, $repository->query('journals')->get()->all());
                $this->assertSame(8666, (int) DB::selectOne("SELECT sum(credit_minor-debit_minor) AS minor FROM accounting.journal_lines WHERE ledger_id=? AND account_id='synthetic-visa-a:ARS:billed'", [$repository->ledger->id])->minor);
            }
        } finally {
            DB::rollBack();
        }
    }

    public function test_failed_adoption_rolls_back_new_funding_billing_and_allocation_together(): void
    {
        DB::beginTransaction();
        try {
            [$repository, $service, $links] = $this->setupLedger();
            foreach ([2, 1, 3] as $position) {
                $this->statement($repository, false, '2026-0'.($position + 1).'-01', ['ars' => 43.34, 'installment_number' => $position, 'installment_count' => 3]);
            }
            $receipt = $service->import($this->input(), new ProcessingBudget(719000, 0));
            $result = $links->reconcile(['key' => 'over-principal', 'receiptRevisionId' => $receipt['sourceRevisionId'], 'cardId' => 'synthetic-visa-a', 'paymentVerified' => true, 'purchaseId' => null, 'expectedPreviousDecisionId' => null, 'allocation' => [['accountId' => 'expense:unallocated', 'purposeId' => 'unallocated', 'minor' => 13000]], 'itemAllocations' => [], 'recordedAt' => '2026-05-01T12:00:00Z']);
            $this->assertContains('billing_exceeds_principal', array_column($result['reviews'], 'code'));
            $this->assertSame([], $result['postedJournalIds']);
            $this->assertSame([], $result['purchaseIds']);
            $this->assertSame(0, $repository->query('journals')->count());
            $this->assertSame(0, $repository->query('purchases')->count());
            $this->assertSame(0, $repository->query('source_purchase_identities')->count());
            $this->assertNull($service->detail($receipt['receiptId'])['link']);
            $this->assertSame('billing_exceeds_principal', $repository->query('review_events')->where('subject_id', $receipt['sourceRevisionId'])->orderByDesc('ordinal')->value('code'));
        } finally {
            DB::rollBack();
        }
    }

    public function test_verified_relink_revalidates_installment_identity_before_posting_or_binding(): void
    {
        DB::beginTransaction();
        try {
            foreach (['a', 'b'] as $owner) {
                foreach (['changed-count', 'changed-amount', 'changed-voucher', 'new-voucher-first', 'missing-voucher', 'valid'] as $case) {
                    [$repository, $service, $links, $receipt, $base, $items, $purchaseId] = $this->allocatedReceipt();
                    $this->statement($repository, false, null, ['ars' => 43.33, 'installment_number' => 1, 'installment_count' => 3]);
                    $links->unlink(['key' => 'unlink-plan', 'receiptRevisionId' => $base['receiptRevisionId'], 'expectedPreviousDecisionId' => $links->latest($receipt['receiptId'])['id'], 'recordedAt' => $base['recordedAt']]);
                    $unlinked = $links->latest($receipt['receiptId']);
                    $transaction = ['ars' => 43.33, 'installment_number' => 2, 'installment_count' => 3, ...match ($case) {
                        'changed-count' => ['ars' => 32.50, 'installment_count' => 4],
                        'changed-amount' => ['ars' => 43.34],
                        'changed-voucher' => ['voucher' => '654321'],
                        'new-voucher-first' => ['voucher' => '654321', 'installment_number' => 1],
                        'missing-voucher' => ['voucher' => null],
                        'valid' => [],
                    }];
                    $statement = $this->statement($repository, $case === 'valid', '2026-03-31', $transaction);
                    $line = SourceIdentity::line($statement['sourceRevisionId'], 1);
                    $expectedCode = in_array($case, ['changed-count', 'changed-amount'], true) ? 'voucher_facts_conflict' : 'missing_installment_history';
                    if ($case !== 'valid') {
                        $this->assertContains($case === 'new-voucher-first' ? 'missing_supported_principal' : $expectedCode, array_column($statement['reviews'], 'code'));
                    }
                    if ($case === 'new-voucher-first') {
                        $expectedCode = 'receipt_statement_identity_conflict';
                    }
                    $journals = $repository->query('journals')->get()->all();
                    $identities = $repository->query('source_purchase_identities')->get()->all();
                    $command = [...$base, 'key' => 'verified-plan-relink', 'expectedPreviousDecisionId' => $unlinked['id'], 'expectedPurchaseVersion' => 2];
                    $result = $links->reconcile($command);
                    if ($case === 'valid') {
                        $this->assertCount(1, $result['postedJournalIds']);
                        $this->assertSame([], $result['reviews']);
                        $this->assertSame($purchaseId, $repository->query('source_purchase_identities')->where('source_line_id', $line)->value('purchase_id'));
                        $this->assertSame('link', $links->latest($receipt['receiptId'])['action']);
                    } else {
                        $this->assertContains($expectedCode, array_column($result['reviews'], 'code'));
                        $this->assertSame([], $result['postedJournalIds']);
                        $this->assertSame($unlinked['id'], $links->latest($receipt['receiptId'])['id']);
                        $this->assertEquals($journals, $repository->query('journals')->get()->all());
                        $this->assertEquals($identities, $repository->query('source_purchase_identities')->get()->all());
                        $this->assertNull($repository->query('source_purchase_identities')->where('source_line_id', $line)->value('purchase_id'));
                    }
                    $this->assertSame(13000, $this->expense($repository));
                    $billed = DB::selectOne("SELECT sum(credit_minor-debit_minor) AS minor FROM accounting.journal_lines WHERE ledger_id=? AND account_id='synthetic-visa-a:ARS:billed'", [$repository->ledger->id]);
                    $this->assertSame($case === 'valid' ? 8666 : 4333, (int) $billed->minor);
                    $journalCount = $repository->query('journals')->count();
                    $reviewCount = $repository->query('review_events')->count();
                    $this->assertTrue($links->reconcile($command)['duplicate']);
                    $this->assertSame($journalCount, $repository->query('journals')->count());
                    $this->assertSame($reviewCount, $repository->query('review_events')->count());
                }
            }
        } finally {
            DB::rollBack();
        }
    }

    public function test_allocation_only_relink_is_rejected_before_or_after_statement_without_financial_changes(): void
    {
        DB::beginTransaction();
        try {
            foreach ([[false, false], [true, false], [false, true], [true, true]] as [$statementFirst, $legacy]) {
                [$repository, $service, $links, $receipt, $base, $items, $purchaseId] = $this->allocatedReceipt();
                $links->unlink(['key' => 'unlink', 'receiptRevisionId' => $base['receiptRevisionId'], 'expectedPreviousDecisionId' => $links->latest($receipt['receiptId'])['id'], 'recordedAt' => $base['recordedAt']]);
                $unlinked = $links->latest($receipt['receiptId']);
                if ($statementFirst) {
                    $this->statement($repository);
                }
                if ($legacy) {
                    $old = [...$unlinked, 'id' => (string) Str::uuid(), 'key' => 'legacy-unverified', 'previousDecisionId' => $unlinked['id'], 'action' => 'link', 'paymentVerified' => false];
                    $repository->transaction(fn () => $repository->insert('receipt_link_decisions', ['id' => $old['id'], 'key' => $old['key'], 'receipt_id' => $old['receiptId'], 'receipt_revision_id' => $old['receiptRevisionId'], 'purchase_id' => $old['purchaseId'], 'card_id' => $old['cardId'], 'action' => $old['action'], 'previous_decision_id' => $old['previousDecisionId'], 'recorded_at' => $old['recordedAt'], 'payload' => LedgerRepository::json($old)]));
                    $unlinked = $links->latest($receipt['receiptId']);
                }
                $journals = $repository->query('journals')->get()->all();
                $this->rejects('receipt_payment_unresolved', fn () => $links->reconcile([...$base, 'key' => 'unverified-allocation', 'paymentVerified' => false, 'expectedPreviousDecisionId' => $unlinked['id'], 'expectedPurchaseVersion' => 2, 'itemAllocations' => $items]));
                $this->rejects('receipt_payment_unresolved', fn () => $links->reconcile([...$base, 'key' => 'unverified-card', 'cardId' => null, 'expectedPreviousDecisionId' => $unlinked['id'], 'expectedPurchaseVersion' => 2, 'itemAllocations' => $items]));
                $this->assertSame($unlinked['id'], $links->latest($receipt['receiptId'])['id']);
                $this->assertEquals($journals, $repository->query('journals')->get()->all());
                if (! $statementFirst) {
                    $this->statement($repository);
                }
                $this->assertSame(1, $repository->query('purchases')->count());
                $this->assertSame(13000, $this->expense($repository));
                $linked = $links->reconcile([...$base, 'key' => 'verified-relink', 'expectedPreviousDecisionId' => $unlinked['id'], 'expectedPurchaseVersion' => 2]);
                $this->assertSame([$purchaseId], $linked['purchaseIds']);
                $this->assertCount(1, $linked['postedJournalIds']);
                $this->assertTrue($links->latest($receipt['receiptId'])['paymentVerified']);
                $this->assertSame($purchaseId, $repository->query('source_purchase_identities')->value('purchase_id'));
                $this->assertSame(13000, $this->expense($repository));
            }
        } finally {
            DB::rollBack();
        }
    }

    public function test_partially_reviewed_receipt_can_reset_to_unallocated_without_approving_other_items(): void
    {
        DB::beginTransaction();
        try {
            [$repository, $service, $links, $receipt, $base, $items, $purchaseId] = $this->allocatedReceipt(true);
            $detail = $service->detail($receipt['receiptId']);
            $this->assertFalse($detail['items'][1]['match']['reviewed']);
            $body = [...$base, 'paymentVerified' => false, 'expectedPreviousDecisionId' => $detail['link']['id'], 'allocation' => [['accountId' => 'expense:unallocated', 'purposeId' => 'unallocated', 'minor' => 13000]], 'itemAllocations' => []];
            $journals = $repository->query('journals')->count();
            $this->rejects('stale_purchase_version', fn () => $links->reconcile([...$body, 'key' => 'stale-reset', 'expectedPurchaseVersion' => 1]));
            $this->assertSame($journals, $repository->query('journals')->count());
            $reset = $links->reconcile([...$body, 'key' => 'reset', 'expectedPurchaseVersion' => 2]);
            $this->assertEquals([['accountId' => 'expense:unallocated', 'purposeId' => 'unallocated', 'minor' => 13000]], $repository->purchase($purchaseId)['allocations']);
            $this->assertFalse($service->detail($receipt['receiptId'])['items'][1]['match']['reviewed']);
            $this->assertSame([], $links->latest($receipt['receiptId'])['itemAllocations']);
            $this->assertSame(13000, $this->expense($repository));
            $this->assertTrue($links->reconcile([...$body, 'key' => 'reset', 'expectedPurchaseVersion' => 2])['duplicate']);
            $this->assertCount(2, $reset['postedJournalIds']);
            $this->assertSame($journals + 2, $repository->query('journals')->count());
            $this->rejects('product_identity_unreviewed', fn () => $links->reconcile([...$base, 'key' => 'unreviewed-classification', 'expectedPurchaseVersion' => 3, 'allocation' => [['accountId' => 'expense:food:groceries:pantry', 'purposeId' => 'food', 'minor' => 13000]]]));
        } finally {
            DB::rollBack();
        }
    }

    private function allocatedReceipt(bool $partial = false): array
    {
        [$repository, $service, $links] = $this->setupLedger();
        $receipt = $service->import($this->input(), new ProcessingBudget(719000, 0));
        $revision = $receipt['sourceRevisionId'];
        $base = ['receiptRevisionId' => $revision, 'cardId' => 'synthetic-visa-a', 'paymentVerified' => true, 'purchaseId' => null, 'allocation' => null, 'recordedAt' => '2026-01-18T12:00:00Z'];
        $funded = $links->reconcile([...$base, 'key' => 'fund']);
        $products = new ReceiptProducts($repository);
        $items = [];
        foreach ($partial ? [1] : [1, 2] as $position) {
            $line = SourceIdentity::line($revision, $position);
            $match = $products->latest('product_match_revisions', 'id', $line);
            $product = $products->product($match['productId']);
            $products->decide(['key' => 'product:'.$position, 'kind' => 'product_update', 'subjectId' => $product['id'], 'payload' => ['name' => $product['name'], 'category' => 'pantry', 'unit' => 'un'], 'recordedAt' => $base['recordedAt']]);
            $products->decide(['key' => 'approve:'.$position, 'kind' => 'product_match', 'subjectId' => $line, 'payload' => ['productId' => $product['id']], 'recordedAt' => $base['recordedAt']]);
            $items[] = ['sourceLineId' => $line, 'accountId' => $position === 1 ? 'expense:food:groceries:pantry' : 'expense:personal:hygiene', 'purposeId' => $position === 1 ? 'food' : 'personal', 'minor' => $position === 1 ? 8000 : 5000];
        }
        $links->reconcile([...$base, 'key' => 'allocate', 'expectedPurchaseVersion' => 1, 'itemAllocations' => $items]);

        return [$repository, $service, $links, $receipt, $base, $items, $funded['purchaseIds'][0]];
    }

    public function test_item_allocations_survive_unlink_relink_and_legacy_empty_decisions(): void
    {
        DB::beginTransaction();
        try {
            [$repository, $service, $links, $receipt, $base, $items, $purchaseId] = $this->allocatedReceipt();
            $journals = $repository->query('journals')->get()->all();
            $active = $links->latest($receipt['receiptId']);
            $links->unlink(['key' => 'unlink', 'receiptRevisionId' => $base['receiptRevisionId'], 'expectedPreviousDecisionId' => $active['id'], 'recordedAt' => $base['recordedAt']]);
            $links->reconcile([...$base, 'key' => 'relink', 'expectedPreviousDecisionId' => $links->latest($receipt['receiptId'])['id']]);
            $this->assertEquals($items, $links->latest($receipt['receiptId'])['itemAllocations']);
            $this->assertEquals($items, $service->detail($receipt['receiptId'])['link']['itemAllocations']);
            $this->assertEquals($journals, $repository->query('journals')->get()->all());

            // Old installations can already have empty association-only link payloads.
            $legacy = [...$links->latest($receipt['receiptId']), 'id' => (string) Str::uuid(), 'key' => 'legacy-empty', 'previousDecisionId' => $links->latest($receipt['receiptId'])['id'], 'allocation' => null, 'itemAllocations' => []];
            $repository->transaction(fn () => $repository->insert('receipt_link_decisions', ['id' => $legacy['id'], 'key' => $legacy['key'], 'receipt_id' => $legacy['receiptId'], 'receipt_revision_id' => $legacy['receiptRevisionId'], 'purchase_id' => $legacy['purchaseId'], 'card_id' => $legacy['cardId'], 'action' => 'link', 'previous_decision_id' => $legacy['previousDecisionId'], 'recorded_at' => $legacy['recordedAt'], 'payload' => LedgerRepository::json($legacy)]));
            $this->assertEquals($items, $service->detail($receipt['receiptId'])['link']['itemAllocations']);
            $snapshot = (new ReportSnapshot($repository))->read();
            $this->assertSame(array_column($items, 'accountId'), array_column($snapshot['allocations'], 'accountId'));
            $this->assertSame([8000, 5000], array_column($snapshot['allocations'], 'netMinor'));
            $this->assertEquals($journals, $repository->query('journals')->get()->all());
            $this->assertSame([], json_decode($repository->query('receipt_link_decisions')->where('id', $legacy['id'])->value('payload'), true)['itemAllocations']);

            $links->reconcile([...$base, 'key' => 'aggregate-reset', 'expectedPurchaseVersion' => 2, 'allocation' => [['accountId' => 'expense:unallocated', 'purposeId' => 'unallocated', 'minor' => 13000]]]);
            $this->assertSame([], $links->latest($receipt['receiptId'])['itemAllocations']);
            $this->assertSame('expense:unallocated', $repository->purchase($purchaseId)['allocations'][0]['accountId']);
        } finally {
            DB::rollBack();
        }
    }

    public function test_purchase_classification_updates_current_receipt_accounts_without_rewriting_item_history(): void
    {
        DB::beginTransaction();
        try {
            foreach ([false, true] as $partial) {
                [$repository, $service, $links, $receipt, $base, $items, $purchaseId] = $this->allocatedReceipt($partial);
                $merchant = new MerchantReviews($repository);
                $history = $repository->query('receipt_link_decisions')->orderBy('ordinal')->get()->all();
                $before = $service->detail($receipt['receiptId']);
                $classification = ['key' => 'classify', 'recordedAt' => $base['recordedAt'], 'kind' => 'purchase_classification', 'purchaseId' => $purchaseId, 'cardId' => 'synthetic-visa-a', 'accountId' => 'expense:home:cleaning', 'purposeId' => 'home', 'scope' => 'selected', 'match' => null, 'expectedVersion' => 2];
                $merchant->decide($classification);
                $detail = $service->detail($receipt['receiptId']);
                $this->assertSame(3, $detail['purchaseVersion']);
                $this->assertSame($before['link']['id'], $detail['link']['id']);
                $this->assertSame(['expense:home:cleaning', 'expense:home:cleaning'], array_column($detail['link']['itemAllocations'], 'accountId'));
                $this->assertSame([8000, 5000], array_column($detail['link']['itemAllocations'], 'minor'));
                $this->assertSame($before['items'], $detail['items']);
                $snapshot = (new ReportSnapshot($repository))->read();
                $this->assertSame(['expense:home:cleaning', 'expense:home:cleaning'], array_column($snapshot['allocations'], 'accountId'));
                $this->assertSame([8000, 5000], array_column($snapshot['allocations'], 'netMinor'));
                $this->assertEquals($history, $repository->query('receipt_link_decisions')->orderBy('ordinal')->get()->all());
                $journals = $repository->query('journals')->count();
                $this->assertTrue($merchant->decide($classification)['duplicate']);
                $this->assertSame($journals, $repository->query('journals')->count());
                $body = [...$base, 'purchaseId' => $purchaseId, 'itemAllocations' => $items, 'expectedPreviousDecisionId' => $detail['link']['id'], 'expectedPurchaseVersion' => 2];
                $this->rejects('stale_purchase_version', fn () => $links->reconcile([...$body, 'key' => 'stale-items']));
                $this->assertSame(13000, $repository->purchase($purchaseId)['principalMinor']);
                $links->reconcile([...$body, 'key' => 'fresh-items', 'expectedPurchaseVersion' => 3]);
                $this->assertEquals($items, $links->latest($receipt['receiptId'])['itemAllocations']);
                $current = $repository->purchase($purchaseId);
                $commands = new FinancialCommands($repository);
                $commands->correct(['key' => 'same-accounts-reordered', 'cardId' => $base['cardId'], 'purchaseId' => $purchaseId, 'expectedVersion' => $current['version'], 'replacement' => [...$current, 'allocations' => array_reverse($current['allocations'])], 'reason' => 'same account totals', 'recordedAt' => $base['recordedAt']]);
                $this->assertEquals($items, $links->latest($receipt['receiptId'])['itemAllocations']);
                $current = $repository->purchase($purchaseId);
                $commands->correct(['key' => 'different-split', 'cardId' => $base['cardId'], 'purchaseId' => $purchaseId, 'expectedVersion' => $current['version'], 'replacement' => [...$current, 'allocations' => [['accountId' => 'expense:home:cleaning', 'purposeId' => 'home', 'minor' => 7000], ['accountId' => 'expense:food:groceries:pantry', 'purposeId' => 'food', 'minor' => 6000]]], 'reason' => 'no supported item mapping', 'recordedAt' => $base['recordedAt']]);
                $this->assertSame([], $links->latest($receipt['receiptId'])['itemAllocations']);
                $this->assertSame([null, null], array_column((new ReportSnapshot($repository))->read()['allocations'], 'accountId'));
                [$other, $otherService] = $this->setupLedger();
                $this->assertNull($otherService->detail($receipt['receiptId']));
            }
        } finally {
            DB::rollBack();
        }
    }

    public function test_stale_or_missing_purchase_version_cannot_overwrite_merchant_classification(): void
    {
        [$repository, $service, $links, $receipt, $base, $items, $purchaseId] = $this->allocatedReceipt();
        app('auth')->forgetGuards();
        $this->actingAs($repository->ledger->owner, 'web');
        $detail = $this->getJson('/api/v1/receipts/'.$receipt['receiptId'])->assertOk()->assertJsonPath('purchaseVersion', 2)->json();
        $this->postJson('/api/v1/merchant-review', ['kind' => 'purchase_classification', 'purchaseId' => $purchaseId, 'cardId' => 'synthetic-visa-a', 'accountId' => 'expense:home:cleaning', 'purposeId' => 'home', 'scope' => 'selected', 'match' => null, 'expectedVersion' => 2], ['Idempotency-Key' => 'other-tab'])->assertOk();
        $this->assertSame($detail['link']['id'], $links->latest($receipt['receiptId'])['id']);
        $journals = $repository->query('journals')->count();
        $decisions = $repository->query('receipt_link_decisions')->count();
        $body = [...$base, 'purchaseId' => $purchaseId, 'itemAllocations' => $items, 'expectedPreviousDecisionId' => $detail['link']['id'], 'expectedPurchaseVersion' => $detail['purchaseVersion']];
        $url = '/api/v1/receipts/'.$receipt['receiptId'].'/reconciliation';
        $this->postJson($url, $body, ['Idempotency-Key' => 'stale-form'])->assertConflict()->assertJsonPath('error.code', 'stale_purchase_version');
        unset($body['expectedPurchaseVersion']);
        $this->postJson($url, $body, ['Idempotency-Key' => 'missing-version'])->assertConflict()->assertJsonPath('error.code', 'stale_purchase_version');
        $this->assertSame($journals, $repository->query('journals')->count());
        $this->assertSame($decisions, $repository->query('receipt_link_decisions')->count());
        $this->assertSame('expense:home:cleaning', $repository->purchase($purchaseId)['allocations'][0]['accountId']);
        $fresh = $this->getJson('/api/v1/receipts/'.$receipt['receiptId'])->assertOk()->assertJsonPath('purchaseVersion', 3)->json();
        $body['expectedPurchaseVersion'] = $fresh['purchaseVersion'];
        $this->postJson($url, $body, ['Idempotency-Key' => 'fresh-form'])->assertOk();
        $this->assertSame(4, $repository->purchase($purchaseId)['version']);
        $journals = $repository->query('journals')->count();
        $this->postJson($url, $body, ['Idempotency-Key' => 'fresh-form'])->assertOk()->assertJsonPath('duplicate', true);
        $this->assertSame($journals, $repository->query('journals')->count());
    }

    private function rejects(string $code, callable $work): void
    {
        try {
            $work();
            $this->fail('Expected '.$code);
        } catch (AccountingError $error) {
            $this->assertSame($code, $error->errorCode);
        }
    }

    public function test_link_conflicts_unlink_history_and_product_operations_preserve_principal(): void
    {
        DB::beginTransaction();
        try {
            [$repository,$service,$links] = $this->setupLedger();
            $receipt = $service->import($this->input(), new ProcessingBudget(719000, 0));
            $revision = $receipt['sourceRevisionId'];
            $base = ['key' => 'fund', 'receiptRevisionId' => $revision, 'cardId' => 'synthetic-visa-a', 'paymentVerified' => true, 'purchaseId' => null, 'allocation' => null, 'expectedPreviousDecisionId' => null, 'recordedAt' => '2026-01-18T12:00:00Z'];
            $funded = $links->reconcile($base);
            $active = $links->latest($receipt['receiptId']);
            $this->assertTrue($links->reconcile([...$base, 'recordedAt' => '2026-01-19T12:00:00Z'])['duplicate']);
            $this->rejects('command_conflict', fn () => $links->reconcile([...$base, 'paymentVerified' => false]));
            $this->rejects('stale_receipt_link', fn () => $links->reconcile([...$base, 'key' => 'stale']));
            $products = new ReceiptProducts($repository);
            $lines = [SourceIdentity::line($revision, 1), SourceIdentity::line($revision, 2)];
            $matches = array_map(fn ($line) => $products->latest('product_match_revisions', 'id', $line), $lines);
            $canonical = array_map(fn ($match) => $products->product($match['productId']), $matches);
            foreach ($canonical as $i => $product) {
                $products->decide(['key' => 'approve:'.$i, 'kind' => 'product_update', 'subjectId' => $product['id'], 'expectedSeq' => $product['seq'], 'payload' => ['name' => $product['name'], 'category' => 'pantry', 'unit' => 'un'], 'recordedAt' => $base['recordedAt']]);
                $this->assertFalse($products->latest('product_match_revisions', 'id', $lines[$i])['reviewed']);
                $products->decide(['key' => 'match:'.$i, 'kind' => 'product_match', 'subjectId' => $lines[$i], 'payload' => ['productId' => $product['id']], 'recordedAt' => $base['recordedAt']]);
            }
            $code = $products->current('product_code_revisions')[0];
            $source = $code['productId'];
            $target = $canonical[0]['id'] === $source ? $canonical[1]['id'] : $canonical[0]['id'];
            $moved = $products->decide(['key' => 'move', 'kind' => 'move_code', 'subjectId' => $code['id'], 'expectedSeq' => $code['seq'], 'payload' => ['targetId' => $target], 'recordedAt' => $base['recordedAt']]);
            $this->assertSame($target, $products->latest('product_code_revisions', 'id', $code['id'])['productId']);
            $affected = array_values(array_filter($products->current('product_match_revisions'), fn ($row) => $row['productId'] === $target));
            $this->assertTrue(count(array_filter($affected, fn ($row) => ! $row['reviewed'])) > 0);
            $products->decide(['key' => 'merge', 'kind' => 'product_merge', 'subjectId' => $source, 'payload' => ['targetId' => $target], 'recordedAt' => $base['recordedAt']]);
            $this->assertSame($target, $products->product($source)['redirectId']);
            $this->assertSame(13000, $this->expense($repository));
            $this->assertSame(13000, $repository->purchase($funded['purchaseIds'][0])['principalMinor']);
            $unlink = ['key' => 'unlink', 'receiptRevisionId' => $revision, 'expectedPreviousDecisionId' => $active['id'], 'recordedAt' => $base['recordedAt']];
            $links->unlink($unlink);
            $links->unlink([...$unlink, 'recordedAt' => '2026-01-19T12:00:00Z']);
            $this->assertCount(0, $links->active());
            $this->assertSame($active['id'], $links->latest($receipt['receiptId'])['previousDecisionId']);
            $this->rejects('command_conflict', fn () => $links->unlink([...$unlink, 'expectedPreviousDecisionId' => null]));
            $this->assertSame(2, $repository->query('receipt_link_decisions')->count());
            $this->assertSame(13000, $this->expense($repository));
            [$other,$otherService] = $this->setupLedger();
            $this->assertNull($otherService->detail($receipt['receiptId']));
            $this->assertNull($otherService->facts($revision));
            $this->rejects('missing_review_subject', fn () => (new ReceiptProducts($other))->product($target));
        } finally {
            DB::rollBack();
        }
    }

    public function test_historical_link_and_unlink_chain_preserves_only_opening_journal(): void
    {
        DB::beginTransaction();
        try {
            [$repository,$service,$links] = $this->setupLedger();
            $repository->transaction(fn () => $repository->insert('evidence', ['id' => 'opening-proof', 'kind' => 'synthetic', 'metadata' => '{}']));
            $opening = ['id' => (string) Str::uuid(), 'commandKey' => 'opening', 'cardId' => 'synthetic-visa-a', 'currency' => 'ARS', 'effectiveDate' => '2026-02-01', 'recordedAt' => '2026-02-01T12:00:00Z', 'kind' => 'opening', 'reversesId' => null, 'evidenceIds' => ['opening-proof'], 'lines' => [['accountId' => 'equity:opening', 'debitMinor' => 13000, 'creditMinor' => 0, 'purchaseId' => null, 'purposeId' => null], ['accountId' => 'synthetic-visa-a:ARS:billed', 'debitMinor' => 0, 'creditMinor' => 13000, 'purchaseId' => null, 'purposeId' => null]]];
            $this->assertSame('posted', (new FinancialCommands($repository))->post($opening)['status']);
            $statement = $this->statement($repository, true);
            $receipt = $service->import($this->input(), new ProcessingBudget(719000, 0));
            $association = new HistoricalAssociations($service);
            $base = ['key' => 'historical-link', 'receiptRevisionId' => $receipt['sourceRevisionId'], 'sourceLineId' => SourceIdentity::line($statement['sourceRevisionId'], 1), 'action' => 'link', 'expectedPreviousDecisionId' => null, 'recordedAt' => '2026-02-02T12:00:00Z'];
            $linked = $association->decide($base);
            $this->assertEquals($linked, $association->decide([...$base, 'recordedAt' => '2026-02-03T12:00:00Z']));
            $this->assertCount(1, $association->current());
            $this->rejects('stale_historical_association', fn () => $association->decide([...$base, 'key' => 'stale']));
            $unlinked = $association->decide([...$base, 'key' => 'unlink', 'action' => 'unlink', 'expectedPreviousDecisionId' => $linked['id']]);
            $this->assertSame($linked['id'], $unlinked['previousDecisionId']);
            $this->assertCount(0, $association->current());
            $this->assertSame(1, $repository->query('journals')->count());
            $this->assertSame(0, $repository->query('purchases')->count());
            $this->assertSame(0, $this->expense($repository));
        } finally {
            DB::rollBack();
        }
    }

    public function test_postgresql_receipt_product_foreign_key_and_immutable_evidence_guards(): void
    {
        DB::beginTransaction();
        try {
            [$a,$aService] = $this->setupLedger();
            [$b,$bService] = $this->setupLedger();
            $receiptA = $aService->import($this->input(), new ProcessingBudget(719000, 0));
            $receiptB = $bService->import($this->input(), new ProcessingBudget(719000, 0));
            $line = SourceIdentity::line($receiptA['sourceRevisionId'], 1);
            $productA = (new ReceiptProducts($a))->latest('product_match_revisions', 'id', $line)['productId'];
            $productB = (new ReceiptProducts($b))->latest('product_match_revisions', 'id', SourceIdentity::line($receiptB['sourceRevisionId'], 1))['productId'];
            $this->assertNotSame($productA, $productB);
            $row = ['id' => $line, 'product_id' => $productA, 'payload' => '{}'];
            $a->transaction(fn () => $a->insert('product_match_revisions', $row));
            DB::statement('SAVEPOINT cross_owner_product');
            try {
                DB::table('accounting.product_match_revisions')->insert(['ledger_id' => $a->ledger->id, 'row_id' => (string) Str::uuid(), ...$row, 'product_id' => $productB]);
                $this->fail('Cross-owner product reference accepted');
            } catch (QueryException $error) {
                $this->assertSame('23503', $error->errorInfo[0]);
                $this->assertStringContainsString('product_match_revisions_ledger_id_product_id_fkey', $error->getMessage());
                DB::statement('ROLLBACK TO SAVEPOINT cross_owner_product');
            }
            DB::statement('SAVEPOINT immutable_receipt');
            try {
                DB::table('accounting.receipt_facts')->where('ledger_id', $a->ledger->id)->update(['payload' => '{}']);
                $this->fail('Receipt facts were changed');
            } catch (QueryException $error) {
                $this->assertStringContainsString('immutable_record', $error->getMessage());
                DB::statement('ROLLBACK TO SAVEPOINT immutable_receipt');
            }
        } finally {
            DB::rollBack();
        }
    }

    public function test_confirmed_historical_full_refund_reduces_opening_debt_without_fabricating_purchase(): void
    {
        DB::beginTransaction();
        try {
            foreach (['original-first', 'refund-first'] as $order) {
                [$repository,$service] = $this->setupLedger();
                $repository->transaction(fn () => $repository->insert('evidence', ['id' => 'opening-proof', 'kind' => 'synthetic', 'metadata' => '{}']));
                (new FinancialCommands($repository))->post(['id' => (string) Str::uuid(), 'commandKey' => 'opening', 'cardId' => 'synthetic-visa-a', 'currency' => 'ARS', 'effectiveDate' => '2026-02-01', 'recordedAt' => '2026-02-01T12:00:00Z', 'kind' => 'opening', 'reversesId' => null, 'evidenceIds' => ['opening-proof'], 'lines' => [['accountId' => 'equity:opening', 'debitMinor' => 13000, 'creditMinor' => 0, 'purchaseId' => null, 'purposeId' => null], ['accountId' => 'synthetic-visa-a:ARS:billed', 'debitMinor' => 0, 'creditMinor' => 13000, 'purchaseId' => null, 'purposeId' => null]]]);
                if ($order === 'original-first') {
                    $original = $this->statement($repository, true);
                }
                $raw = json_decode(file_get_contents(base_path('../docs/rebuild/fixtures/visa.expected.json')));
                $raw->period->closing_date = '2026-03-31';
                $raw->declared_totals = [];
                $raw->transactions = [(object) ['section' => 'purchases', 'date' => '2026-03-05', 'description' => 'DEVOLUCION COTO SYNTHETIC', 'ars' => -130, 'usd' => null, 'installment_number' => null, 'installment_count' => null, 'raw_line' => '05-mar-26 DEVOLUCION COTO -130,00']];
                $refund = (new StatementImporter($repository, app(DocumentStore::class)))->import(['key' => 'refund', 'cardId' => 'synthetic-visa-a', 'filename' => 'synthetic_refund_2026_03.pdf', 'pdf' => file_get_contents(base_path('../docs/rebuild/fixtures/pdf/synthetic_visa_2026_02.pdf'))."\n% synthetic full-refund seam", 'rawJson' => json_encode($raw), 'recordedAt' => '2026-03-31T12:00:00Z', 'appRevision' => 'receipt-acceptance']);
                if ($order === 'refund-first') {
                    $original = $this->statement($repository, true);
                }
                $input = ['key' => 'full-refund', 'cardId' => 'synthetic-visa-a', 'currency' => 'ARS', 'originalSourceLineId' => SourceIdentity::line($original['sourceRevisionId'], 1), 'refundSourceLineId' => SourceIdentity::line($refund['sourceRevisionId'], 1), 'accountId' => 'expense:food:groceries:pantry', 'purposeId' => 'food', 'confirmedFullRefund' => true, 'recordedAt' => '2026-04-01T12:00:00Z'];
                $useCase = new HistoricalRefund($service);
                $this->rejects('full_refund_confirmation_required', fn () => $useCase->post([...$input, 'confirmedFullRefund' => false]));
                (new SourceClassification($repository))->decide(['key' => 'pre-refund-classification', 'sourceLineId' => $input['originalSourceLineId'], 'accountId' => 'expense:home:cleaning', 'purposeId' => 'home', 'scope' => 'selected', 'match' => null, 'expectedPreviousDecisionId' => null, 'recordedAt' => '2026-03-31T13:00:00Z']);
                $previous = $repository->query('review_events')->where('subject_id', $input['originalSourceLineId'])->where('code', 'historical_source_classification')->orderByDesc('ordinal')->value('id');
                $this->assertSame('posted', $useCase->post($input)['status']);
                $current = $repository->query('review_events')->where('subject_id', $input['originalSourceLineId'])->where('code', 'historical_source_classification')->orderByDesc('ordinal')->first();
                $this->assertSame($previous, $current->prior_decision_id);
                $this->assertSame('food', json_decode($current->params, true)['purposeId']);

                $this->assertSame('duplicate', $useCase->post([...$input, 'key' => 'replay', 'recordedAt' => '2026-04-02T12:00:00Z'])['status']);
                $this->assertSame(-13000, $this->expense($repository));
                $this->assertSame(2, $repository->query('journals')->count());
                $this->assertSame(0, $repository->query('purchases')->count());
                $billed = DB::selectOne("SELECT sum(credit_minor-debit_minor) AS minor FROM accounting.journal_lines WHERE ledger_id=? AND account_id='synthetic-visa-a:ARS:billed'", [$repository->ledger->id]);
                $this->assertSame(0, (int) $billed->minor);
                $snapshot = (new ReportSnapshot($repository))->read();
                $credits = array_values(array_filter($snapshot['facts'], fn ($fact) => $fact['kind'] === 'credit'));
                $this->assertCount(1, $credits);
                $this->assertSame(-13000, $credits[0]['minor']);
                $this->assertSame($input['refundSourceLineId'], $credits[0]['sourceLineId']);
                $this->assertSame($refund['sourceRevisionId'], $credits[0]['statementId']);
                $this->assertSame(FinancialFacts::cycle('2026-03-31', $raw->period->previous_closing_date), $credits[0]['cycleMonth']);
                foreach (['purchase', 'billed'] as $basis) {
                    $report = (new ReportCalculator)->calculate([...$snapshot, 'rates' => json_decode(file_get_contents(base_path('../docs/rebuild/fixtures/references.json')), true), 'scope' => ['basis' => $basis, 'value' => 'nominal', 'tax' => 'excl', 'granularity' => 'month', 'period' => null], 'locale' => 'en'], new ProcessingBudget(30000, 0));
                    $this->assertEquals(0, $report['spending']['spending']['total']);
                }

            }
        } finally {
            DB::rollBack();
        }
    }
}
