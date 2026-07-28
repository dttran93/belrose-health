import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import * as Sentry from '@sentry/react';
import './index.css';
import App from './App';

const sentryDsn = import.meta.env.VITE_SENTRY_DSN;

if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    environment: import.meta.env.MODE,
    // No session replay / tracing integrations — this is a health-data app, so we only
    // ever send error metadata (stack trace, message, path), never rendered page content.
    integrations: [],
    beforeSend(event) {
      delete event.request?.cookies;
      delete event.user;
      return event;
    },
  });
} else if (import.meta.env.DEV) {
  console.warn('VITE_SENTRY_DSN not set — Sentry error tracking is disabled.');
}

// Get the root element and assert it exists
const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element not found. Make sure you have a div with id="root" in your HTML.');
}

createRoot(rootElement).render(
  // <StrictMode>
    <App />
  // </StrictMode>
);