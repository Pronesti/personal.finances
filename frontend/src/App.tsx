import { lazy, Suspense } from 'react';
const Receipts = lazy(() => import('./features/receipts/Receipts').then(module => ({ default: module.Receipts })));
const ReceiptPage = lazy(() => import('./features/receipts/Receipts').then(module => ({ default: module.ReceiptPage })));
const Accounting = lazy(() => import('./features/accounting/Accounting').then(module => ({ default: module.Accounting })));
const Evidence = lazy(() => import('./features/accounting/Accounting').then(module => ({ default: module.Evidence })));

import { Link } from 'react-router-dom';
import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { OriginalDocument } from './api/OriginalDocument';
import { api, publicApi, csrf, errorCode, type ErrorCode } from './api/client';
import { useSession } from './auth/SessionProvider';
import { useLocale } from './i18n/LocaleProvider';

function Health() {
  const { t } = useLocale();
  const [status, setStatus] = useState<'checking' | 'connected' | 'disconnected'>('checking');
  useEffect(() => {
    const controller = new AbortController();
    publicApi.get('/health', { signal: controller.signal }).then(({ data }) => {
      setStatus(data.status === 'ok' && data.service === 'tarjetas-api' && data.api_version === 'v1' ? 'connected' : 'disconnected');
    }).catch(() => { if (!controller.signal.aborted) setStatus('disconnected'); });
    return () => controller.abort();
  }, []);
  return <p className={`health ${status}`} role="status"><span aria-hidden="true">●</span> {t[status]}</p>;
}
function Login() {
  const { signIn, session } = useSession();
  const { t } = useLocale();
  const location = useLocation();
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [error, setError] = useState<ErrorCode | null>(null); const [busy, setBusy] = useState(false);
  const intended = (location.state as { from?: string } | null)?.from;
  if (session) return <Navigate to={intended?.startsWith('/') && !intended.startsWith('//') && !intended.startsWith('/login') ? intended : '/'} replace />;
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null);
    try { await signIn(email, password); setPassword(''); }
    catch (failure) {
      const code = errorCode(failure); setError(code);
      if (code === 'csrf_mismatch') await csrf.get('/sanctum/csrf-cookie').catch(() => {});
    } finally { setBusy(false); }
  }
  return <section className="login-card"><p className="eyebrow">TARJETAS</p><h1>{t.title}</h1><p>{t.subtitle}</p>
    <form onSubmit={submit} aria-busy={busy}>
      <label htmlFor="email">{t.email}</label><input id="email" name="email" type="email" autoComplete="username" maxLength={254} required value={email} onChange={event => setEmail(event.target.value)} />
      <label htmlFor="password">{t.password}</label><input id="password" name="password" type="password" autoComplete="current-password" maxLength={1024} required value={password} onChange={event => setPassword(event.target.value)} />
      {error && <p className="error" role="alert">{t[error]}</p>}
      <button className="primary" disabled={busy}>{busy ? t.signing : t.submit}</button>
    </form><p className="muted">{t.prerequisite}</p><Health /></section>;
}
function Documents() {
  const { locale } = useLocale();
  const [documents, setDocuments] = useState<{ reference_id: string; sha256: string }[]>([]);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    api.get('/bootstrap', { signal: controller.signal }).then(({data}) => setDocuments(data.documents)).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, []);
  return <section><h2>{locale === 'es' ? 'Documentos retenidos' : 'Retained documents'}</h2>{failed && <p role="alert">{locale === 'es' ? 'No se pudieron cargar los documentos.' : 'Unable to load documents.'}</p>}{documents.map(document => <div key={document.reference_id}><p>{document.reference_id}</p><OriginalDocument hash={document.sha256} /></div>)}</section>;
}
function PrivateLedger() {
  const { session, signOut } = useSession(); const { t, locale } = useLocale(); const location = useLocation();
  const [error, setError] = useState(false); const [busy, setBusy] = useState(false);
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return <section className="login-card"><p className="eyebrow">TARJETAS</p><h1>{t.ledger}</h1><p>{t.signedIn} {session.user.name}</p><p>{t.foundation}</p><p><Link to="/receipts">{locale === 'es' ? 'Tickets' : 'Receipts'}</Link></p><p><Link to="/accounting">{t.ledger}</Link></p><Documents />
    {error && <p role="alert" className="error">{t.unavailable}</p>}
    <button disabled={busy} onClick={async () => { setBusy(true); setError(false); try { await signOut(); } catch { setError(true); } finally { setBusy(false); } }}>{t.logout}</button>
  </section>;
}
export default function App() {
  const { locale, setLocale, t } = useLocale(); const { loading, unavailable, reload } = useSession();
  return <><a className="skip" href="#main">{t.skip}</a><header><a href="/" className="brand">Tarjetas<span> / </span></a><button onClick={() => setLocale(locale === 'en' ? 'es' : 'en')} aria-label={locale === 'en' ? 'Cambiar a español' : 'Switch to English'}>{locale === 'en' ? 'Español' : 'English'}</button></header>
    <main id="main">{loading ? <p role="status">{t.loading}</p> : unavailable ? <section className="login-card"><h1>{t.unavailable}</h1><button onClick={() => void reload()}>{t.retry}</button><Health /></section> : <Suspense fallback={<p role="status">{locale === 'es' ? 'Cargando…' : 'Loading…'}</p>}><Routes><Route path="/login" element={<Login />} /><Route path="/" element={<PrivateLedger />} /><Route path="/receipts" element={<Receipts />} /><Route path="/receipts/:id" element={<ReceiptPage />} /><Route path="/accounting" element={<Accounting />} /><Route path="/accounting/evidence/:id" element={<Evidence />} /><Route path="*" element={<section className="login-card"><h1>{locale === 'es' ? 'Página no disponible' : 'Page unavailable'}</h1><a href="/">Tarjetas</a></section>} /></Routes></Suspense>}</main></>;
}
