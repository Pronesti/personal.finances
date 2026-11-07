<?php

namespace App\Domain\Ledger;

use App\Models\Ledger;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/** Every SQL read, write and lock carries the explicitly resolved owner. */
class LedgerRepository
{
    private const array TABLES = ['accounts', 'cards', 'evidence', 'commands', 'journals', 'journal_lines', 'journal_evidence', 'purchases', 'purchase_versions', 'billings', 'billed_components', 'payments', 'attributions', 'linked_credits', 'correction_links', 'component_revisions', 'credit_revisions', 'attribution_revisions', 'opening_obligations', 'opening_obligation_evidence'];

    public function __construct(public readonly Ledger $ledger)
    {
        if (! $ledger->exists || ! Str::isUuid($ledger->id)) {
            throw new AccountingError('missing_ledger_context');
        }
    }

    public function transaction(callable $work): mixed
    {
        return DB::transaction(function () use ($work) {
            if (DB::connection()->getDriverName() !== 'pgsql') {
                throw new AccountingError('postgres_required');
            }
            DB::select('SELECT pg_advisory_xact_lock(hashtextextended(?, 8581401))', [$this->ledger->id]);

            return $work($this);
        });
    }

    public function query(string $table): Builder
    {
        if (! in_array($table, self::TABLES, true)) {
            throw new AccountingError('invalid_repository_table');
        }

        return DB::table('accounting.'.$table)->where('ledger_id', $this->ledger->id);
    }

    public function insert(string $table, array $row, bool $surrogate = true): void
    {
        if (DB::transactionLevel() < 1) {
            throw new AccountingError('transaction_required');
        }
        if (isset($row['ledger_id']) && $row['ledger_id'] !== $this->ledger->id) {
            throw new AccountingError('owner_scope_conflict');
        }
        $this->query($table)->insert(['ledger_id' => $this->ledger->id, ...($surrogate ? ['row_id' => Str::uuid()->toString()] : []), ...$row]);
    }

    public static function json(mixed $value): string
    {
        return json_encode($value, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    }

    public function payloads(string $table, array $filters = []): array
    {
        $query = $this->query($table);
        foreach ($filters as $key => $value) {
            $query->where($key, $value);
        }

        return $query->orderBy('row_id')->get()->map(fn ($row) => json_decode($row->payload, true, flags: JSON_THROW_ON_ERROR))->all();
    }

    public function purchase(string $id): ?array
    {
        $row = $this->query('purchase_versions')->where('purchase_id', $id)->orderByDesc('version')->first();

        return $row === null ? null : json_decode($row->payload, true, flags: JSON_THROW_ON_ERROR);
    }

    public function appendPurchase(array $purchase): void
    {
        if (! $this->query('purchases')->where('id', $purchase['purchaseId'])->exists()) {
            $this->insert('purchases', ['id' => $purchase['purchaseId'], 'card_id' => $purchase['cardId'], 'currency' => $purchase['currency']]);
        }
        $this->insert('purchase_versions', ['purchase_id' => $purchase['purchaseId'], 'version' => $purchase['version'], 'journal_id' => $purchase['journalId'], 'principal_minor' => $purchase['principalMinor'], 'payload' => self::json($purchase)]);
    }

    public function appendJournal(array $journal): void
    {
        $this->insert('journals', ['id' => $journal['id'], 'command_key' => $journal['commandKey'], 'card_id' => $journal['cardId'], 'currency' => $journal['currency'], 'effective_date' => $journal['effectiveDate'], 'recorded_at' => $journal['recordedAt'], 'kind' => $journal['kind'], 'reverses_id' => $journal['reversesId']]);
        foreach ($journal['lines'] as $ordinal => $line) {
            $this->insert('journal_lines', ['journal_id' => $journal['id'], 'ordinal' => $ordinal, 'account_id' => $line['accountId'], 'debit_minor' => $line['debitMinor'], 'credit_minor' => $line['creditMinor'], 'purchase_id' => $line['purchaseId'], 'purpose_id' => $line['purposeId']], false);
        }
        foreach ($journal['evidenceIds'] as $id) {
            $this->insert('journal_evidence', ['journal_id' => $journal['id'], 'evidence_id' => $id], false);
        }
        $this->query('journals')->where('id', $journal['id'])->update(['status' => 'posted']);
    }

    public function journal(string $id): ?array
    {
        $row = $this->query('journals')->where('id', $id)->where('status', 'posted')->first();
        if ($row === null) {
            return null;
        }

        return ['id' => $row->id, 'commandKey' => $row->command_key, 'cardId' => $row->card_id, 'currency' => $row->currency, 'effectiveDate' => $row->effective_date, 'recordedAt' => $row->recorded_at, 'kind' => $row->kind, 'reversesId' => $row->reverses_id, 'lines' => $this->query('journal_lines')->where('journal_id', $id)->orderBy('ordinal')->get()->map(fn ($line) => ['accountId' => $line->account_id, 'debitMinor' => (int) $line->debit_minor, 'creditMinor' => (int) $line->credit_minor, 'purchaseId' => $line->purchase_id, 'purposeId' => $line->purpose_id])->all(), 'evidenceIds' => $this->query('journal_evidence')->where('journal_id', $id)->orderBy('evidence_id')->pluck('evidence_id')->all()];
    }

    public function appendBilling(array $billing): void
    {
        $this->insert('billings', ['id' => $billing['id'], 'purchase_id' => $billing['purchaseId'], 'opening_obligation_id' => $billing['openingObligationId'] ?? null, 'card_id' => $billing['cardId'], 'currency' => $billing['currency'], 'installment' => $billing['installment'], 'amount_minor' => $billing['amountMinor'], 'journal_id' => $billing['journalId'], 'payload' => self::json($billing)]);
        foreach ($billing['components'] as $component) {
            $this->insert('billed_components', ['id' => $component['id'], 'billing_id' => $billing['id'], 'purpose_id' => $component['purposeId'], 'minor' => $component['minor']]);
        }
    }

    public function appendComponentRevision(array $revision): void
    {
        if ($revision['minor'] > 0 && ! $this->query('billed_components')->where('id', $revision['componentId'])->exists()) {
            $this->insert('billed_components', ['id' => $revision['componentId'], 'billing_id' => $revision['billingId'], 'purpose_id' => $revision['purposeId'], 'minor' => $revision['minor']]);
        }
        $this->insert('component_revisions', ['id' => $revision['id'], 'component_id' => $revision['componentId'], 'billing_id' => $revision['billingId'], 'revision' => $revision['revision'], 'purpose_id' => $revision['purposeId'], 'minor' => $revision['minor'], 'purchase_date' => $revision['purchaseDate']]);
    }

    public function state(string $card, string $currency): array
    {
        $filter = ['card_id' => $card, 'currency' => $currency];
        $billings = $this->payloads('billings', $filter);
        $payments = $this->payloads('payments', $filter);
        $purchaseIds = $this->query('purchases')->where('card_id', $card)->where('currency', $currency)->pluck('id')->all();
        $credits = array_values(array_filter($this->payloads('linked_credits'), fn ($row) => in_array($row['purchaseId'], $purchaseIds, true)));
        foreach ($credits as &$credit) {
            $latest = $this->query('credit_revisions')->where('credit_id', $credit['id'])->orderByDesc('purchase_version')->first();
            if ($latest !== null) {
                $credit = json_decode($latest->payload, true, flags: JSON_THROW_ON_ERROR);
            }
        }
        unset($credit);
        $billingIds = array_column($billings, 'id');
        $paymentIds = array_column($payments, 'id');
        $components = $this->query('component_revisions')->whereIn('billing_id', $billingIds)->get()->map(fn ($row) => ['id' => $row->id, 'componentId' => $row->component_id, 'billingId' => $row->billing_id, 'revision' => (int) $row->revision, 'purposeId' => $row->purpose_id, 'minor' => (int) $row->minor, 'purchaseDate' => $row->purchase_date])->all();
        $attributions = $this->query('attributions')->whereIn('payment_id', $paymentIds)->get()->map(fn ($row) => ['id' => $row->id, 'paymentId' => $row->payment_id, 'componentId' => $row->component_id, 'purposeId' => $row->purpose_id, 'minor' => (int) $row->minor, 'method' => $row->method, 'revision' => (int) $row->revision])->all();
        $markers = $this->query('attribution_revisions')->whereIn('payment_id', $paymentIds)->get()->map(fn ($row) => ['paymentId' => $row->payment_id, 'revision' => (int) $row->revision, 'unappliedMinor' => (int) $row->unapplied_minor])->all();

        return ['billings' => $billings, 'payments' => $payments, 'credits' => $credits, 'componentRevisions' => $components, 'attributions' => $attributions, 'attributionRevisions' => $markers];
    }

    public function replay(string $card, string $currency): void
    {
        $state = $this->state($card, $currency);
        foreach (Attribution::replay($state) as $decision) {
            $payment = array_values(array_filter($state['payments'], fn ($row) => $row['id'] === $decision['paymentId']))[0];
            $revision = 0;
            foreach (array_merge($state['attributions'], $state['attributionRevisions']) as $row) {
                if ($row['paymentId'] === $payment['id']) {
                    $revision = max($revision, $row['revision']);
                }
            }
            $old = array_values(array_filter($state['attributions'], fn ($row) => $row['paymentId'] === $payment['id'] && $row['revision'] === $revision));
            $markers = array_values(array_filter($state['attributionRevisions'], fn ($row) => $row['paymentId'] === $payment['id'] && $row['revision'] === $revision));
            $shape = function ($rows) {
                $out = array_map(fn ($row) => ['componentId' => $row['componentId'], 'purposeId' => $row['purposeId'], 'minor' => $row['minor']], $rows);
                usort($out, fn ($a, $b) => strcmp($a['componentId'], $b['componentId']));

                return $out;
            };
            if ($markers !== [] && $markers[0]['unappliedMinor'] === $decision['unappliedMinor'] && $shape($old) === $shape($decision['assigned'])) {
                continue;
            }
            $this->insert('attribution_revisions', ['payment_id' => $payment['id'], 'revision' => $revision + 1, 'unapplied_minor' => $decision['unappliedMinor']], false);
            foreach ($decision['assigned'] as $allocation) {
                $this->insert('attributions', ['id' => Str::uuid()->toString(), 'payment_id' => $payment['id'], 'component_id' => $allocation['componentId'], 'purpose_id' => $allocation['purposeId'], 'minor' => $allocation['minor'], 'method' => $payment['issuerAllocations'] === null ? 'oldest_billed_first' : 'issuer', 'revision' => $revision + 1]);
            }
        }
    }
}
