import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LocaleProvider } from '../../i18n/LocaleProvider';
import { Accounting } from '../accounting/Accounting';
import { ReportPage } from './ReportPage';
import type { Projection } from './model';

const mocks = vi.hoisted(() => ({ get: vi.fn(), owner: 'owner-a' }));
vi.mock('../../api/client', () => ({ api: { get: mocks.get }, setRequestLocale: vi.fn() }));
vi.mock('../../auth/SessionProvider', () => ({ useSession: () => ({ session: { ledger: { id: mocks.owner } } }) }));
// These regressions exercise report controls and native tables, not chart rendering.
vi.mock('./Charts', () => ({ useChartTheme: () => ({}), Series: () => null, Horizontal: () => null, Flow: () => null, Forecast: () => null, TicketTrend: () => null }));

function projection(value: 'real' | 'nominal' | 'usd' = 'real'): Projection {
  return { data: { stacked: [{ period: 'prior-result', amount: 125 }], accounts: ['amount'] }, meta: {
    report: 'trends', scope: { basis: 'purchase', value, tax: 'excl', granularity: 'month', period: null },
    months: [], periods: [], controls: { title: 'trends.title', toggles: {}, granularities: ['month', 'quarter'] },
    cards: [], accounts: [], empty: false, alertVersions: {},
  } };
}
function deferred() {
  let resolve!: (value: { data: Projection }) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<{ data: Projection }>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function report(path = '/trends') {
  return render(<MemoryRouter initialEntries={[path]}><LocaleProvider><ReportPage /></LocaleProvider></MemoryRouter>);
}
beforeEach(() => { mocks.get.mockReset(); mocks.owner = 'owner-a'; document.cookie = 'lang=; Max-Age=0; Path=/'; });
afterEach(cleanup);

it('keeps the initiating filter mounted and focused while loading and after success', async () => {
  const next = deferred(); mocks.get.mockResolvedValueOnce({ data: projection() }).mockReturnValueOnce(next.promise);
  report(); const user = userEvent.setup();
  const unit = await screen.findByRole('combobox', { name: 'Display amounts' });
  await user.click(screen.getByText('View chart values and details'));
  expect(screen.getByText('prior-result')).toBeInTheDocument();
  await user.selectOptions(unit, 'nominal');
  expect(screen.getByText('Loading report…')).toBeInTheDocument();
  expect(screen.queryByText('prior-result')).not.toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: 'Display amounts' })).toBe(unit);
  expect(unit).toHaveFocus();
  await act(async () => next.resolve({ data: projection('nominal') }));
  expect(unit).toHaveFocus(); expect(unit).toHaveValue('nominal');
  await user.tab(); expect(screen.getByRole('combobox', { name: 'Count spending' })).toHaveFocus();
});

it('does not steal focus from another control when a pending report finishes', async () => {
  const next = deferred(); mocks.get.mockResolvedValueOnce({ data: projection() }).mockReturnValueOnce(next.promise);
  report(); const user = userEvent.setup();
  await user.selectOptions(await screen.findByRole('combobox', { name: 'Display amounts' }), 'usd');
  await user.tab(); const count = screen.getByRole('combobox', { name: 'Count spending' });
  expect(count).toHaveFocus();
  await act(async () => next.resolve({ data: projection('usd') }));
  expect(count).toHaveFocus();
});

it('retains usable filters on failure and retry without exposing prior results', async () => {
  const next = deferred(); mocks.get.mockResolvedValueOnce({ data: projection() }).mockReturnValueOnce(next.promise).mockResolvedValueOnce({ data: projection('usd') });
  report(); const user = userEvent.setup(); const unit = await screen.findByRole('combobox', { name: 'Display amounts' });
  await user.selectOptions(unit, 'usd');
  await act(async () => next.reject(new Error('offline')));
  expect(screen.getByRole('alert')).toBeInTheDocument();
  expect(screen.queryByText('prior-result')).not.toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: 'Display amounts' })).toBe(unit);
  expect(unit).toHaveFocus();
  await user.click(screen.getByRole('button', { name: 'Try again' }));
  await waitFor(() => expect(unit).toHaveValue('usd'));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('ignores an obsolete response after rapid filter changes', async () => {
  const first = deferred(), second = deferred();
  mocks.get.mockResolvedValueOnce({ data: projection() }).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  report(); const unit = await screen.findByRole('combobox', { name: 'Display amounts' });
  fireEvent.change(unit, { target: { value: 'nominal' } });
  fireEvent.change(unit, { target: { value: 'usd' } });
  await act(async () => second.resolve({ data: projection('usd') }));
  await act(async () => first.resolve({ data: projection('nominal') }));
  expect(screen.getByRole('combobox', { name: 'Display amounts' })).toBe(unit);
  expect(unit).toHaveValue('usd'); expect(screen.queryByText('Loading report…')).not.toBeInTheDocument();
});

it('never retains another owner’s controls or results while their replacement loads', async () => {
  const next = deferred(); mocks.get.mockResolvedValueOnce({ data: projection() }).mockReturnValueOnce(next.promise);
  const view = report(); await screen.findByRole('combobox', { name: 'Display amounts' });
  mocks.owner = 'owner-b';
  view.rerender(<MemoryRouter initialEntries={['/trends']}><LocaleProvider><ReportPage /></LocaleProvider></MemoryRouter>);
  expect(screen.queryByRole('combobox', { name: 'Display amounts' })).not.toBeInTheDocument();
  expect(screen.queryByText('prior-result')).not.toBeInTheDocument();
  await act(async () => next.resolve({ data: projection('usd') }));
  expect(screen.getByRole('combobox', { name: 'Display amounts' })).toHaveValue('usd');
});

it.each([['en', 'Unallocated purchases'], ['es', 'Compras sin asignar']])('translates the Unallocated purpose in category and accounting tables (%s)', async (locale, label) => {
  document.cookie = `lang=${locale}; Path=/`;
  const data = projection(); data.data = { groups: [], rows: [] };
  data.meta.controls = { title: 'categories.title' };
  data.meta.nativePurpose = { from: '2026-01-01', to: '2026-01-31', measures: [{ cardId: 'card-a', currency: 'ARS', rows: [{ purposeId: 'unallocated', expenseMinor: '100', debtMinor: '100', repaymentMinor: '0' }] }] };
  mocks.get.mockResolvedValueOnce({ data });
  const categories = report('/categories');
  expect(await screen.findByText(label)).toBeInTheDocument();
  expect(screen.queryByText('accounting.group.unallocated')).not.toBeInTheDocument(); categories.unmount();
  mocks.get.mockResolvedValueOnce({ data: { openingCoverage: [], groups: [], groupMeasures: { ARS: [], USD: [] }, purposeMeasures: data.meta.nativePurpose.measures, accounts: [], journals: [], meta: { page: 1, per_page: 20, total: 0 } } });
  render(<MemoryRouter><LocaleProvider><Accounting /></LocaleProvider></MemoryRouter>);
  expect(await screen.findByText(label)).toBeInTheDocument();
  expect(screen.queryByText('accounting.group.unallocated')).not.toBeInTheDocument();
});

it.each([['en', 'Actual card', 'Months left'], ['es', 'Tarjeta concreta', 'Meses restantes']])('renders the installment API contract without inventing missing schedule facts (%s)', async (locale, cardLabel, monthsLabel) => {
  document.cookie = `lang=${locale}; Path=/`;
  const data = projection('nominal');
  data.data = { burden: [], plans: [
    { merchant: 'SYNTHETIC PLAN', brand: 'card-a', paid: 1, total: 3, monthly: 50, remainingMonths: 2, remainingTotal: 100 },
    { merchant: 'UNKNOWN SCHEDULE', brand: 'card-a', paid: null, total: null, monthly: 50, remainingMonths: null, remainingTotal: null },
  ] };
  data.meta.cards = [{ id: 'card-a', displayName: 'Synthetic Mercado Pago' }];
  data.meta.controls = { title: 'installments.title' };
  mocks.get.mockResolvedValueOnce({ data }); report('/installments');
  const plan = await screen.findByRole('row', { name: /SYNTHETIC PLAN/ });
  expect(plan).toHaveTextContent('Synthetic Mercado Pago');
  expect(plan).toHaveTextContent('1/3'); expect(plan).toHaveTextContent('$ 100');
  expect(screen.getByRole('columnheader', { name: cardLabel })).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: monthsLabel })).toBeInTheDocument();
  expect(within(screen.getByRole('row', { name: /UNKNOWN SCHEDULE/ })).getAllByRole('cell').map(cell => cell.textContent?.replace(/\s/g, ' '))).toEqual(['Synthetic Mercado Pago', '—', '—', '$ 50', '—']);
});

it.each([['en', 'How to read this page', 'due date', 'recorded interest'], ['es', 'Cómo leer esta página', 'vencimiento', 'intereses registrados']])('explains the float chart and delay table with its modeled payment assumption (%s)', async (locale, guide, assumption, interest) => {
  document.cookie = `lang=${locale}; Path=/`;
  const data = projection(); data.data = [{ period: '2026-01', avgDays: 25, gain: 63, recordedInterest: 0 }];
  data.meta.controls = { title: 'float.title' };
  mocks.get.mockResolvedValueOnce({ data }); report('/float');
  await screen.findByRole('heading', { level: 1 });
  await userEvent.setup().click(screen.getByText(guide));
  const help = screen.getByText(guide).closest('details')!;
  expect(help).toHaveTextContent(assumption); expect(help).toHaveTextContent(interest);
  expect(help).not.toHaveTextContent(/third tile|tercer recuadro|dashed line|línea punteada/);
});
