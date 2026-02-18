import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import * as serviceWorkerRegistration from './serviceWorkerRegistration';

const container = document.getElementById('root');
const root = createRoot(container);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

serviceWorkerRegistration.register({
  onSuccess: () => {
    // eslint-disable-next-line no-console
    console.log('PWA service worker registered.');
  },
  onUpdate: () => {
    // eslint-disable-next-line no-console
    console.log('New POS version detected. Updating now.');
  },
});
