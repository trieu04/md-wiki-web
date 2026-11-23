import { createApiClient } from '@md-wiki/contracts';
import type { operations } from '@md-wiki/contracts';

const api = createApiClient({ baseUrl: '', getCsrfToken: () => null });
export type PingJob =
  operations['DevPingController_get']['responses'][200]['content']['application/json'];

export async function startPing(message: string) {
  const { data, response } = await api.POST('/api/v1/dev/ping', { body: { message } });
  if (!data) throw new Error(`Could not enqueue ping (${String(response.status)}).`);
  return data;
}

export async function getPing(id: string, signal: AbortSignal) {
  const { data, response } = await api.GET('/api/v1/dev/ping/{id}', {
    params: { path: { id } },
    signal,
  });
  if (!data) throw new Error(`Could not read ping (${String(response.status)}).`);
  return data;
}

export function pollInterval(job: PingJob | undefined): number | false {
  return job?.status === 'queued' || job?.status === 'running' ? 250 : false;
}
