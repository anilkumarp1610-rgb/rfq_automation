import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcrypt';
import { loginSchema, registerSchema } from '@rfq/shared';
import { prisma } from '../lib/prisma.js';
import { generateToken } from '../lib/jwt.js';
import { validateBody } from '../lib/validate.js';
import { authenticateToken, AuthRequest } from '../middleware/auth.js';
import { ah } from '../lib/http.js';

const router = Router();

/** Throttle credential-guessing on the unauthenticated endpoints. */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts — try again later' },
});

router.post('/login', authLimiter, validateBody(loginSchema), async (req: Request, res: Response) => {
  const { email, password } = req.body;

  const user = await prisma.user.findUnique({
    where: { email },
    include: { roles: { include: { role: true } } },
  });

  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  if (!user.isActive) {
    return res.status(403).json({ error: 'User account is inactive' });
  }

  const roles = user.roles.map((ur) => ur.role.code);
  const token = generateToken({ userId: user.id.toString(), email: user.email, roles });

  res.json({
    token,
    user: { id: user.id.toString(), email: user.email, name: user.name, roles },
  });
});

router.post('/register', authLimiter, validateBody(registerSchema), async (req: Request, res: Response) => {
  const { email, name, password } = req.body;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return res.status(409).json({ error: 'Email already registered' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({ data: { email, name, passwordHash } });

  const estimatorRole = await prisma.role.findUnique({ where: { code: 'ESTIMATOR' } });
  if (estimatorRole) {
    await prisma.userRole.create({ data: { userId: user.id, roleId: estimatorRole.id } });
  }

  const token = generateToken({ userId: user.id.toString(), email: user.email, roles: ['ESTIMATOR'] });
  res.status(201).json({
    token,
    user: { id: user.id.toString(), email: user.email, name: user.name, roles: ['ESTIMATOR'] },
  });
});

/** Current user — the client calls this on load to re-hydrate roles from source. */
router.get(
  '/me',
  authenticateToken,
  ah(async (req: AuthRequest, res: Response) => {
    const user = await prisma.user.findUnique({
      where: { id: BigInt(req.user!.userId) },
      include: { roles: { include: { role: true } } },
    });
    if (!user || !user.isActive) return res.status(401).json({ error: 'User not found or inactive' });
    res.json({
      id: user.id.toString(),
      email: user.email,
      name: user.name,
      roles: user.roles.map((ur) => ur.role.code),
    });
  })
);

/** Swap a still-valid token for a fresh one (sliding 24h expiry). */
router.post(
  '/refresh',
  authenticateToken,
  ah(async (req: AuthRequest, res: Response) => {
    const user = await prisma.user.findUnique({
      where: { id: BigInt(req.user!.userId) },
      include: { roles: { include: { role: true } } },
    });
    if (!user || !user.isActive) return res.status(401).json({ error: 'User not found or inactive' });
    const roles = user.roles.map((ur) => ur.role.code);
    res.json({
      token: generateToken({ userId: user.id.toString(), email: user.email, roles }),
      user: { id: user.id.toString(), email: user.email, name: user.name, roles },
    });
  })
);

export default router;
