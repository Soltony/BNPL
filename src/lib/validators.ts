import { NextRequest, NextResponse } from 'next/server';
import { z, ZodError, ZodSchema } from 'zod';


// Minimal list of common/compromised passwords to block locally.
const COMMON_PASSWORDS = new Set([
  '123456','123456789','qwerty','password','1234567','12345678','12345','111111','123123','password1','1234567890','1234','welcome','letmein','admin','iloveyou'
]);

// Check password against HaveIBeenPwned Pwned Passwords API
export async function isPwnedPassword(password: string): Promise<boolean> {
  const sha1 = await import('crypto').then(c => c.createHash('sha1').update(password).digest('hex').toUpperCase());
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);
  const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`);
  if (!res.ok) return false; // If API fails, do not block
  const text = await res.text();
  return text.split('\n').some(line => line.startsWith(suffix));
}

export function isCommonPassword(pw: string) {
  return COMMON_PASSWORDS.has(pw.toLowerCase());
}

export async function validateBody<T>(req: NextRequest, schema: ZodSchema<T>) {
  try {
    const body = await req.json();
    const parsed = await schema.parseAsync(body);
    return { ok: true as const, data: parsed };
  } catch (err) {
    if (err instanceof ZodError) {
      return {
        ok: false as const,
        errorResponse: NextResponse.json({ error: 'Invalid request', issues: err.errors }, { status: 400 }),
      };
    }
    console.error('Unexpected validation error', err);
    return {
      ok: false as const,
      errorResponse: NextResponse.json({ error: 'Invalid request body' }, { status: 400 }),
    };
  }
}

// Common schemas
// Password policy:
// - Minimum length: 8
// - Must contain uppercase, lowercase, digit and symbol
// - Must not be a common password


// Login schema: only basic password requirements (no breach check)
export const loginSchema = z.object({
  phoneNumber: z.string().min(3),
  password: z.string().min(8)
    .regex(/(?=.*[a-z])/, 'must contain a lowercase letter')
    .regex(/(?=.*[A-Z])/, 'must contain an uppercase letter')
    .regex(/(?=.*\d)/, 'must contain a number')
    .regex(/(?=.*[^A-Za-z0-9])/, 'must contain a symbol')
    .refine((pw) => !isCommonPassword(pw), { message: 'password is too common or compromised' }),
});

// Password schema for registration/change: includes breach check
export const passwordSchema = z.string().min(8)
  .regex(/(?=.*[a-z])/, 'must contain a lowercase letter')
  .regex(/(?=.*[A-Z])/, 'must contain an uppercase letter')
  .regex(/(?=.*\d)/, 'must contain a number')
  .regex(/(?=.*[^A-Za-z0-9])/, 'must contain a symbol')
  .refine((pw) => !isCommonPassword(pw), { message: 'password is too common or compromised' })
  .superRefine(async (pw, ctx) => {
    if (await isPwnedPassword(pw)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Password has been found in a data breach. Please choose a more secure password.'
      });
    }
  });

export const scoringRulesSchema = z.object({
  providerId: z.string().min(1),
  parameters: z.array(z.object({
    name: z.string().min(1),
    weight: z.number(),
    rules: z.array(z.object({
      field: z.string().min(1),
      condition: z.string().min(1),
      value: z.any(),
      score: z.number(),
    }))
  }))
});

export default {
  validateBody,
  loginSchema,
  scoringRulesSchema,
};
