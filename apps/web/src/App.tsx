import { RouterProvider } from '@tanstack/react-router';
import type { createAppRouter } from './router';

export function App({ router }: { router: ReturnType<typeof createAppRouter> }) {
  return <RouterProvider router={router} />;
}
