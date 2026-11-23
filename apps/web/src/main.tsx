import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

const rootElement = document.getElementById('root');

if (rootElement === null) {
  throw new Error('Root element not found');
}

function renderApp(element: HTMLElement) {
  createRoot(element).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

if (import.meta.env.MODE === 'visual') {
  void import('./dev/fixtures/browser')
    .then(({ startVisualFixtures }) => startVisualFixtures())
    .then(() => {
      renderApp(rootElement);
    });
} else {
  renderApp(rootElement);
}
