import express, { Request, Response } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { authRouter } from './routes/auth';
import { productsRouter } from './routes/products';
import { ordersRouter } from './routes/orders';
import { usersRouter } from './routes/users';
import { billingRouter } from './routes/billing';
import { dashboardRouter } from './routes/dashboard';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

export const app = express();

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // Limit each IP to 1000 requests per window
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(helmet());
app.use(globalLimiter);

const allowedOrigin = process.env.FRONTEND_URL || 'http://localhost:5173';
app.use(cors({
  origin: allowedOrigin,
  credentials: true,
}));

// Webhooks require raw body parsing for Stripe signature verification
app.use('/billing/webhook', express.raw({ type: 'application/json' }));

app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

app.use('/auth', authRouter);
app.use('/products', productsRouter);
app.use('/orders', ordersRouter);
app.use('/dashboard', dashboardRouter);
app.use('/users', usersRouter);
app.use('/billing', billingRouter);

// Layer 0 - Health check
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({ status: 'ok' });
});

// Centralized error handler
app.use((err: any, req: Request, res: Response, next: express.NextFunction) => {
  console.error('Unhandled Error:', err);
  const status = err.status || 500;
  res.status(status).json({ error: err.message || 'Internal server error' });
});
