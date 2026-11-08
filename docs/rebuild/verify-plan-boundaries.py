#!/usr/bin/env python3
"""Static FK-tuple, cookie-domain and ingress-deadline oracles; no runtime proof."""
import json
from pathlib import Path
from urllib.parse import urlsplit
from uuid import UUID


def domain_matches(host, cookie_domain):
    host = host.lower().rstrip('.')
    domain = cookie_domain.lower().lstrip('.').rstrip('.')
    return host == domain or host.endswith('.' + domain)


def environment(root, name):
    return dict(line.split('=', 1) for line in (root / name).read_text().splitlines()
                if line and not line.startswith('#'))


def deadline_outcome(case, contract):
    """Compose cumulative non-OCR, OCR-attempt and original request limits."""
    limits = contract['timeouts']
    protocol = contract['ingress_deadline']
    total = limits['request_wall_clock_seconds'] * 1000
    upload_limit = limits['upload_max_seconds'] * 1000
    non_ocr_limit = limits['non_ocr_total_max_seconds'] * 1000
    attempt_limit = limits['ocr_attempt_max_seconds'] * 1000
    mode = case.get('mode', 'normal')
    assert mode in ['normal', 'outer_watchdog_fault_injection'], 'unknown deadline test mode'
    injection = case.get('fault_injection')
    if mode == 'normal':
        assert injection is None, 'normal requests cannot disable guards'
    else:
        assert injection == {'test_harness_only': True,
                             'disabled_guards': ['non_ocr_budget']}, 'unapproved fault injection'
    enforce_non_ocr = mode == 'normal'
    upload = case['upload_ms']
    entry = upload + case['upstream_queue_ms']
    result = {'status': 200, 'code': 'ok', 'backend_started': False,
              'backend_entry_elapsed_ms': None, 'raw_remaining_ms': None,
              'processing_budget_ms': 0, 'finished_elapsed_ms': 0,
              'worker_cancelled': False, 'financial_postings': 0,
              'client_metadata_used': False, 'non_ocr_consumed_ms': 0,
              'non_ocr_remaining_ms_at_backend_entry': None, 'ocr_attempts_started': 0}
    # Expiry wins ties. Upload-timeout has diagnostic priority at the equal edge limits.
    if upload >= upload_limit:
        return {**result, 'status': 408, 'code': 'upload_timeout',
                'finished_elapsed_ms': upload_limit, 'non_ocr_consumed_ms': upload_limit}
    if enforce_non_ocr and entry >= non_ocr_limit:
        return {**result, 'status': 504, 'code': 'non_ocr_budget_exceeded',
                'finished_elapsed_ms': non_ocr_limit, 'non_ocr_consumed_ms': non_ocr_limit}
    if entry >= total:
        return {**result, 'status': 504, 'code': 'request_deadline_exceeded',
                'finished_elapsed_ms': total, 'non_ocr_consumed_ms': total}
    result.update(backend_started=True, backend_entry_elapsed_ms=entry,
                  finished_elapsed_ms=entry, non_ocr_consumed_ms=entry)
    if (case['trusted_metadata'] != 'valid'
            or case['trusted_deadline_unix_ms'] != case['trusted_started_at_unix_ms'] + total):
        return {**result, 'status': protocol['missing_or_invalid_metadata_status'],
                'code': 'deadline_metadata_invalid'}
    phases = case['processing_phases']
    assert sum(phase['duration_ms'] for phase in phases) == case['requested_processing_ms'], 'phase total differs'
    attempts = [phase['attempt'] for phase in phases if phase['kind'] == 'ocr']
    assert attempts == list(range(1, len(attempts) + 1)) and len(attempts) <= limits['ocr_attempts_max'], 'invalid OCR attempt sequence'
    # Only active OCR pauses the non-OCR clock. Queues and parent wait overhead do not.
    remaining = total - entry
    budget = max(0, remaining - protocol['clock_safety_margin_ms'])
    result.update(raw_remaining_ms=remaining, processing_budget_ms=budget,
                  non_ocr_remaining_ms_at_backend_entry=max(0, non_ocr_limit - entry))
    elapsed = entry
    non_ocr = entry
    for phase in phases + [{'name': 'precommit_cleanup', 'kind': 'non_ocr', 'duration_ms': case['cleanup_ms']}]:
        assert phase['kind'] in ['ocr', 'non_ocr'], 'unknown processing phase'
        candidates = [(max(0, entry + budget - elapsed), 'processing_timeout')]
        if phase['kind'] == 'non_ocr' and enforce_non_ocr:
            candidates.append((max(0, non_ocr_limit - non_ocr), 'non_ocr_budget_exceeded'))
        if phase['kind'] == 'ocr':
            result['ocr_attempts_started'] += 1
            candidates.append((attempt_limit, 'ocr_attempt_timeout'))
        allowance, code = min(candidates, key=lambda candidate: candidate[0])
        consumed = min(phase['duration_ms'], allowance)
        elapsed += consumed
        if phase['kind'] == 'non_ocr':
            non_ocr += consumed
        if phase['duration_ms'] >= allowance:
            return {**result, 'status': 504, 'code': code,
                    'finished_elapsed_ms': elapsed, 'non_ocr_consumed_ms': non_ocr,
                    'worker_cancelled': elapsed > entry}
    # Synthetic phases are precommit work; the fixture admits one atomic command only now.
    return {**result, 'finished_elapsed_ms': elapsed,
            'non_ocr_consumed_ms': non_ocr, 'financial_postings': 1}


def verify(root, check):
    contract = json.loads((root / 'architecture-contract.json').read_text())
    fixture = json.loads((root / 'isolation-fixtures.json').read_text())
    envs = {'development': environment(root, 'backend.env.example'),
            'integration': environment(root, 'backend.testing.env.example'),
            'browser': environment(root, 'backend.browser-testing.env.example')}
    check('cookie-domain-label-boundaries', domain_matches('app.tarjetas.test', '.tarjetas.test')
          and domain_matches('tarjetas.test', '.tarjetas.test')
          and not domain_matches('app.evil-tarjetas.test', '.tarjetas.test'))
    for name, env in envs.items():
        check('cookie-parent-covers-own-hosts-' + name,
              all(domain_matches(urlsplit(env[key]).hostname, env['SESSION_DOMAIN'])
                  for key in ['APP_URL', 'FRONTEND_URL']))
        for other_name, other in envs.items():
            if name == other_name:
                continue
            check('cookie-domain-excludes-' + name + '-from-' + other_name,
                  not any(domain_matches(urlsplit(other[key]).hostname, env['SESSION_DOMAIN'])
                          for key in ['APP_URL', 'FRONTEND_URL']))
            check('cookie-parents-disjoint-' + name + '-' + other_name,
                  not domain_matches(other['SESSION_DOMAIN'].lstrip('.'), env['SESSION_DOMAIN']))
    check('cookie-environment-contract-required',
          contract['test_safety']['cookie_domains_disjoint_from_other_environments'] is True
          and contract['authentication']['csrf_cookie_name'] == 'XSRF-TOKEN')
    for name in ['integration', 'browser']:
        target = contract['test_environments'][name]
        env = envs[name]
        check('cookie-example-matches-contract-' + name,
              target['api_origin'] == env['APP_URL'] and target['frontend_origin'] == env['FRONTEND_URL']
              and target['session_domain'] == env['SESSION_DOMAIN']
              and target['session_cookie'] == env['SESSION_COOKIE']
              and target['environment_example'] == ('backend.testing.env.example' if name == 'integration'
                                                     else 'backend.browser-testing.env.example'))

    check('owner-account-fixture-declared', 'accounts' in fixture and len(fixture['accounts']) == 3)
    accounts = fixture['accounts']
    parents = {(row['ledger_id'], row['id']) for row in accounts}
    check('owner-account-tuples-and-surrogates-unique', len(parents) == len(accounts)
          and len({str(UUID(row['row_id'])) for row in accounts}) == len(accounts))
    owner = {u['id']: u['ledger_id'] for u in fixture['identities']}
    a, b = owner['user-a'], owner['user-b']
    cross = fixture['cross_owner_reference']
    attempted = tuple(cross['attempted_child_key'])
    check('fk-child-and-parent-column-contract', cross['layer'] == 'raw_postgresql_constraint'
          and cross['child_table'] == 'accounting.account_name_revisions'
          and cross['parent_table'] == 'accounting.accounts'
          and cross['child_columns'] == ['ledger_id', 'account_id']
          and cross['parent_columns'] == ['ledger_id', 'id'])
    check('fk-negative-tuple-really-absent', cross['actor'] == 'user-a'
          and attempted[0] == a and attempted not in parents)
    check('fk-referenced-account-really-b-exclusive', cross['referenced_owner_ledger_id'] == b
          and (b, attempted[1]) in parents and {ledger for ledger, key in parents if key == attempted[1]} == {b})
    check('fk-exact-database-error-and-no-write-oracle', cross['expected_sqlstate'] == '23503'
          and cross['expected'] == 'database_foreign_key_rejection_no_partial_write'
          and cross['expected_state_unchanged'] is True
          and cross['application_rejection_counts_as_database_proof'] is False)
    pantry = fixture['shared_account_id']
    expected_controls = [(a, pantry), (b, pantry), (b, attempted[1])]
    controls = fixture['database_reference_controls']
    check('fk-shared-and-exclusive-positive-controls', [tuple(x['child_key']) for x in controls] == expected_controls
          and all(tuple(x['child_key']) in parents and x['expected_sqlstate'] == '00000'
                  and x['resolved_owner_ledger_id'] == x['child_key'][0]
                  and x['rollback_after_case'] is True for x in controls))
    forged = fixture['forged_owner_request']
    check('forged-owner-request-is-separate-application-proof', forged['actor'] == 'user-a'
          and forged['body_ledger_id'] == b and forged['resource_key'] == pantry
          and forged['expected_status'] == 400 and forged['expected_code'] == 'owner_scope_conflict'
          and forged['expected_state_unchanged'] is True
          and forged['layer'] == 'application_authorization_not_database_constraint')

    check('trusted-ingress-deadline-declared', 'ingress_deadline' in contract)
    protocol = contract['ingress_deadline']
    check('deadline-origin-before-any-buffering', protocol['authority'] == 'first_trusted_ingress'
          and protocol['start_event'] == 'first_request_byte_before_any_body_buffering')
    check('deadline-trusted-metadata-and-spoofing-policy',
          protocol['metadata_transport'] == 'protected_fastcgi_parameters_or_authenticated_private_hop'
          and protocol['metadata_fields'] == ['request_id', 'started_at_unix_ms', 'deadline_unix_ms']
          and protocol['client_metadata_policy'] == 'discard_and_replace'
          and protocol['direct_backend_bypass_allowed'] is False)
    check('deadline-edge-timers-and-cancellation', protocol['edge_total_timer_required'] is True
          and protocol['edge_upload_total_timer_required'] is True
          and protocol['cancel_upstream_and_process_groups'] is True)
    check('deadline-never-reset-at-backend-or-worker', protocol['backend_may_reset_deadline'] is False
          and protocol['deadline_preserved_across_processing_hops'] is True
          and protocol['read_timeout_is_total_deadline'] is False)
    check('deadline-invalid-metadata-and-clock-margin', protocol['missing_or_invalid_metadata_status'] == 503
          and protocol['maximum_clock_skew_ms'] == protocol['clock_safety_margin_ms'] == 1000)
    timing_fixture = json.loads((root / 'deadline-fixtures.json').read_text())
    cases = timing_fixture['cases']
    required = {'buffered_upload_then_success', 'buffered_upload_then_processing_timeout',
                'upstream_queue_exhausts_non_ocr_budget', 'upload_total_limit_is_not_an_inactivity_timer',
                'client_cannot_restart_deadline_after_upload', 'missing_trusted_metadata_fails_before_processing',
                'extended_trusted_deadline_is_invalid', 'upload_and_queue_exhaust_non_ocr_before_dispatch',
                'one_ms_below_non_ocr_limit_succeeds', 'non_ocr_exactly_exhausted_before_dispatch',
                'non_ocr_exhausts_during_verification', 'cleanup_uses_remaining_non_ocr_budget',
                'ocr_attempt_cannot_exceed_its_own_limit', 'outer_watchdog_queue_timeout_fault_injection',
                'upload_just_below_expiry_normal', 'upload_at_expiry_normal', 'upload_after_expiry_normal',
                'upload_just_below_expiry_fault_injection', 'upload_at_expiry_fault_injection',
                'upload_after_expiry_fault_injection'}
    check('deadline-scenarios-complete', {x['name'] for x in cases} == required and len(cases) == len(required))
    accounting = contract['non_ocr_budget_accounting']
    check('non-ocr-cumulative-phase-accounting-contract', accounting['limit_seconds'] == 180
          and accounting['charged_phases'] == ['upload', 'queue', 'rendering', 'verification', 'persistence', 'cleanup']
          and accounting['excluded_phase'] == 'active_ocr_attempt_only'
          and accounting['pre_dispatch_enforcement'] is True
          and accounting['propagate_trusted_cumulative_phase_context'] is True
          and accounting['reset_between_hops_or_attempts'] is False
          and accounting['expiry_wins_ties'] is True)
    check('non-ocr-no-client-bypass', accounting['client_may_disable_guards'] is False
          and accounting['outer_watchdog_fault_injection'] == 'dedicated_test_harness_only')
    by_name = {case['name']: case for case in cases}
    # Independent, literal regression from Astra; no expected fixture value determines this assertion.
    regression = dict(by_name['buffered_upload_then_success'])
    regression.update(mode='normal', fault_injection=None, upload_ms=120000, upstream_queue_ms=61000,
                      requested_processing_ms=1000, cleanup_ms=0,
                      processing_phases=[{'name': 'prepare-command', 'kind': 'non_ocr', 'duration_ms': 1000}])
    regression_result = deadline_outcome(regression, contract)
    check('non-ocr-regression-rejects-before-backend-entry',
          regression_result['status'] == 504 and regression_result['code'] == 'non_ocr_budget_exceeded'
          and regression_result['financial_postings'] == 0
          and regression_result['backend_started'] is False
          and regression_result['finished_elapsed_ms'] == 180000)
    for mode in ['normal', 'outer_watchdog_fault_injection']:
        exact_upload = dict(regression)
        exact_upload.update(mode=mode,
                            fault_injection=None if mode == 'normal' else
                            {'test_harness_only': True, 'disabled_guards': ['non_ocr_budget']},
                            upload_ms=180000, upstream_queue_ms=0,
                            requested_processing_ms=1, cleanup_ms=0,
                            processing_phases=[{'name': 'prepare-command', 'kind': 'non_ocr', 'duration_ms': 1}])
        result = deadline_outcome(exact_upload, contract)
        check('exact-upload-expiry-rejects-' + mode,
              result['status'] == 408 and result['code'] == 'upload_timeout'
              and result['finished_elapsed_ms'] == 180000
              and result['backend_started'] is False and result['financial_postings'] == 0)
    for case in cases:
        check('deadline-fixture-first-ingress-origin-' + case['name'],
              case['trusted_started_at_unix_ms'] == timing_fixture['edge_start_unix_ms'])
        check('deadline-case-inputs-' + case['name'], all(type(case[k]) is int and case[k] >= 0
              for k in ['upload_ms', 'upstream_queue_ms', 'requested_processing_ms', 'cleanup_ms'])
              and case['trusted_metadata'] in ['valid', 'missing', 'invalid_deadline'])
        phases = case['processing_phases']
        attempts = [phase['attempt'] for phase in phases if phase['kind'] == 'ocr']
        check('deadline-explicit-phase-inputs-' + case['name'],
              sum(phase['duration_ms'] for phase in phases) == case['requested_processing_ms']
              and all(phase['kind'] in ['ocr', 'non_ocr']
                      and type(phase['duration_ms']) is int and phase['duration_ms'] >= 0
                      for phase in phases)
              and attempts == list(range(1, len(attempts) + 1))
              and len(attempts) <= contract['timeouts']['ocr_attempts_max'])
        fault = case['name'] in {'outer_watchdog_queue_timeout_fault_injection',
                                 'upload_just_below_expiry_fault_injection',
                                 'upload_at_expiry_fault_injection', 'upload_after_expiry_fault_injection'}
        check('deadline-test-mode-' + case['name'],
              (case['mode'] == 'outer_watchdog_fault_injection'
               and case['fault_injection'] == {'test_harness_only': True, 'disabled_guards': ['non_ocr_budget']})
              if fault else (case['mode'] == 'normal' and case['fault_injection'] is None))
        actual = deadline_outcome(case, contract)
        check('deadline-case-outcome-' + case['name'], actual == case['expected'])
        if not fault:
            check('normal-case-never-exceeds-non-ocr-budget-' + case['name'],
                  actual['non_ocr_consumed_ms'] <= contract['timeouts']['non_ocr_total_max_seconds'] * 1000
                  and actual['finished_elapsed_ms'] <= contract['timeouts']['request_wall_clock_seconds'] * 1000
                  and (actual['status'] == 200 or actual['financial_postings'] == 0))
    success = by_name['buffered_upload_then_success']['expected']
    check('active-ocr-pauses-only-non-ocr-clock', success['status'] == 200
          and success['finished_elapsed_ms'] == 640000 and success['non_ocr_consumed_ms'] == 160000)
    normal_queue = by_name['upstream_queue_exhausts_non_ocr_budget']['expected']
    fault_queue = by_name['outer_watchdog_queue_timeout_fault_injection']['expected']
    check('outer-watchdog-explicitly-isolated-from-normal-queue-budget',
          normal_queue['finished_elapsed_ms'] == 180000 and normal_queue['code'] == 'non_ocr_budget_exceeded'
          and fault_queue['finished_elapsed_ms'] == 720000 and fault_queue['code'] == 'request_deadline_exceeded'
          and not normal_queue['backend_started'] and not fault_queue['backend_started']
          and normal_queue['financial_postings'] == fault_queue['financial_postings'] == 0)
    slow = by_name['buffered_upload_then_processing_timeout']
    check('deadline-regression-exceeds-total-before-cancellation',
          slow['upload_ms'] > 0 and slow['upload_ms'] + slow['requested_processing_ms'] > 720000
          and slow['expected']['finished_elapsed_ms'] <= 720000
          and slow['expected']['worker_cancelled'] and slow['expected']['financial_postings'] == 0)
    spoof = by_name['client_cannot_restart_deadline_after_upload']
    check('deadline-client-stamp-cannot-extend-outcome',
          spoof['client_supplied_deadline_unix_ms'] > spoof['trusted_deadline_unix_ms']
          and spoof['expected'] == slow['expected'])


if __name__ == '__main__':
    checks = []

    def check(name, condition):
        assert condition, name
        checks.append(name)

    verify(Path(__file__).resolve().parent, check)
    print(json.dumps({'static_plan_only': True, 'passed': len(checks), 'checks': checks,
                      'runtime_proof': 'Not executed: PostgreSQL constraints, cookie behavior and HTTP deadlines require target implementation'}, indent=2))
