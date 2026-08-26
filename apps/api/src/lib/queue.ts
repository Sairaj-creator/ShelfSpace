import { Queue } from 'bullmq';
import { redisConnection } from './redis';
import { processJobInline } from '../worker';

export const jobsQueue = process.env.NODE_ENV === 'test' 
  ? null as unknown as Queue 
  : new Queue('jobsQueue', { connection: redisConnection });

/**
 * Enqueue a job. If in test mode, we might process it synchronously inline,
 * but for now we will just conditionally check NODE_ENV. In tests, we can
 * mock this module or await the worker logic directly.
 */
export async function enqueueJob(name: string, data: any, opts = {}) {
  if (process.env.NODE_ENV === 'test') {
    // In test environment, process synchronously by importing the worker function
    return await processJobInline(name, data);
  }
  
  await jobsQueue.add(name, data, {
    removeOnComplete: true,
    removeOnFail: false,
    ...opts,
  });
}
