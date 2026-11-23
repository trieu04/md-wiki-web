import type { operations } from '@md-wiki/contracts';
import { apiData, type ApiClient } from '../../lib/api';

export type PingJob =
  operations['DevPingController_get']['responses'][200]['content']['application/json'];

export async function startPing(api: ApiClient, message: string) {
  return apiData(await api.POST('/api/v1/dev/ping', { body: { message } }));
}

export async function getPing(api: ApiClient, id: string, signal: AbortSignal) {
  return apiData(await api.GET('/api/v1/dev/ping/{id}', { params: { path: { id } }, signal }));
}

export function pollInterval(job: PingJob | undefined): number | false {
  return job?.status === 'queued' || job?.status === 'running' ? 250 : false;
}
