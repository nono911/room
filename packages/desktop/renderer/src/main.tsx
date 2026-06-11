import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.js';
import './styles/index.css';
import { ProvidersProvider } from './features/providers/context/ProvidersContext.js';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ProvidersProvider>
      <App />
    </ProvidersProvider>
  </React.StrictMode>
);
