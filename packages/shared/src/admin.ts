import { z } from 'zod';

const optStr = z
  .string()
  .trim()
  .max(200)
  .optional()
  .or(z.literal('').transform(() => undefined));

const password = z.string().min(6, 'Password must be at least 6 characters').max(200);

/** Create a user — password is required. Exactly one role. */
export const userCreateSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(120),
  email: z.string().trim().email('Invalid email format').max(200),
  phone: optStr,
  password,
  roleId: z.string().min(1, 'Pick a role'),
  isActive: z.coerce.boolean().optional().default(true),
});
export type UserCreateInput = z.infer<typeof userCreateSchema>;

/** Update a user — password optional (blank = keep current). */
export const userUpdateSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(120),
  email: z.string().trim().email('Invalid email format').max(200),
  phone: optStr,
  password: password.optional().or(z.literal('').transform(() => undefined)),
  roleId: z.string().min(1, 'Pick a role'),
  isActive: z.coerce.boolean(),
});
export type UserUpdateInput = z.infer<typeof userUpdateSchema>;

const roleName = z.string().trim().min(2, 'Name must be at least 2 characters').max(80);
const roleDescription = z
  .string()
  .trim()
  .max(2000)
  .optional()
  .or(z.literal('').transform(() => undefined));

/** Add a custom role. Custom roles carry no edit permissions (view-only) until wired in code. */
export const roleCreateSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .max(30)
    .regex(/^[A-Za-z][A-Za-z0-9_]*$/, 'Letters, digits and underscore only')
    .transform((s) => s.toUpperCase()),
  name: roleName,
  description: roleDescription,
});
export type RoleCreateInput = z.infer<typeof roleCreateSchema>;

/** Edit a role — only the label and description; the code and permissions are fixed. */
export const roleUpdateSchema = z.object({
  name: roleName,
  description: roleDescription,
});
export type RoleUpdateInput = z.infer<typeof roleUpdateSchema>;
