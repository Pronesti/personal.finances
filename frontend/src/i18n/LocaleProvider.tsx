import localization from './localization.json';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
const messages = {
  en: {
    title: 'Your finances, backed by evidence.', subtitle: 'Sign in to your private ledger.',
    email: 'Email', password: 'Password', submit: 'Sign in', signing: 'Signing in…',
    connected: 'API connected', disconnected: 'API unavailable', checking: 'Checking API…',
    loading: 'Restoring your session…', logout: 'Sign out', ledger: 'Private ledger', skip: 'Skip to content',
    prerequisite: 'An existing account is required.', retry: 'Try again', signedIn: 'Signed in as',
    invalid_credentials: 'The email or password is incorrect.', ledger_setup_required: 'Your account needs a private ledger. Contact the operator.',
    csrf_mismatch: 'Your session needs refreshing. Your form has been retained. Try again.', rate_limited: 'Too many attempts. Please wait before trying again.',
    unavailable: 'Unable to reach your account. Please try again.', foundation: 'Your session is ready. Financial tools are being rebuilt.',
  },
  es: {
    title: 'Tus finanzas, respaldadas por evidencia.', subtitle: 'Ingresá a tu libro privado.',
    email: 'Correo electrónico', password: 'Contraseña', submit: 'Ingresar', signing: 'Ingresando…',
    connected: 'API conectada', disconnected: 'API no disponible', checking: 'Comprobando API…',
    loading: 'Restaurando tu sesión…', logout: 'Salir', ledger: 'Libro privado', skip: 'Ir al contenido',
    prerequisite: 'Se requiere una cuenta existente.', retry: 'Reintentar', signedIn: 'Sesión de',
    invalid_credentials: 'El correo o la contraseña son incorrectos.', ledger_setup_required: 'Tu cuenta necesita un libro privado. Contactá al operador.',
    csrf_mismatch: 'La sesión necesita actualizarse. Conservamos el formulario. Reintentá.', rate_limited: 'Demasiados intentos. Esperá antes de reintentar.',
    unavailable: 'No se pudo acceder a tu cuenta. Reintentá.', foundation: 'Tu sesión está lista. Las herramientas financieras están en reconstrucción.',
  },
};
type Locale = keyof typeof messages;
const Context = createContext<{ locale: Locale; setLocale: (locale: Locale) => void; t: typeof messages.en; tr: (key: string) => string } | null>(null);
export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(() => document.cookie.split('; ').find(row => row.startsWith('lang='))?.split('=')[1] === 'es' ? 'es' : 'en');
  useEffect(() => { document.documentElement.lang = locale; }, [locale]);
  function choose(next: Locale) {
    setLocale(next);
    document.cookie = `lang=${next}; Path=/; Max-Age=31536000; SameSite=Lax; Secure`;
  }
  return <Context value={{ locale, setLocale: choose, t: messages[locale], tr: (key: string) => (localization.dictionaries[locale] as Record<string, string>)[key] ?? key }}>{children}</Context>;
}
export function useLocale() { const value = useContext(Context); if (!value) throw new Error('LocaleProvider required'); return value; }
