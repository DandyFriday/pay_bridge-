import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { authRoutes } from './routes/auth.routes';
import { ledgerRoutes } from './routes/ledger.routes';
import { AppError } from './utils/errors';

export const app: Application = express();

// Global Middlewares
app.use(cors());
app.use(express.json());

// Basic Health Check Endpoint
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'success',
    service: 'PayBridge API',
    timestamp: new Date().toISOString(),
  });
});

// API Routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/ledger', ledgerRoutes);

// Centralized 404 Handler
app.use((_req: Request, res: Response) => {
  res.status(404).json({
    status: 'error',
    message: 'Route not found',
  });
});

// Centralized Global Error Handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      status: 'error',
      message: err.message,
      ...(err.details !== undefined ? { details: err.details } : {}),
    });
    return;
  }

  console.error('Unhandled Application Error:', err);
  res.status(500).json({
    status: 'error',
    message: 'Internal server error',
  });
});
