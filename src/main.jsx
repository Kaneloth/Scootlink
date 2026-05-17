import { initSentry } from '@/lib/sentry';
initSentry();

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from '@/App.jsx';
import '@/index.css';
import { Sentry } from '@/lib/sentry';

ReactDOM.createRoot(document.getElementById('root')).render(
  <Sentry.ErrorBoundary fallback={<p>Something went wrong. Please refresh.</p>}>
    <App />
  </Sentry.ErrorBoundary>
);