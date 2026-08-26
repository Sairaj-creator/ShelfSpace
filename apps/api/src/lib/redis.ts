import Redis from 'ioredis';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

export const redisConnection = process.env.NODE_ENV === 'test'
  ? (null as unknown as Redis)
  : new Redis(redisUrl, { maxRetriesPerRequest: null });

export const redisSubscriber = process.env.NODE_ENV === 'test'
  ? (null as unknown as Redis)
  : new Redis(redisUrl, { maxRetriesPerRequest: null });

if (redisConnection) {
  redisConnection.on('error', (err) => {
    console.error('Redis connection error:', err);
  });
}

if (redisSubscriber) {
  redisSubscriber.on('error', (err) => {
    console.error('Redis subscriber error:', err);
  });
}
