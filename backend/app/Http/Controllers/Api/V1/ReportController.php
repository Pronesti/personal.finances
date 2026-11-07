<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Ledger\LedgerRepository;
use App\Domain\Processing\ProcessingBudget;
use App\Domain\Reports\AlertReviews;
use App\Domain\Reports\ReferenceTables;
use App\Domain\Reports\ReportCalculator;
use App\Domain\Reports\ReportSnapshot;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class ReportController extends Controller
{
    private const array REPORTS = ['overview', 'anomalies', 'trends', 'categories', 'merchants', 'movers', 'compare', 'sankey', 'calendar', 'habits', 'pace', 'recurring', 'currency', 'inflation', 'taxes', 'credits', 'float', 'future', 'installments', 'bank', 'super', 'super-products', 'super-categories'];

    private static function period(string $month, string $granularity): string
    {
        return match ($granularity) {
            'quarter' => substr($month, 0, 4).'-Q'.(int) ceil((int) substr($month, 5, 2) / 3),'year' => substr($month, 0, 4),'all' => 'all',default => $month
        };
    }

    public function show(Request $request, string $report, ReferenceTables $references, ReportCalculator $calculator): JsonResponse
    {
        abort_unless(in_array($report, self::REPORTS, true), 404);
        $query = $request->validate(['spend' => ['sometimes', 'string', 'max:30'], 'value' => ['sometimes', 'string', 'max:30'], 'tax' => ['sometimes', 'string', 'max:30'], 'g' => ['sometimes', 'string', 'max:30'], 'period' => ['sometimes', 'string', 'max:30'], 'account' => ['sometimes', 'nullable', 'string', 'max:200'], 'merchant' => ['sometimes', 'nullable', 'string', 'max:300'], 'day' => ['sometimes', 'date_format:Y-m-d']]);
        $snapshot = (new ReportSnapshot(new LedgerRepository($request->attributes->get('ledger'), $request->attributes->get('processing_budget'))))->read();
        $route = match ($report) {
            'overview' => '/','super-products' => '/super/products','super-categories' => '/super/categories',default => '/'.$report
        };
        $routes = json_decode(file_get_contents(resource_path('routes.json')), true);
        $controls = $routes[$route];
        $granularity = in_array($query['g'] ?? null, $controls['granularities'] ?? [], true) ? $query['g'] : 'month';
        $periods = array_values(array_unique(array_map(fn ($month) => self::period($month, $granularity), $snapshot['months'])));
        $period = null;
        if (isset($controls['period'])) {
            $period = in_array($query['period'] ?? null, $periods, true) ? $query['period'] : ($controls['period'] === 'all-first' ? 'all' : (end($periods) ?: ''));
        }
        $scope = ['basis' => ($query['spend'] ?? null) === 'cash' ? 'billed' : 'purchase', 'value' => in_array($query['value'] ?? null, ['nominal', 'usd'], true) ? $query['value'] : 'real', 'tax' => ($query['tax'] ?? null) === 'incl' ? 'incl' : 'excl', 'granularity' => $granularity, 'period' => $period];
        if (($controls['toggles']['spend'] ?? true) === false) {
            $scope['basis'] = 'purchase';
        }if (($controls['toggles']['tax'] ?? true) === false) {
            $scope['tax'] = 'excl';
        }
        $empty = $snapshot['facts'] === [] && $snapshot['supermarket']['receipts'] === [];
        $meta = ['report' => $report, 'scope' => $scope, 'months' => $snapshot['months'], 'periods' => $periods, 'controls' => $controls, 'cards' => $snapshot['cards'], 'accounts' => $snapshot['inspection']['accounts'], 'empty' => $empty, 'alertVersions' => (object) $snapshot['alertVersions']];
        if ($empty) {
            return response()->json(['data' => null, 'meta' => $meta]);
        }
        $rates = $references->read();
        $meta['references'] = ['cpiLatestMonth' => array_key_last($rates['cpi']), 'mepLatestMonth' => array_key_last($rates['mep']), 'stale' => ($snapshot['months'][array_key_last($snapshot['months'])] ?? '') > array_key_last($rates['cpi'])];
        $evidence = array_values(array_filter($snapshot['facts'], function ($fact) use ($scope, $query) {
            $month = $scope['basis'] === 'purchase' ? substr($fact['effectiveDate'], 0, 7) : ($fact['cycleMonth'] ?? substr($fact['effectiveDate'], 0, 7));

            return ($scope['period'] === null || $scope['period'] === 'all' || self::period($month, $scope['granularity']) === $scope['period']) && (! isset($query['account']) || (($fact['accountId'] ?? '') === $query['account'] || str_starts_with($fact['accountId'] ?? '', $query['account'].':'))) && (! isset($query['merchant']) || $fact['merchant'] === $query['merchant']);
        }));
        $meta['evidenceCount'] = count($evidence);
        $meta['evidence'] = array_slice($evidence, -200);
        $input = [...$snapshot, 'rates' => $rates, 'scope' => $scope, 'locale' => $request->getPreferredLanguage(['en', 'es']) ?? 'en', 'path' => ['account' => $query['account'] ?? null, 'merchant' => $query['merchant'] ?? null]];
        $budget = $request->attributes->get('processing_budget') ?? new ProcessingBudget(30000, 0);
        $models = $calculator->calculate($input, $budget);
        $data = match ($report) {
            'overview' => $models['commitments']['overview'],'anomalies' => ['alerts' => $models['commitments']['alerts'], 'cleared' => $models['commitments']['cleared'], 'timeline' => $models['commitments']['totals']],'trends' => $models['spending'],'categories' => $models['foodDrill'],'merchants' => $models['spending']['merchants'],'movers' => $models['spending']['movers'],'compare' => $models['spending']['compare'],'sankey' => $models['flow'],'calendar' => ['days' => $models['timing']['calendar'], 'selectedDate' => in_array($query['day'] ?? null, array_column($models['timing']['calendar'], 'date'), true) ? $query['day'] : (array_column($models['timing']['calendar'], 'date')[array_key_last($models['timing']['calendar'])] ?? null)],'habits' => $models['timing'],'pace' => $models['pace'],'recurring' => $models['commitments']['recurring'],'currency' => $models['currency'],'inflation' => $models['commitments']['inflation'],'taxes' => $models['commitments']['taxes'],'credits' => $models['commitments']['credits'],'float' => $models['commitments']['float'],'future' => ['forecast' => $models['commitments']['forecast'], 'coverage' => $models['commitments']['coverage']],'installments' => $models['commitments']['installments'],'bank' => ['bank' => $models['commitments']['bank'], 'realBank' => $models['commitments']['realBank']],'super','super-products' => $models['supermarket'],'super-categories' => ['periods' => $models['supermarket']['periods'], 'categories' => $models['supermarket']['categories'], 'accounts' => $models['receiptAllocations']]
        };
        if ($report === 'calendar') {
            $data['evidence'] = array_slice(array_values(array_filter($snapshot['facts'], fn ($fact) => $fact['effectiveDate'] === $data['selectedDate'])), 0, 200);
        }
        if ($report === 'float') {
            $data = array_map(function ($row) use ($models) {
                $tax = array_values(array_filter($models['commitments']['taxes'], fn ($tax) => $tax['period'] === $row['period']))[0] ?? null;

                return [...$row, 'recordedInterest' => $tax['interest'] ?? 0];
            }, $data);
        }

        return response()->json(['data' => $data, 'meta' => $meta]);
    }

    public function review(Request $request, string $id, ReferenceTables $references, ReportCalculator $calculator): JsonResponse
    {
        $input = $request->validate(['state' => ['required', Rule::in(['open', 'reviewed', 'dismissed'])], 'expectedPreviousDecisionId' => ['present', 'nullable', 'uuid']]);
        abort_if(strlen($id) > 500, 404);
        $key = $request->header('Idempotency-Key');
        validator(['key' => $key], ['key' => ['required', 'string', 'max:200', 'regex:/^[A-Za-z0-9._:-]+$/D']])->validate();
        $budget = $request->attributes->get('processing_budget') ?? new ProcessingBudget(30000, 0);

        return response()->json((new AlertReviews(new LedgerRepository($request->attributes->get('ledger'), $budget)))->decide([...$input, 'alertId' => $id, 'key' => $key, 'recordedAt' => now()->toIso8601String(), 'locale' => $request->getPreferredLanguage(['en', 'es']) ?? 'en'], $references, $calculator, $budget));
    }
}
