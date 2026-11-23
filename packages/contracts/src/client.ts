import createClient from 'openapi-fetch';
import type { paths } from './schema.js';

export interface ApiClientOptions {
  baseUrl: string;
  getCsrfToken: () => string | null | undefined;
}

export function createApiClient({ baseUrl, getCsrfToken }: ApiClientOptions) {
  const client = createClient<paths>({ baseUrl, credentials: 'include' });
  client.use({
    onRequest({ request }) {
      if (request.method !== 'GET') {
        const token = getCsrfToken();
        if (token) request.headers.set('X-CSRF-Token', token);
      }
      return request;
    },
  });
  return client;
}
