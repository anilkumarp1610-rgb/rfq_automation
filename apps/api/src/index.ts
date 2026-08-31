import './lib/serialize.js';
import path from 'node:path';
import fs from 'node:fs';
import express, { Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import { prisma } from './lib/prisma.js';
import { errorHandler } from './middleware/errorHandler.js';
import authRoutes from './routes/auth.js';
import customerRoutes from './routes/customers.js';
import masterRoutes from './routes/masters.js';
import customerPartRoutes from './routes/customerParts.js';
import rfqRoutes from './routes/rfqs.js';
import rfqSpecRoutes from './routes/rfqSpec.js';
import rfqVersionRoutes from './routes/rfqVersions.js';
import specAnalysisRoutes from './routes/specAnalysis.js';
import referenceRoutes from './routes/reference.js';
import auditLogRoutes from './routes/auditLog.js';
import { reportsRouter, downloadRouter } from './routes/reports.js';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 4000;
const isProd = process.env.NODE_ENV === 'production';

app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));

// CORS: open in dev; restrict to WEB_ORIGIN (comma-separated) in production.
const origins = process.env.WEB_ORIGIN?.split(',').map((s) => s.trim()).filter(Boolean);
app.use(cors(isProd && origins?.length ? { origin: origins } : {}));

app.use(express.json({ limit: '35mb' })); // spec PDFs ride in on multipart, but keep headroom
app.use(rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: true, legacyHeaders: false }));

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/auth', authRoutes);
app.use('/customers', customerRoutes);
app.use('/customer-parts', customerPartRoutes);
app.use('/rfqs', rfqSpecRoutes);
app.use('/rfqs', rfqRoutes);
app.use('/rfq-versions', rfqVersionRoutes);
app.use('/rfq-versions', specAnalysisRoutes);
app.use('/rfq-versions', downloadRouter);
app.use('/reference', referenceRoutes);
app.use('/reports', reportsRouter);
app.use('/audit-log', auditLogRoutes);
app.use('/', masterRoutes);

// In production, serve the built SPA from the same process.
const API_PREFIXES = [
  'auth', 'customers', 'customer-parts', 'rfqs', 'rfq-versions', 'reference', 'reports',
  'audit-log', 'health', 'material', 'product-types', 'processes', 'machines', 'qc-config',
  'overhead-config', 'handling-config', 'customer-margin-map',
];
const webDist = process.env.WEB_DIST || path.resolve(process.cwd(), '../web/dist');
const serveSpa = isProd && fs.existsSync(webDist);
if (serveSpa) {
  app.use(express.static(webDist));
  console.log(`✓ Serving SPA from ${webDist}`);
}

app.use((req: Request, res: Response) => {
  const seg = req.path.split('/')[1] ?? '';
  if (serveSpa && req.method === 'GET' && !API_PREFIXES.includes(seg) && !req.path.includes('.')) {
    return res.sendFile(path.join(webDist, 'index.html'));
  }
  res.status(404).json({ error: 'Not found' });
});

app.use(errorHandler);

const server = app.listen(PORT, async () => {
  console.log(`🚀 API server running on http://localhost:${PORT}`);
  try {
    await prisma.$queryRaw`SELECT 1`;
    console.log('✓ Database connected');
  } catch (error) {
    console.error('✗ Database connection failed:', error);
    process.exit(1);
  }
});

process.on('SIGTERM', () => {
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
});
