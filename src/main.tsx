import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { AuthProvider } from './app/lib/AuthContext';
import { ExchangeProvider } from './app/lib/ExchangeContext';
import App from './App';
import { ErrorBoundary } from './app/components/ErrorBoundary';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary label="app">
      <BrowserRouter>
        <ExchangeProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
        </ExchangeProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>
);
