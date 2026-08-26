import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/tenant';
import { redisSubscriber } from '../lib/redis';

export const eventsRouter = Router();

// Ensure the user is authenticated
eventsRouter.use(requireAuth);

eventsRouter.get('/', async (req: Request, res: Response) => {
  // `requireAuth` ensures `req.user` exists and has `orgId`
  const payload = (req as any).user;
  if (!payload || !payload.orgId) {
    res.status(401).end();
    return;
  }
  const orgId = payload.orgId;

  // Standard headers for SSE
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  // Send an initial heartbeat
  res.write('data: {"type": "connected"}\n\n');

  // If in test environment, we don't have a real redisSubscriber
  if (!redisSubscriber) {
    res.end();
    return;
  }

  const channel = `org_events:${orgId}`;

  const subscriber = redisSubscriber ? redisSubscriber.duplicate() : null;

  // We need a dedicated listener function so we can remove it when this specific client disconnects
  const messageHandler = (ch: string, message: string) => {
    if (ch === channel) {
      res.write(`data: ${message}\n\n`);
    }
  };

  if (subscriber) {
    await subscriber.subscribe(channel);
    subscriber.on('message', messageHandler);
  }

  // Keep the connection alive
  const heartbeatInterval = setInterval(() => {
    res.write(':\n\n'); // SSE comment to keep connection alive
  }, 15000);

  // Clean up when client disconnects
  req.on('close', () => {
    clearInterval(heartbeatInterval);
    if (subscriber) {
      subscriber.off('message', messageHandler);
      subscriber.unsubscribe(channel).catch(err => console.error('[SSE] Unsubscribe error:', err));
      subscriber.quit().catch(err => console.error('[SSE] Quit error:', err));
    }
  });
});
