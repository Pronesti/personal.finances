import axios from 'axios';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, csrf, login, type Session } from '../api/client';

type State = { session: Session | null; loading: boolean; unavailable: boolean; signIn: typeof login; signOut: () => Promise<void>; reload: () => Promise<void> };
const Context = createContext<State | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const clearPrivateState = useCallback(() => { setSession(null); window.dispatchEvent(new Event('tarjetas:session-cleared')); }, []);
  const reload = useCallback(async () => {
    setLoading(true);
    try { setSession((await api.get<Session>('/auth/user')).data); setUnavailable(false); }
    catch (error) { clearPrivateState(); setUnavailable(!(axios.isAxiosError(error) && error.response?.status === 401)); }
    finally { setLoading(false); }
  }, [clearPrivateState]);
  useEffect(() => {
    const id = api.interceptors.response.use(response => response, error => {
      if (error.response?.status === 401) clearPrivateState();
      return Promise.reject(error);
    });
    void reload();
    return () => api.interceptors.response.eject(id);
  }, [clearPrivateState, reload]);
  async function signIn(email: string, password: string) {
    clearPrivateState();
    const next = await login(email, password);
    setSession(next); setUnavailable(false);
    return next;
  }
  async function signOut() {
    try {
      await api.post('/auth/logout');
      clearPrivateState();
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 401) { clearPrivateState(); return; }
      if (axios.isAxiosError(error) && error.response?.status === 419) await csrf.get('/sanctum/csrf-cookie');
      throw error;
    }
  }
  return <Context value={{ session, loading, unavailable, signIn, signOut, reload }}>{children}</Context>;
}
export function useSession() {
  const value = useContext(Context);
  if (!value) throw new Error('SessionProvider required');
  return value;
}
