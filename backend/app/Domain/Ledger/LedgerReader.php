<?php

namespace App\Domain\Ledger;

use App\Domain\Catalog\CatalogSettings;
use Brick\Math\BigInteger;
use Illuminate\Support\Facades\DB;

class LedgerReader
{
    public function __construct(private LedgerRepository $repository) {}

    public function inspection(int $page = 1, int $perPage = 20, ?string $journal = null): array
    {
        return $this->repository->readSnapshot(fn () => $this->inspect($page, $perPage, $journal));
    }

    private function inspect(int $page, int $perPage, ?string $journal): array
    {
        $owner = $this->repository->ledger->id;
        $balances = DB::select("SELECT l.account_id,j.currency,sum(l.debit_minor-l.credit_minor)::text AS minor FROM accounting.journal_lines l JOIN accounting.journals j ON j.ledger_id=l.ledger_id AND j.id=l.journal_id WHERE l.ledger_id=? AND j.status='posted' GROUP BY l.account_id,j.currency", [$owner]);
        $byAccount = [];
        foreach ($balances as $row) {
            $byAccount[$row->account_id][$row->currency] = $row->minor;
        }
        $accounts = $this->repository->query('accounts')->orderBy('id')->get()->map(function ($row) use ($byAccount) {
            $amounts = $byAccount[$row->id] ?? ['ARS' => '0', 'USD' => '0'];
            if (in_array($row->type, ['liability', 'income', 'equity'], true)) {
                foreach ($amounts as &$amount) {
                    $amount = (string) BigInteger::of($amount)->negated();
                }
                unset($amount);
            }

            return ['id' => $row->id, 'parentId' => $row->parent_id, 'type' => $row->type, 'labelKey' => $row->label_key, 'customName' => $row->custom_name, 'currency' => $row->currency, 'posting' => $row->posting, 'enabled' => $row->enabled, 'balances' => ['ARS' => $amounts['ARS'] ?? '0', 'USD' => $amounts['USD'] ?? '0']];
        })->all();
        $query = $this->repository->query('journals')->where('status', 'posted');
        if ($journal !== null) {
            $query->where('id', $journal);
            abort_unless((clone $query)->exists(), 404);
            $page = 1;
        }
        $total = $query->count();
        $ids = $query->orderByDesc('effective_date')->orderByDesc('recorded_at')->orderByDesc('id')->offset(($page - 1) * $perPage)->limit($perPage)->pluck('id');

        $allJournals = $this->repository->query('journals')->where('status', 'posted')->pluck('id')->map(fn ($id) => $this->repository->journal($id))->all();
        $groups = (new CatalogSettings($this->repository))->groups();
        $measures = new NativeMeasures;
        $groupMeasures = [];
        $purposeMeasures = [];
        $state = $this->repository->state(null, null);
        $purchases = $this->repository->query('purchases')->pluck('id')->map(fn ($id) => $this->repository->purchase($id))->all();
        foreach (['ARS', 'USD'] as $currency) {
            $groupMeasures[$currency] = $measures->groups($groups, $accounts, $allJournals, $currency, '0001-01-01', '9999-12-31');
            foreach ($this->repository->query('cards')->pluck('id') as $card) {
                $purposeMeasures[] = ['cardId' => $card, 'currency' => $currency, 'rows' => $measures->purposes($accounts, $allJournals, $purchases, $state, $card, $currency, '0001-01-01', '9999-12-31')];
            }
        }

        $coverage = [];
        foreach ($allJournals as $journal) {
            if ($journal['kind'] !== 'opening') {
                continue;
            }
            $supported = BigInteger::zero();
            foreach ($this->repository->payloads('opening_obligations', ['opening_journal_id' => $journal['id']]) as $obligation) {
                $supported = $supported->plus($obligation['remainingMinor']);
            }
            $cycle = $this->repository->query('statement_cycles')->where('card_id', $journal['cardId'])->where('closing_date', '<=', $journal['effectiveDate'])->orderByDesc('closing_date')->first();
            $schedule = BigInteger::zero();
            if ($cycle !== null && $journal['currency'] === 'ARS') {
                foreach ($this->repository->query('issuer_schedules')->where('revision_id', $cycle->revision_id)->get() as $entry) {
                    $schedule = $schedule->plus(Money::source(json_decode($entry->payload, true)['amount_ars']));
                }
            }
            $unproven = $schedule->minus($supported);
            $coverage[] = ['journalId' => $journal['id'], 'cardId' => $journal['cardId'], 'currency' => $journal['currency'], 'observationDate' => $journal['effectiveDate'], 'supportedUnbilledMinor' => (string) $supported, 'futureAggregateMinor' => $cycle === null ? null : (string) $schedule, 'unprovenFutureMinor' => $cycle === null ? null : (string) BigInteger::max($unproven, 0), 'completeFuturePrincipalKnown' => false, 'completeHistoricalCoverage' => false];
        }

        return ['openingCoverage' => $coverage, 'groups' => $groups, 'groupMeasures' => $groupMeasures, 'purposeMeasures' => $purposeMeasures, 'accounts' => $accounts, 'journals' => $ids->map(fn ($id) => $this->repository->journal($id))->all(), 'meta' => ['page' => $page, 'per_page' => $perPage, 'total' => $total]];
    }

    public function evidence(string $id): ?array
    {
        $line = $this->repository->query('source_lines')->where('id', $id)->first();
        $revision = $this->repository->query('source_revisions')->where('id', $line?->revision_id ?? $id)->first();
        if ($revision === null) {
            return null;
        }

        return ['revision' => json_decode($revision->payload, true, flags: JSON_THROW_ON_ERROR), 'line' => $line === null ? null : json_decode($line->payload, true, flags: JSON_THROW_ON_ERROR), 'documentHash' => $revision->document_hash];
    }
}
