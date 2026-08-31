import { z } from 'zod';
import { RoleCode } from './enums';

export const loginSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const registerSchema = z.object({
  email: z.string().email('Invalid email format'),
  name: z.string().min(2, 'Name must be at least 2 characters'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const authUser = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  roles: z.array(RoleCode),
});
export type AuthUser = z.infer<typeof authUser>;

export const authResponse = z.object({
  token: z.string(),
  user: authUser,
});
export type AuthResponse = z.infer<typeof authResponse>;
