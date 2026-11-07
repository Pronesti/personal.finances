import { useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../../api/client';
import { OriginalDocument } from '../../api/OriginalDocument';
import { useSession } from '../../auth/SessionProvider';
import { useLocale } from '../../i18n/LocaleProvider';

type Account = { id: string; labelKey: string | null; customName: string | null; posting: boolean; balances: { ARS: string; USD: string } };
type Journal = { id: string; kind: string; currency: 'ARS' | 'USD'; effectiveDate: string; recordedAt: string; evidenceIds: string[]; lines: { accountId: string; debitMinor: number; creditMinor: number }[] };
type Inspection = { accounts: Account[]; journals: Journal[]; meta: { page: number; per_page: number; total: number } };
export function nativeMoney(minor: string | number, currency: 'ARS' | 'USD') {
  const amount = BigInt(minor); const abs = amount < 0n ? -amount : amount;
  const sign = amount < 0n ? '-' : ''; const fraction = (abs % 100n).toString().padStart(2, '0');
  return currency === 'USD' ? `US$ ${sign}${abs / 100n}.${fraction}` : `$\u00a0${sign}${(abs / 100n).toLocaleString('es-AR')},${fraction}`;
}
export function Accounting() {
  const { session } = useSession(); const { locale, tr, t } = useLocale();
  const [search, setSearch] = useSearchParams(); const location = useLocation();
  const page = Math.max(1, Math.min(1000000, Number.parseInt(search.get('page') ?? '1', 10) || 1));
  const [state, setState] = useState<{ owner: string; data: Inspection } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!session) return;
    setFailed(false); setState(null);
    const controller = new AbortController();
    api.get<Inspection>('/accounting', { params: { page }, signal: controller.signal }).then(({ data }) => setState({ owner: session.ledger.id, data })).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [session?.ledger.id, page]);
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  const data = state?.owner === session.ledger.id ? state.data : null;
  const label = (id: string) => { const account = data?.accounts.find(row => row.id === id); return account?.customName ?? (account?.labelKey ? tr(account.labelKey) : id); };
  function move(next: number) { const values = new URLSearchParams(search); values.set('page', String(next)); setSearch(values); }
  return <section className="financial-page"><nav><Link to="/">Tarjetas</Link></nav><h1>{tr('accounting.title')}</h1><p>{tr('accounting.subtitle')}</p><p className="muted">{tr('accounting.native')}</p>
    {failed ? <p role="alert">{t.unavailable}</p> : !data ? <p role="status">{locale === 'es' ? 'Cargando…' : 'Loading…'}</p> : <>
      <h2>{tr('accounting.accounts')}</h2><p>{tr('accounting.clearingNote')}</p>
      {data.journals.length === 0 && <p>{tr('accounting.empty')}</p>}
      <div className="table-region" tabIndex={0} role="region" aria-label={tr('accounting.accounts')}><table><thead><tr><th>{tr('accounting.account')}</th><th>ARS</th><th>USD</th></tr></thead><tbody>{data.accounts.filter(account => account.posting && (account.balances.ARS !== '0' || account.balances.USD !== '0')).map(account => <tr key={account.id}><th scope="row">{label(account.id)}</th><td>{nativeMoney(account.balances.ARS, 'ARS')}</td><td>{nativeMoney(account.balances.USD, 'USD')}</td></tr>)}</tbody></table></div>
      <h2>{tr('accounting.journals')}</h2><p>{tr('accounting.audit')}</p>{data.journals.map(journal => <details className="journal" key={journal.id}><summary>{journal.effectiveDate} · {journal.kind} · {journal.currency}</summary><dl><dt>{tr('accounting.effectiveDate')}</dt><dd>{journal.effectiveDate}</dd><dt>{tr('accounting.recordedAt')}</dt><dd>{journal.recordedAt}</dd></dl>
        <div className="table-region"><table><thead><tr><th>{tr('accounting.account')}</th><th>{tr('accounting.debit')}</th><th>{tr('accounting.credit')}</th></tr></thead><tbody>{journal.lines.map((line, index) => <tr key={index}><th scope="row">{label(line.accountId)}</th><td>{nativeMoney(line.debitMinor, journal.currency)}</td><td>{nativeMoney(line.creditMinor, journal.currency)}</td></tr>)}</tbody></table></div>
        <ul>{journal.evidenceIds.map(id => <li key={id}><Link to={`/accounting/evidence/${encodeURIComponent(id)}`}>{tr('accounting.evidence')}</Link></li>)}</ul>
      </details>)}
      <div className="pagination"><button disabled={page === 1} onClick={() => move(page - 1)}>{locale === 'es' ? 'Anterior' : 'Previous'}</button><span>{page}</span><button disabled={page * data.meta.per_page >= data.meta.total} onClick={() => move(page + 1)}>{locale === 'es' ? 'Siguiente' : 'Next'}</button></div>
    </>}
  </section>;
}
export function Evidence() {
  const { session } = useSession(); const { id } = useParams(); const { locale, tr, t } = useLocale(); const location = useLocation();
  const [state, setState] = useState<{ owner: string; value: { revision: Record<string, unknown>; line: Record<string, unknown> | null; documentHash: string } } | null>(null);
  const [error, setError] = useState<number | null>(null);
  useEffect(() => {
    if (!session) return;
    const controller = new AbortController(); setState(null); setError(null);
    api.get(`/accounting/evidence/${encodeURIComponent(id ?? '')}`, { signal: controller.signal }).then(({data}) => setState({ owner: session.ledger.id, value: data })).catch(failure => { if (!controller.signal.aborted) setError(failure.response?.status ?? 500); });
    return () => controller.abort();
  }, [id, session?.ledger.id]);
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  const detail = state?.owner === session.ledger.id ? state.value : null;
  return <section className="financial-page"><Link to="/accounting">{tr('accounting.source.back')}</Link><h1>{tr('accounting.evidence')}</h1>{error ? <p role="alert">{error === 404 ? (locale === 'es' ? 'Evidencia no disponible.' : 'Evidence unavailable.') : t.unavailable}</p> : detail ? <>
    <dl><dt>{locale === 'es' ? 'Admisión' : 'Admission'}</dt><dd>{String(detail.revision.admission)}</dd><dt>{tr('accounting.recordedAt')}</dt><dd>{String(detail.revision.recordedAt)}</dd></dl><OriginalDocument hash={detail.documentHash} />
    {detail.line && <><h2>{locale === 'es' ? 'Línea impresa' : 'Printed line'}</h2><p>{String(detail.line.raw_line ?? detail.line.description ?? '')}</p></>}
    <h2>JSON</h2><pre className="evidence-json">{JSON.stringify(detail.revision.rawPayload, null, 2)}</pre>
  </> : <p role="status">{locale === 'es' ? 'Cargando…' : 'Loading…'}</p>}</section>;
}
