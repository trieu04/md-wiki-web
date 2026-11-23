import { JobQueue } from '../src/jobs/ping-queue.js';

/** Tests that submit proposals keep quality runs out of the shared Redis queue (§7.6.5). */
export const NO_QUEUE = {
  provide: JobQueue,
  value: {
    enqueue: () => Promise.resolve(),
    enqueueQuietly: () => Promise.resolve(true),
    onModuleDestroy: () => Promise.resolve(),
  },
};
