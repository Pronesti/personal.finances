import axios from 'axios';

export function apiBase(value: string | undefined): string {
  if (!value) throw new Error('VITE_API_BASE_URL is required');
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/api/v1') {
    throw new Error('VITE_API_BASE_URL must be an HTTPS /api/v1 URL');
  }
  return url.href.replace(/\/$/, '');
}

export const baseURL = apiBase(import.meta.env.VITE_API_BASE_URL);
const headers = { Accept: 'application/json' };
export const api = axios.create({ baseURL, headers, withCredentials: true, withXSRFToken: true, timeout: 30_000 });
export const csrf = axios.create({ baseURL: new URL(baseURL).origin, headers, withCredentials: true, withXSRFToken: true, timeout: 30_000 });
export const publicApi = axios.create({ baseURL, headers, withCredentials: false, withXSRFToken: false, timeout: 10_000 });

export type Session = { user: { id: number; name: string; email: string }; ledger: { id: string } };
export async function login(email: string, password: string): Promise<Session> {
  await csrf.get('/sanctum/csrf-cookie');
  return (await api.post<Session>('/auth/login', { email, password })).data;
}
export type ErrorCode = 'invalid_credentials' | 'ledger_setup_required' | 'csrf_mismatch' | 'rate_limited' | 'unavailable';
export function errorCode(error: unknown): ErrorCode {
  if (!axios.isAxiosError(error)) return 'unavailable';
  const code: unknown = error.response?.data?.error?.code;
  if (['invalid_credentials', 'ledger_setup_required', 'csrf_mismatch', 'rate_limited'].includes(String(code))) return code as ErrorCode;
  if (error.response?.status === 419) return 'csrf_mismatch';
  if (error.response?.status === 429) return 'rate_limited';
  return 'unavailable';
}
