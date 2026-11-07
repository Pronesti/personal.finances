<?php

namespace App\Domain\Recovery;

use App\Domain\Evidence\DocumentStore;
use App\Domain\Evidence\SourceIdentity;
use App\Domain\Ledger\AccountingError;
use App\Domain\Ledger\LedgerRepository;
use App\Domain\Reports\ReferenceTables;
use App\Domain\Reports\ReportSnapshot;
use Illuminate\Support\Facades\DB;

class LedgerIntegrity
{
    public function __construct(private LedgerRepository $repository, private DocumentStore $documents) {}

    public function check(): array
    {
        return $this->repository->readSnapshot(function () {
            $owner = $this->repository->ledger->id;
            $issues = [];
            $unbalanced = DB::select("SELECT j.id FROM accounting.journals j LEFT JOIN accounting.journal_lines l ON l.ledger_id=j.ledger_id AND l.journal_id=j.id WHERE j.ledger_id=? AND j.status='posted' GROUP BY j.id HAVING count(l.ordinal)=0 OR sum(l.debit_minor::numeric-l.credit_minor::numeric)<>0", [$owner]);
            foreach ($unbalanced as $row) {
                $issues[] = ['code' => 'unbalanced_journal', 'id' => $row->id];
            }
            foreach ($this->repository->query('object_references')->get() as $ref) {
                try {
                    $this->documents->read($this->repository->ledger, $ref->sha256, (int) $ref->byte_length, $ref->kind === 'pending' ? $ref->reference_id : null);
                } catch (\Throwable) {
                    $issues[] = ['code' => 'object_integrity', 'kind' => $ref->kind, 'referenceId' => $ref->reference_id];
                }
            }
            foreach ($this->repository->query('source_documents')->get() as $document) {
                if (! $this->repository->query('object_references')->where('kind', 'object')->where('sha256', $document->sha256)->where('relative_path', $document->relative_path)->where('byte_length', $document->byte_length)->exists()) {
                    $issues[] = ['code' => 'unreferenced_source_document', 'sha256' => $document->sha256];
                }
            }
            foreach ($this->repository->query('legacy_rows')->get() as $row) {
                if (! hash_equals($row->row_hash, hash('sha256', SourceIdentity::canonical(json_decode($row->payload))))) {
                    $issues[] = ['code' => 'legacy_row_digest', 'id' => $row->source_id];
                }
            }
            foreach ($this->repository->query('legacy_objects')->get() as $row) {
                if (! $this->repository->query('object_references')->where('kind', 'object')->where('reference_id', $row->object_reference_id)->where('sha256', $row->sha256)->where('byte_length', $row->byte_length)->exists()) {
                    $issues[] = ['code' => 'legacy_object_reference', 'id' => $row->source_path];
                }
            }
            $invalid = DB::selectOne("SELECT count(*) AS count FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='accounting' AND NOT c.convalidated");
            if ((int) $invalid->count > 0) {
                $issues[] = ['code' => 'unvalidated_database_constraints'];
            }
            $children = $this->repository->query('review_events')->whereNotNull('prior_decision_id')->pluck('prior_decision_id')->all();
            $pending = $this->repository->query('review_events')->whereNotIn('id', $children)->where('state', 'open')->count();
            $incomplete = 0;
            foreach ($this->repository->query('reconstruction_reports')->get() as $row) {
                if (! json_decode($row->payload, true)['complete']) {
                    $incomplete++;
                }
            }
            try {
                $rates = (new ReferenceTables)->read();
                $months = (new ReportSnapshot($this->repository))->read()['months'];
                ReferenceTables::assertCoverage($rates, $months);
                $references = ReferenceTables::metadata($rates, $months);
            } catch (AccountingError $error) {
                $references = ['available' => false];
                $issues[] = ['code' => $error->errorCode];
            }

            return ['ledgerId' => $owner, 'integrityOk' => $issues === [], 'releaseReady' => $issues === [] && $pending === 0 && $incomplete === 0, 'issues' => $issues, 'openReviews' => $pending, 'incompleteReconstructions' => $incomplete, 'references' => $references, 'journalCount' => $this->repository->query('journals')->where('status', 'posted')->count(), 'objectReferenceCount' => $this->repository->query('object_references')->count()];
        });
    }
}
