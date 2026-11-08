import { useEffect, useState, type FormEvent } from 'react';
import axios from 'axios';
import { Link, Navigate, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../../api/client';
import { OriginalDocument } from '../../api/OriginalDocument';
import { useSession } from '../../auth/SessionProvider';
import { useLocale } from '../../i18n/LocaleProvider';
import { nativeMoney } from '../accounting/Accounting';
import { command, type Receipt, type ReceiptDetail, type Verification, type Product, type Catalog } from './api';
const categories = ['produce','meat_fish','dairy','deli','pantry','bakery','prepared','beverages','cleaning','personal_care','pets','other'];
function Checks({ report }: { report: Verification }) {
  const { locale } = useLocale();
  return <div><h2>{locale === 'es' ? 'Verificación' : 'Verification'}</h2><div className="table-region"><table><thead><tr><th>{locale === 'es' ? 'Comprobación' : 'Check'}</th><th>{locale === 'es' ? 'Calculado' : 'Computed'}</th><th>{locale === 'es' ? 'Impreso' : 'Printed'}</th><th>{locale === 'es' ? 'Resultado' : 'Result'}</th></tr></thead><tbody>{report.checks.map(check => <tr key={check.name}><th>{({subtotal: locale === 'es' ? 'Subtotal' : 'Subtotal', discounts: locale === 'es' ? 'Descuentos' : 'Discounts',total: 'Total'} as Record<string,string>)[check.name] ?? check.name}</th><td>{nativeMoney(check.computed,'ARS')}</td><td>{check.printed === null ? '—' : nativeMoney(check.printed,'ARS')}</td><td>{check.ok ? '✓' : '✕'}</td></tr>)}</tbody></table></div>{[...report.errors,...report.warnings].map((message,i) => <p key={i}>{message}</p>)}</div>;
}
function useFailure() {
  const { locale, tr, t } = useLocale();
  return (error: unknown) => {
    if (!axios.isAxiosError(error)) return t.unavailable;
    const code = error.response?.data?.error?.code;
    if (error.response?.status===413) return locale==='es'?'La carga supera el límite del cuerpo permitido. Conservamos el formulario.':'The upload exceeds the whole-body limit. Your form has been retained.';
    if (code==='invalid_upload_envelope') return locale==='es'?'Enviá exactamente un PDF con campos acotados.':'Send exactly one PDF with bounded form fields.';
    if (code==='too_large') return locale==='es'?'El ticket supera los 40 MiB.':'The receipt exceeds 40 MiB.';
    if (['python_missing','ocr_unavailable'].includes(code)) return locale==='es'?'El entorno privado de Vision no está disponible. Solicitá su comprobación al responsable de la instalación.':'The private Vision runtime is unavailable. Ask the installation operator to check readiness.';
    if (['processing_timeout','non_ocr_budget_exceeded','ocr_attempt_timeout'].includes(code)) return locale==='es'?'Se agotó el plazo de procesamiento. Conservamos el formulario y el comando para reintentar.':'Processing reached its time budget. Your form and command have been retained for retry.';
    if (['parser_read_error','processing_memory_limit','receipt_processing_failed'].includes(code)) return locale==='es'?'No se pudo procesar el PDF dentro de los límites de lectura y recursos. Conservamos el formulario.':'This PDF could not be processed within the reading and resource limits. Your form has been retained.';
    if (code === 'csrf_mismatch') return t.csrf_mismatch;
    if (['stale_review_version','stale_receipt_link','stale_purchase_version'].includes(code)) return locale === 'es' ? 'La evidencia cambió. Recargá antes de confirmar.' : 'This evidence changed. Reload before confirming.';
    if (code === 'verification_failed') return tr('accounting.receipts.verificationFailed');
    if (code === 'deadline_metadata_invalid') return locale === 'es' ? 'El servicio de procesamiento no está disponible. Conservamos el formulario.' : 'The processing service is unavailable. Your form has been retained.';
    return tr('accounting.receipts.error');
  };
}
export function Receipts() {
  const { session } = useSession(); const { locale, tr, t } = useLocale(); const location = useLocation(); const failure = useFailure();
  const [search, setSearch] = useSearchParams(); const page = Math.max(1, Number.parseInt(search.get('page') ?? '1',10) || 1);
  const [state,setState] = useState<{ owner: string; data: Receipt[]; total: number } | null>(null);
  const [refresh,setRefresh] = useState(0); const [busy,setBusy] = useState(false); const [error,setError] = useState(''); const [file,setFile] = useState<File | null>(null);
  const [rejected,setRejected] = useState<{ report: Verification; rowsText: string; sha256: string; receiptId: number } | null>(null); const [rows,setRows] = useState(''); const [saved,setSaved] = useState<number | null>(null);
  useEffect(() => {
    if (!session) return; const controller = new AbortController(); setState(null);
    api.get('/receipts',{params:{page},signal:controller.signal}).then(({data}) => setState({owner:session.ledger.id,data:data.data,total:data.meta.total})).catch(err => {if (!controller.signal.aborted) setError(failure(err));});
    return () => controller.abort();
  },[session?.ledger.id,page,refresh]);
  if (!session) return <Navigate to="/login" replace state={{from:location.pathname+location.search}} />;
  const stateData = state?.owner === session.ledger.id ? state : null;
  async function submit(event: FormEvent) {
    event.preventDefault(); if (!file) return; setBusy(true); setError(''); setSaved(null); setRejected(null);
    try { const body = new FormData(); body.append('file',file); const result = await command('/receipts',body,`upload:${file.name}:${file.size}:${file.lastModified}`,true); setSaved(result.receiptId); setRefresh(x=>x+1); }
    catch (err) { setError(failure(err)); if (axios.isAxiosError(err) && err.response?.data?.error?.code==='verification_failed') { const data=err.response.data; setRejected(data); setRows(data.rowsText); setRefresh(x=>x+1); } }
    finally { setBusy(false); }
  }
  async function correct(event: FormEvent) {
    event.preventDefault(); if (!rejected) return; setBusy(true); setError('');
    try { const result=await command('/receipts/corrections',{sha256:rejected.sha256,rowsText:rows},`correction:${rejected.sha256}:${rows}`,true); setSaved(result.receiptId); setRejected(null); setRefresh(x=>x+1); }
    catch (err) { setError(failure(err)); if (axios.isAxiosError(err) && err.response?.data?.report) setRejected(err.response.data); }
    finally { setBusy(false); }
  }
  return <section className="financial-page"><Link to="/">Tarjetas</Link><h1>{locale === 'es' ? 'Tickets' : 'Receipts'}</h1><p>{tr('accounting.receipts.retention')}</p><p><Link to="/super/charges">{locale==='es'?'Tickets y consumos':'Receipts and charges'}</Link></p>
    <form onSubmit={submit} aria-busy={busy}><label htmlFor="receipt-pdf">{locale==='es' ? 'Ticket PDF de Coto (máx. 40 MiB)' : 'Coto receipt PDF (max. 40 MiB)'}</label><input id="receipt-pdf" type="file" accept="application/pdf,.pdf" required disabled={busy} onChange={event=>{setFile(event.target.files?.[0] ?? null);setError('');}} /><button className="primary" disabled={busy || !file}>{busy ? (locale==='es' ? 'Procesando…' : 'Processing…') : (locale==='es' ? 'Importar ticket' : 'Import receipt')}</button></form>
    {error && <p role="alert" className="error">{error}</p>}{saved && <p role="status"><Link to={`/receipts/${saved}`}>{locale==='es' ? 'Abrir ticket retenido' : 'Open retained receipt'}</Link></p>}
    {rejected && <><Checks report={rejected.report}/><form onSubmit={correct} aria-busy={busy}><label htmlFor="correction">{locale==='es' ? 'Corregir transcripción' : 'Correct transcript'}</label><textarea id="correction" rows={16} value={rows} onChange={event=>setRows(event.target.value)} required disabled={busy} /><button disabled={busy}>{locale==='es' ? 'Verificar corrección' : 'Verify correction'}</button><Link to={`/receipts/${rejected.receiptId}`}>{locale==='es' ? 'Ver evidencia retenida' : 'View retained evidence'}</Link></form></>}
    <h2>{locale==='es' ? 'Evidencia retenida' : 'Retained evidence'}</h2>{!stateData ? <p role="status">{t.loading}</p> : <>{stateData.data.length===0 && <p>{locale==='es' ? 'Todavía no hay tickets.' : 'No receipts yet.'}</p>}<div className="table-region"><table><thead><tr><th>{locale==='es' ? 'Fecha' : 'Date'}</th><th>{locale==='es' ? 'Ticket fiscal' : 'Fiscal receipt'}</th><th>Total</th><th>{locale==='es' ? 'Verificación' : 'Verification'}</th></tr></thead><tbody>{stateData.data.map(receipt=><tr key={receipt.id}><th><Link to={`/receipts/${receipt.id}`}>{receipt.date ?? '—'}</Link></th><td>{receipt.fiscalId ?? '—'}</td><td>{receipt.totalMinor===null ? '—' : nativeMoney(receipt.totalMinor,'ARS')}</td><td>{receipt.report.ok ? (locale==='es' ? 'Verificado' : 'Verified') : (locale==='es' ? 'Requiere corrección' : 'Needs correction')}</td></tr>)}</tbody></table></div><div className="pagination"><button disabled={page===1} onClick={()=>setSearch({page:String(page-1)})}>{locale==='es' ? 'Anterior' : 'Previous'}</button><span>{page}</span><button disabled={page*20>=stateData.total} onClick={()=>setSearch({page:String(page+1)})}>{locale==='es' ? 'Siguiente' : 'Next'}</button></div></>}
  </section>;
}
function ProductReview({ product, approve, busy }: { product: Product; approve: (body: unknown)=>Promise<void>; busy: boolean }) {
  const { locale, tr }=useLocale(); const [name,setName]=useState(product.name); const [category,setCategory]=useState(product.category); const [unit,setUnit]=useState(product.unit);
  return <form onSubmit={event=>{event.preventDefault();void approve({kind:'product_update',subjectId:product.id,expectedSeq:product.seq,payload:{name,category,unit}});}}><label>{locale==='es' ? 'Nombre canónico' : 'Canonical name'}<input value={name} onChange={event=>setName(event.target.value)} maxLength={300} required /></label><label>{locale==='es' ? 'Departamento' : 'Department'}<select value={category} onChange={event=>setCategory(event.target.value)}>{categories.map(value=><option key={value} value={value}>{tr('productCategory.'+value)}</option>)}</select></label><label>{locale==='es' ? 'Unidad' : 'Unit'}<select value={unit} onChange={event=>setUnit(event.target.value as Product['unit'])}><option value="un">un</option><option value="kg">kg</option></select></label><button disabled={busy}>{locale==='es' ? 'Confirmar producto canónico' : 'Confirm canonical product'}</button></form>;
}
export function ReceiptPage() {
  const { id }=useParams(); const { session }=useSession(); const { locale,tr,t }=useLocale(); const location=useLocation(); const failure=useFailure();
  const [state,setState]=useState<{owner:string;data:ReceiptDetail;catalog:Catalog}|null>(null); const [version,setVersion]=useState(0); const [error,setError]=useState(''); const [status,setStatus]=useState(''); const [notFound,setNotFound]=useState(false); const [busy,setBusy]=useState(false);
  const [card,setCard]=useState(''); const [proof,setProof]=useState(false); const [accounts,setAccounts]=useState<Record<string,string>>({}); const [transcript,setTranscript]=useState('');
  useEffect(()=>{
    if (!session) return; const controller=new AbortController(); setError(''); setNotFound(false); setState(null);
    Promise.all([api.get<ReceiptDetail>(`/receipts/${id}`,{signal:controller.signal}),api.get<Catalog>('/bootstrap',{signal:controller.signal})]).then(([receipt,catalog])=>{setState({owner:session.ledger.id,data:receipt.data,catalog:catalog.data});setCard(receipt.data.link?.cardId ?? '');setAccounts(Object.fromEntries((receipt.data.link?.itemAllocations ?? []).map(row=>[row.sourceLineId,row.accountId])));}).catch(err=>{if(!controller.signal.aborted){setNotFound(err.response?.status===404);setError(failure(err));}});
    return ()=>controller.abort();
  },[id,session?.ledger.id,version]);
  if (!session) return <Navigate to="/login" replace state={{from:location.pathname}} />;
  const data=state?.owner===session.ledger.id?state.data:null; const catalog=state?.catalog;
  async function action(path:string,body:unknown,processing=false) {setBusy(true);setError('');setStatus('');try {const result=await command(path,body,`${path}:${JSON.stringify(body)}`,processing);setStatus(result.reviews?.length ? tr('accounting.receipts.pending') : (locale==='es'?'Cambio registrado.':'Change recorded.'));setVersion(x=>x+1);} catch(err){setError(failure(err));} finally{setBusy(false);}}
  async function showTranscript(hash:string) {setError('');try{const {data}=await api.get(`/documents/${hash}`,{responseType:'text'});setTranscript(data);}catch(err){setError(failure(err));}}
  function reconcile(allocation=false) {
    if(!data) return;
    const itemAllocations=allocation?data.items.filter(row=>accounts[row.id] && accounts[row.id]!=='expense:unallocated').map(row=>({sourceLineId:row.id,accountId:accounts[row.id],purposeId:catalog?.catalog.find(account=>account.id===accounts[row.id])?.primary_purpose_id ?? 'unallocated',minor:row.item.lineTotalCents+row.item.discounts.reduce((sum,d)=>sum+d.amountCents,0)})):undefined;
    void action(`/receipts/${id}/reconciliation`,{receiptRevisionId:data.revisionId,cardId:card||null,paymentVerified:proof,purchaseId:data.link?.action==='link'?data.link.purchaseId:null,expectedPreviousDecisionId:data.link?.id ?? null,expectedPurchaseVersion:data.purchaseVersion,allocation:allocation&&itemAllocations?.length===0?[{accountId:'expense:unallocated',purposeId:'unallocated',minor:data.totalMinor}]:null,...(itemAllocations?{itemAllocations}:{})});
  }
  return <section className="financial-page"><Link to="/receipts">{locale==='es'?'Tickets':'Receipts'}</Link><h1>{locale==='es'?'Detalle del ticket':'Receipt detail'}</h1>{error&&<p className="error" role="alert">{notFound?(locale==='es'?'Ticket no encontrado.':'Receipt not found.'):error}</p>}{status&&<p role="status">{status}</p>}{!data ? !error&&<p role="status">{t.loading}</p> : <>
    <dl className="receipt-facts"><dt>{locale==='es'?'Fecha':'Date'}</dt><dd>{data.date??'—'}</dd><dt>{locale==='es'?'Número fiscal':'Fiscal number'}</dt><dd>{data.fiscalId??'—'}</dd><dt>Total</dt><dd>{data.totalMinor===null?'—':nativeMoney(data.totalMinor,'ARS')}</dd><dt>{locale==='es'?'Medio de pago impreso':'Printed payment method'}</dt><dd>{data.parsed.header.paymentMethod??'—'}</dd></dl><OriginalDocument hash={data.documentHash}/><Checks report={data.report}/>
    <h2>{tr('accounting.receipts.card')}</h2><form onSubmit={event=>{event.preventDefault();reconcile();}} aria-busy={busy}><label htmlFor="receipt-card">{tr('accounting.receipts.card')}</label><select id="receipt-card" value={card} onChange={event=>{setCard(event.target.value);setProof(false);}} required disabled={busy}><option value="">{tr('accounting.receipts.chooseCard')}</option>{catalog?.cards.map(row=><option key={row.id} value={row.id}>{row.display_name}</option>)}</select><label className="check-label"><input type="checkbox" checked={proof} onChange={event=>setProof(event.target.checked)} required />{tr('accounting.receipts.proof')}</label><button disabled={busy||!data.report.ok}>{tr('accounting.receipts.post')}</button></form>
    {data.link&&<p>{locale==='es'?'Vínculo actual':'Current link'}: {data.link.action==='link'?(locale==='es'?'Vinculado':'Linked'):(locale==='es'?'Desvinculado':'Unlinked')} {data.link.action==='link'&&<button disabled={busy} onClick={()=>void action(`/receipts/${id}/unlink`,{receiptRevisionId:data.revisionId,expectedPreviousDecisionId:data.link?.id})}>{locale==='es'?'Desvincular evidencia':'Unlink evidence'}</button>}</p>}
    <h2>{locale==='es'?'Artículos impresos':'Printed items'}</h2><p>{tr('accounting.receipts.productApproval')}</p>{data.items.map(row=><article className="receipt-item" key={row.id}><h3>{row.item.descPrinted}</h3><p>SKU {row.item.sku??'—'} · EAN {row.item.ean??'—'} · {row.item.qtyMilli/1000} {row.item.unit}</p><p>{locale==='es'?'Bruto':'Gross'} {nativeMoney(row.item.lineTotalCents,'ARS')} · {locale==='es'?'Neto':'Net'} {nativeMoney(row.item.lineTotalCents+row.item.discounts.reduce((sum,d)=>sum+d.amountCents,0),'ARS')}</p>{row.item.discounts.map((discount,i)=><p key={i}>{discount.label}: {nativeMoney(discount.amountCents,'ARS')}</p>)}
      {row.product&&<><details><summary>{row.product.name} · {row.product.reviewed?(locale==='es'?'Producto revisado':'Reviewed product'):tr('accounting.receipts.unitUnreviewed')}</summary><ProductReview key={row.product.seq} product={row.product} busy={busy} approve={body=>action('/product-reviews',body)}/></details><button disabled={busy||!row.product.reviewed||row.match?.reviewed} onClick={()=>void action('/product-reviews',{kind:'product_match',subjectId:row.id,expectedSeq:row.match?.seq,payload:{productId:row.product?.id}})}>{row.match?.reviewed?(locale==='es'?'Artículo confirmado':'Item confirmed'):tr('accounting.receipts.approveItem')}</button></>}
      <label>{tr('accounting.receipts.account')}<select aria-label={tr('accounting.receipts.account')} disabled={busy||!row.match?.reviewed} value={accounts[row.id]??'expense:unallocated'} onChange={event=>setAccounts({...accounts,[row.id]:event.target.value})}><option value="expense:unallocated">{tr('accounting.receipts.unallocatedLabel')}</option>{catalog?.catalog.filter(account=>account.posting&&account.enabled&&['expense','asset'].includes(account.type)&&account.id!=='expense:unallocated'&&(account.currency===null||account.currency==='ARS')).map(account=><option key={account.id} value={account.id}>{account.custom_name??(account.label_key?tr(account.label_key):account.id)}</option>)}</select></label>
    </article>)}<p>{tr('accounting.receipts.unallocated')}</p><button disabled={busy||!data.report.ok||data.totalMinor===null||!data.items.length||(!data.items.some(row=>accounts[row.id]&&accounts[row.id]!=='expense:unallocated')&&data.items.some(row=>!row.match?.reviewed||!row.product?.reviewed))} onClick={()=>reconcile(true)}>{tr('accounting.receipts.allocate')}</button>
    <h2>{tr('accounting.receipts.source')}</h2>{data.history.map(history=><details key={history.facts.revisionId}><summary>{history.source.recordedAt} · {history.source.admission}</summary><button onClick={()=>void showTranscript(history.facts.originalRowsObject.sha256)}>{tr('accounting.receipts.originalTranscript')}</button>{history.facts.correctedRowsObject&&<button onClick={()=>void showTranscript(history.facts.correctedRowsObject!.sha256)}>{tr('accounting.receipts.correctedTranscript')}</button>}<Link to={`/accounting/evidence/${encodeURIComponent(history.facts.revisionId)}`}>{locale==='es'?'Ver fuente':'View source'}</Link></details>)}
    {transcript&&<form onSubmit={event=>{event.preventDefault();void action('/receipts/corrections',{sha256:data.documentHash,rowsText:transcript},true);}}><label htmlFor="detail-transcript">{locale==='es'?'Transcripción editable':'Editable transcript'}</label><textarea id="detail-transcript" rows={18} value={transcript} onChange={event=>setTranscript(event.target.value)} /><button disabled={busy}>{locale==='es'?'Verificar corrección':'Verify correction'}</button></form>}
  </>}</section>;
}
