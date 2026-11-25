import { app } from './app.js'; // first: app.ts loads .env + validates JWT_SECRET before anything else
import { prisma } from './lib/prisma.js';

const PORT = Number(process.env.PORT) || 4000;

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
