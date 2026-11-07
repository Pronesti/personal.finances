import { useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { api } from '../../api/client';
import { command } from '../receipts/api';
import { useSession } from '../../auth/SessionProvider';
import { useLocale } from '../../i18n/LocaleProvider';

type Account = { id: string; type: string; labelKey: string | null; customName: string | null; version: number };
type Group = { id: string; labelKey: string | null; customName: string | null; version: number; accountIds: string[]; builtin: boolean; additive: boolean };
type Catalog = { accounts: Account[]; groups: Group[] };
export function Settings() {
  const { session } = useSession(); const { locale, tr, t } = useLocale(); const location = useLocation(); const es = locale === 'es';
  const [catalog, setCatalog] = useState<{ owner: string; value: Catalog } | null>(null); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [accountId, setAccountId] = useState(''); const [name, setName] = useState(''); const [groupId, setGroupId] = useState(''); const [groupName, setGroupName] = useState(''); const [members, setMembers] = useState<string[]>([]);
  const data = catalog?.owner === session?.ledger.id ? catalog?.value : null;
  const label = (row: Account | Group) => row.customName ?? (row.labelKey ? tr(row.labelKey) : row.id);
  async function load() { const { data } = await api.get<Catalog>('/accounting/settings'); if (session) setCatalog({ owner: session.ledger.id, value: data }); }
  useEffect(() => { if (!session) return; const controller = new AbortController(); setCatalog(null); api.get<Catalog>('/accounting/settings', { signal: controller.signal }).then(({data}) => setCatalog({ owner: session.ledger.id, value: data })).catch(() => { if (!controller.signal.aborted) setError(t.unavailable); }); return () => controller.abort(); }, [session?.ledger.id]);
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  const account = data?.accounts.find(row => row.id === accountId); const group = data?.groups.find(row => row.id === groupId);
  async function save(event: FormEvent, kind: 'account' | 'group', reset = false) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const body = kind === 'account' ? { accountId, customName: reset ? null : name, expectedVersion: account?.version } : { groupId: groupId || null, customName: reset ? null : groupName, accountIds: group?.builtin ? group.accountIds : members, expectedVersion: group?.version ?? 0 };
      await command(`/accounting/settings/${kind === 'account' ? 'account-name' : 'groups'}`, body, JSON.stringify({kind,body}));
      await load();
    } catch (failure) { const status = (failure as { response?: { status?: number } }).response?.status; setError(status === 419 ? t.csrf_mismatch : status === 409 ? (es ? 'La versión cambió. Recargá y revisá tus cambios.' : 'The version changed. Reload and review your changes.') : t.unavailable); }
    finally { setBusy(false); }
  }
  return <section className="financial-page"><Link to="/accounting">{tr('accounting.title')}</Link><h1>{es ? 'Configuración de cuentas y grupos' : 'Account and group settings'}</h1><p>{es ? 'Los nombres personalizados son literales en ambos idiomas. Las modificaciones conservan el historial contable.' : 'Custom names stay literal in both languages. Changes preserve accounting history.'}</p>
    {error && <p role="alert">{error}</p>}{!data ? <p role="status">{t.loading}</p> : <>
      <form onSubmit={event => void save(event, 'account')}><h2>{es ? 'Nombre de cuenta' : 'Account name'}</h2><label>{es ? 'Cuenta' : 'Account'}<select required value={accountId} onChange={event => { setAccountId(event.target.value); setName(data.accounts.find(row => row.id === event.target.value)?.customName ?? ''); }}><option value="">{es ? 'Elegir cuenta' : 'Choose account'}</option>{data.accounts.map(row => <option key={row.id} value={row.id}>{label(row)} · {row.type}</option>)}</select></label><label>{es ? 'Nombre personalizado' : 'Custom name'}<input value={name} maxLength={300} onChange={event => setName(event.target.value)} /></label><button disabled={busy || !account || !name.trim()}>{es ? 'Guardar nombre' : 'Save name'}</button><button type="button" disabled={busy || !account?.labelKey} onClick={event => void save(event, 'account', true)}>{es ? 'Restablecer traducción' : 'Reset translation'}</button></form>
      <form onSubmit={event => void save(event, 'group')}><h2>{es ? 'Grupos de cuentas' : 'Account groups'}</h2><p>{es ? 'Los grupos personalizados pueden superponerse y combinar tipos. Sus totales no se suman entre grupos.' : 'Custom groups may overlap and combine account types. Their totals are not added across groups.'}</p><label>{es ? 'Grupo' : 'Group'}<select value={groupId} onChange={event => { const row = data.groups.find(row => row.id === event.target.value); setGroupId(event.target.value); setGroupName(row?.customName ?? ''); setMembers(row?.accountIds ?? []); }}><option value="">{es ? 'Crear grupo' : 'Create group'}</option>{data.groups.map(row => <option key={row.id} value={row.id}>{label(row)}</option>)}</select></label><label>{es ? 'Nombre del grupo' : 'Group name'}<input value={groupName} maxLength={300} onChange={event => setGroupName(event.target.value)} /></label>{group?.builtin ? <p>{es ? 'La composición del grupo principal está protegida.' : 'Primary group membership is protected.'}</p> : <fieldset><legend>{es ? 'Cuentas incluidas' : 'Included accounts'}</legend><div className="catalog-members">{data.accounts.map(row => <label key={row.id}><input type="checkbox" checked={members.includes(row.id)} onChange={event => setMembers(event.target.checked ? [...members, row.id] : members.filter(id => id !== row.id))} />{label(row)} · {row.type}</label>)}</div></fieldset>}<button disabled={busy || !groupName.trim() || (!group?.builtin && members.length === 0)}>{es ? 'Guardar grupo' : 'Save group'}</button><button type="button" disabled={busy || !group?.builtin} onClick={event => void save(event, 'group', true)}>{es ? 'Restablecer grupo' : 'Reset group'}</button></form>
    </>}
  </section>;
}
