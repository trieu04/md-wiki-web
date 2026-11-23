import { lazy, Suspense } from 'react';

const DevPing = import.meta.env.DEV ? lazy(() => import('./features/dev-ping/PingRoute')) : null;

export function App() {
  if (DevPing && globalThis.location.pathname === '/__dev/ping') {
    return (
      <Suspense>
        <DevPing />
      </Suspense>
    );
  }
  return <h1>md-wiki</h1>;
}
