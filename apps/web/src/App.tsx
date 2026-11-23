import { lazy, Suspense } from 'react';

const DevPing = import.meta.env.DEV ? lazy(() => import('./features/dev-ping/PingRoute')) : null;
// The dedicated visual build is local tooling, not a deployed product build.
const Gallery =
  import.meta.env.DEV || import.meta.env.MODE === 'visual'
    ? lazy(() => import('./ui/Gallery'))
    : null;

export function App() {
  if (DevPing && globalThis.location.pathname === '/__dev/ping') {
    return (
      <Suspense>
        <DevPing />
      </Suspense>
    );
  }
  if (Gallery && globalThis.location.pathname === '/__gallery') {
    return (
      <Suspense>
        <Gallery />
      </Suspense>
    );
  }
  return <h1>md-wiki</h1>;
}
