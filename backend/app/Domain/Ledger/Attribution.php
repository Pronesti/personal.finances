<?php

namespace App\Domain\Ledger;

class Attribution
{
    public static function eventOrder(array $first, array $second): int
    {
        foreach (['effectiveDate', 'recordedAt', 'id'] as $key) {
            $order = strcmp($first[$key], $second[$key]);
            if ($order !== 0) {
                return $order;
            }
        }

        return 0;
    }

    public static function oldest(int $amount, array $components): array
    {
        $remaining = Money::minor($amount);
        usort($components, fn ($a, $b) => strcmp($a['billedDate'], $b['billedDate']) ?: strcmp($a['purchaseDate'], $b['purchaseDate']) ?: strcmp($a['id'], $b['id']));
        $assigned = [];
        $seen = [];
        foreach ($components as $component) {
            if (isset($seen[$component['id']])) {
                throw new AccountingError('duplicate_component');
            }
            $seen[$component['id']] = true;
            $minor = min($remaining, Money::minor($component['outstandingMinor']));
            $remaining -= $minor;
            if ($minor > 0) {
                $assigned[] = ['componentId' => $component['id'], 'purposeId' => $component['purposeId'], 'minor' => $minor];
            }
        }

        return ['assigned' => $assigned, 'unappliedMinor' => $remaining];
    }

    public static function revisedBillings(array $billings, array $revisions): array
    {
        return array_map(function ($billing) use ($revisions) {
            $latest = [];
            $newest = null;
            foreach ($revisions as $revision) {
                if ($revision['billingId'] !== $billing['id']) {
                    continue;
                }
                $id = $revision['componentId'];
                if (! isset($latest[$id]) || $latest[$id]['revision'] < $revision['revision']) {
                    $latest[$id] = $revision;
                }
                if ($newest === null || $newest['revision'] < $revision['revision']) {
                    $newest = $revision;
                }
            }
            $components = [];
            foreach ($billing['components'] as $component) {
                $components[$component['id']] = $component;
            }
            foreach ($latest as $id => $revision) {
                $components[$id] = ['id' => $id, 'purposeId' => $revision['purposeId'], 'minor' => $revision['minor']];
            }
            $billing['components'] = array_values(array_filter($components, fn ($row) => $row['minor'] > 0));
            $billing['purchaseDate'] = $newest['purchaseDate'] ?? $billing['purchaseDate'];

            return $billing;
        }, $billings);
    }

    private static function reserved(array $payments, array $event, string $component): int
    {
        $sum = 0;
        foreach ($payments as $payment) {
            if (self::eventOrder($payment, $event) > 0) {
                foreach ($payment['issuerAllocations'] ?? [] as $allocation) {
                    if ($allocation['componentId'] === $component) {
                        $sum = Money::minor($sum + Money::minor($allocation['minor']));
                    }
                }
            }
        }

        return $sum;
    }

    public static function outstanding(array $billings, array $attributions, array $credits, array $revisions = [], array $markers = [], array $payments = []): array
    {
        $latest = [];
        foreach (array_merge($markers, $attributions) as $row) {
            $latest[$row['paymentId']] = max($latest[$row['paymentId']] ?? 0, $row['revision']);
        }
        $components = [];
        foreach (self::revisedBillings($billings, $revisions) as $billing) {
            foreach ($billing['components'] as $component) {
                $components[$component['id']] = ['id' => $component['id'], 'purchaseId' => $billing['purchaseId'], 'cardId' => $billing['cardId'], 'purposeId' => $component['purposeId'], 'currency' => $billing['currency'], 'billedDate' => $billing['effectiveDate'], 'purchaseDate' => $billing['purchaseDate'], 'outstandingMinor' => $component['minor']];
            }
        }
        $active = array_filter($attributions, fn ($row) => $row['revision'] === $latest[$row['paymentId']]);
        $paymentIds = array_column($payments, 'id');
        foreach ($active as $allocation) {
            if (! in_array($allocation['paymentId'], $paymentIds, true) && isset($components[$allocation['componentId']])) {
                $component = &$components[$allocation['componentId']];
                $component['outstandingMinor'] = max(0, $component['outstandingMinor'] - $allocation['minor']);
                unset($component);
            }
        }
        $events = array_merge(array_map(fn ($row) => [...$row, 'type' => 'payment'], $payments), array_map(fn ($row) => [...$row, 'type' => 'credit'], $credits));
        usort($events, self::eventOrder(...));
        foreach ($events as $event) {
            if ($event['type'] === 'payment') {
                foreach ($active as $allocation) {
                    if ($allocation['paymentId'] === $event['id'] && isset($components[$allocation['componentId']])) {
                        $component = &$components[$allocation['componentId']];
                        $component['outstandingMinor'] = max(0, $component['outstandingMinor'] - $allocation['minor']);
                        unset($component);
                    }
                }
            } else {
                $available = [];
                foreach ($components as $component) {
                    if ($component['purchaseId'] === $event['purchaseId'] && $component['billedDate'] <= $event['effectiveDate']) {
                        $component['outstandingMinor'] = max(0, $component['outstandingMinor'] - self::reserved($payments, $event, $component['id']));
                        $available[] = $component;
                    }
                }
                foreach (self::oldest($event['billedReductionMinor'], $available)['assigned'] as $allocation) {
                    $components[$allocation['componentId']]['outstandingMinor'] -= $allocation['minor'];
                }
            }
        }

        return array_values($components);
    }

    public static function replay(array $state): array
    {
        $payments = $state['payments'];
        usort($payments, self::eventOrder(...));
        $decisions = [];
        $rows = [];
        foreach ($payments as $payment) {
            $credits = array_values(array_filter($state['credits'], fn ($row) => self::eventOrder($row, $payment) <= 0));
            $components = array_values(array_filter(self::outstanding($state['billings'], $rows, $credits, $state['componentRevisions'], [], $payments), fn ($row) => $row['billedDate'] <= $payment['effectiveDate']));
            $available = array_map(function ($row) use ($payments, $payment) {
                $row['outstandingMinor'] = max(0, $row['outstandingMinor'] - self::reserved($payments, $payment, $row['id']));

                return $row;
            }, $components);
            $decision = self::oldest($payment['amountMinor'], $available);
            if ($payment['issuerAllocations'] !== null) {
                $assigned = [];
                $seen = [];
                $sum = 0;
                foreach ($payment['issuerAllocations'] as $allocation) {
                    $matches = array_values(array_filter($components, fn ($row) => $row['id'] === $allocation['componentId']));
                    $minor = Money::minor($allocation['minor']);
                    if (count($matches) !== 1 || isset($seen[$allocation['componentId']]) || $minor === 0 || $minor > $matches[0]['outstandingMinor']) {
                        throw new AccountingError('invalid_issuer_allocation');
                    }
                    $component = $matches[0];
                    $seen[$component['id']] = true;
                    $sum = Money::minor($sum + $minor);
                    $assigned[] = ['componentId' => $component['id'], 'purposeId' => $component['purposeId'], 'minor' => $minor];
                }
                if ($sum > $payment['amountMinor']) {
                    throw new AccountingError('invalid_issuer_allocation');
                }
                $decision = ['assigned' => $assigned, 'unappliedMinor' => $payment['amountMinor'] - $sum];
            }
            $decisions[] = ['paymentId' => $payment['id'], ...$decision];
            foreach ($decision['assigned'] as $allocation) {
                $rows[] = [...$allocation, 'paymentId' => $payment['id'], 'revision' => 1];
            }
        }

        return $decisions;
    }
}
