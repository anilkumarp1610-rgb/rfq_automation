import { z } from 'zod';

const opt = z
  .string()
  .trim()
  .max(4000)
  .optional()
  .or(z.literal('').transform(() => undefined));

/** A PNG/JPEG data URI, capped so it fits comfortably in NVARCHAR(MAX). */
const logoDataUri = z
  .string()
  .regex(/^data:image\/(png|jpe?g);base64,/, 'Logo must be a PNG or JPEG image')
  .max(2_000_000, 'Logo is too large (max ~1.4 MB)')
  .nullish()
  .or(z.literal('').transform(() => null));

/** Seller company / firm profile — a singleton, shown on quotation & cost-sheet PDFs. */
export const companySettingsSchema = z.object({
  name: z.string().trim().min(1, 'Company name is required').max(200),
  address: opt,
  phone: opt,
  email: z.string().trim().email().max(200).optional().or(z.literal('').transform(() => undefined)),
  website: opt,
  gstNo: opt,
  logo: logoDataUri,
  footerNote: opt,
});
export type CompanySettingsInput = z.infer<typeof companySettingsSchema>;
