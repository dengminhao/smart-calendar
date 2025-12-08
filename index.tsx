import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

console.log('🚀 Application Entry Point (index.tsx) loaded');

const rootElement = document.getElementById('root');
if (!rootElement) {
  console.error('❌ FATAL: Could not find root element');
  throw new Error("Could not find root element to mount to");
} else {
  console.log('✅ Root element found, mounting React app...');
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);