import { useEffect, useRef, useState } from 'react';
import { api } from './client';
import { useLocale } from '../i18n/LocaleProvider';

type Viewer = { tab: Window | null; url: string };
export function OriginalDocument({ hash }: { hash: string }) {
  const { locale } = useLocale();
  const viewer = useRef<Viewer | null>(null);
  const inflight = useRef<AbortController | null>(null);
  const reserved = useRef<Window | null>(null);
  const [fallback, setFallback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  function cleanup() {
    inflight.current?.abort(); inflight.current = null;
    reserved.current?.close(); reserved.current = null;
    if (viewer.current) { viewer.current.tab?.close(); URL.revokeObjectURL(viewer.current.url); viewer.current = null; }
    setFallback(null);
  }
  useEffect(() => {
    function clear() { cleanup(); setBusy(false); }
    window.addEventListener('tarjetas:session-cleared', clear);
    const timer = window.setInterval(() => {
      if (viewer.current?.tab?.closed) { URL.revokeObjectURL(viewer.current.url); viewer.current = null; }
    }, 1000);
    return () => { window.removeEventListener('tarjetas:session-cleared', clear); clearInterval(timer); cleanup(); };
  }, [hash]);
  async function open() {
    cleanup(); setError(null); setBusy(true);
    const tab = window.open('about:blank', '_blank');
    if (tab) tab.opener = null;
    reserved.current = tab;
    const controller = new AbortController(); inflight.current = controller;
    try {
      const response = await api.get<Blob>(`/documents/${encodeURIComponent(hash)}`, { responseType: 'blob', signal: controller.signal });
      const type = String(response.headers['content-type'] ?? '').split(';')[0];
      if (response.status !== 200 || !['application/pdf', 'application/octet-stream'].includes(type)) throw new Error('invalid_document');
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(response.data);
      viewer.current = { tab, url }; reserved.current = null;
      if (tab && !tab.closed) tab.location.href = url;
      else setFallback(url);
    } catch (failure: unknown) {
      tab?.close(); reserved.current = null;
      if (!controller.signal.aborted) {
        const response = (failure as { response?: { status: number; data?: Blob } }).response;
        if (response?.data instanceof Blob) await response.data.text().then(text => { try { JSON.parse(text); } catch {} });
        setError(response?.status === 404 ? (locale === 'es' ? 'Documento no disponible.' : 'Document unavailable.') : (locale === 'es' ? 'No se pudo abrir el documento.' : 'Unable to open the document.'));
      }
    } finally { if (inflight.current === controller) { inflight.current = null; setBusy(false); } }
  }
  return <div><button disabled={busy} onClick={() => void open()}>{locale === 'es' ? 'PDF original' : 'Original PDF'}</button>
    {fallback && <a href={fallback} target="_blank" rel="noopener noreferrer">{locale === 'es' ? 'Abrir / descargar' : 'Open / download'}</a>}
    {error && <p role="alert">{error}</p>}</div>;
}
