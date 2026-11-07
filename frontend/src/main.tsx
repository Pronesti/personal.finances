import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { SessionProvider } from './auth/SessionProvider';
import { LocaleProvider } from './i18n/LocaleProvider';
import './style.css';

createRoot(document.getElementById('root')!).render(<StrictMode><BrowserRouter><LocaleProvider><SessionProvider><App /></SessionProvider></LocaleProvider></BrowserRouter></StrictMode>);
