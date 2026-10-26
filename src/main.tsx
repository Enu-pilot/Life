import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createAppStore } from './app/store';
import { Repository, requestPersistence } from './storage/repository';
import { App } from './ui/App';
import './ui/styles.css';

const repo = new Repository();
const store = createAppStore(repo);
void requestPersistence();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App store={store} repo={repo} />
  </StrictMode>,
);
