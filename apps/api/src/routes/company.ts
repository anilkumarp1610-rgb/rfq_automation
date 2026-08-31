import { Router, Response } from 'express';
import { companySettingsSchema } from '@rfq/shared';
import { prisma } from '../lib/prisma.js';
import { authenticateToken, canEditMasters, userId, AuthRequest } from '../middleware/auth.js';
import { validateBody } from '../lib/validate.js';
import { ah } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { getCompanySettings } from '../lib/company.js';

const router = Router();
router.use(authenticateToken);

router.get(
  '/',
  ah(async (_req: AuthRequest, res: Response) => {
    res.json(await getCompanySettings());
  })
);

router.put(
  '/',
  canEditMasters,
  validateBody(companySettingsSchema),
  ah(async (req: AuthRequest, res: Response) => {
    const b = req.body as import('@rfq/shared').CompanySettingsInput;
    const data = {
      name: b.name,
      address: b.address ?? null,
      phone: b.phone ?? null,
      email: b.email ?? null,
      website: b.website ?? null,
      gstNo: b.gstNo ?? null,
      logo: b.logo ?? null,
      footerNote: b.footerNote ?? null,
      updatedBy: userId(req),
    };
    const existing = await getCompanySettings();
    const row = existing
      ? await prisma.companySettings.update({ where: { id: existing.id }, data })
      : await prisma.companySettings.create({ data: { singleton: true, ...data } });

    await audit(req, {
      entityType: 'CompanySettings',
      entityId: row.id,
      action: existing ? 'UPDATE' : 'CREATE',
      changes: { ...b, logo: b.logo ? '[image]' : null },
    });
    res.json(row);
  })
);

export default router;
