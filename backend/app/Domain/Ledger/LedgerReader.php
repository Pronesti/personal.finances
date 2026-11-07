<?php

namespace App\Domain\Ledger;

use Brick\Math\BigInteger;
use Illuminate\Support\Facades\DB;

class LedgerReader
{
    public function __construct(private LedgerRepository $repository) {}

    public function inspection(int $page = 1, int $perPage = 20): array
    {
        return $this->repository->readSnapshot(fn () => $this->inspect($page, $perPage));
    }

    private function inspect(int $page, int $perPage): array
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
        $total = $query->count();
        $ids = $query->orderByDesc('effective_date')->orderByDesc('recorded_at')->orderByDesc('id')->offset(($page - 1) * $perPage)->limit($perPage)->pluck('id');

        return ['accounts' => $accounts, 'journals' => $ids->map(fn ($id) => $this->repository->journal($id))->all(), 'meta' => ['page' => $page, 'per_page' => $perPage, 'total' => $total]];
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
