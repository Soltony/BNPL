
import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { createSession } from '@/lib/session';
import { createAuditLog } from '@/lib/audit-log';
import { validateBody, loginSchema } from '@/lib/validators';
import { isBlocked, recordFailedAttempt, resetAttempts, getRemainingAttempts, getBackoffSeconds, getLockRemainingMs, MAX_ATTEMPTS, WINDOW_MS } from '@/lib/rate-limiter';
import { allMenuItems } from '@/lib/menu-items';
import type { Permissions } from '@/lib/types';
import { randomUUID } from 'crypto';

function computeFirstAllowedPage(permissions: Permissions | null | undefined): string | null {
  if (!permissions) return null;
  for (const item of allMenuItems) {
    const moduleKey = item.label.toLowerCase().replace(/\s+/g, '-');
    if (permissions?.[moduleKey]?.read) return item.path;
  }
  return null;
}

export async function POST(req: NextRequest) {
  const requestId = req.headers.get('x-request-id') || randomUUID();
  const ipAddress = req.ip || req.headers.get('x-forwarded-for') || 'N/A';
  const userAgent = req.headers.get('user-agent') || 'N/A';

  try {
    const validation = await validateBody(req, loginSchema);
    if (!validation.ok) return validation.errorResponse;
    const { phoneNumber, password } = validation.data;

    // Use a rate-limiter key scoped to the phone number and IP to limit brute-force.
    const ipAddressKey = req.ip || req.headers.get('x-forwarded-for') || 'unknown-ip';
    const rateKey = `${phoneNumber}:${ipAddressKey}`;

    if (isBlocked(rateKey)) {
      const lockMs = getLockRemainingMs(rateKey);
      const retryAfterSeconds = Math.ceil(lockMs / 1000) || 1;
      const remaining = getRemainingAttempts(rateKey);
      const backoff = getBackoffSeconds(rateKey);
      return NextResponse.json({ error: 'Too many failed attempts. Try again later.', retryAfter: retryAfterSeconds, retriesLeft: remaining, delaySeconds: backoff }, { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } });
    }

    const user = await prisma.user.findFirst({
      where: { phoneNumber },
      include: { role: true },
    });

    if (!user) {
      const logDetails = {
          reason: 'User not found',
          attemptedPhoneNumber: phoneNumber,
      };
      await createAuditLog({
        actorId: 'anonymous',
        action: 'USER_LOGIN_FAILURE',
        ipAddress,
        userAgent,
        details: logDetails,
      });
      // Record failed attempt against the rate limiter
      recordFailedAttempt(rateKey);
      // If this attempt caused a lockout, inform client
      if (isBlocked(rateKey)) {
        const lockMs = getLockRemainingMs(rateKey);
        const retryAfterSeconds = Math.ceil(lockMs / 1000) || 1;
        const remaining = getRemainingAttempts(rateKey);
        const backoff = getBackoffSeconds(rateKey);
        return NextResponse.json({ error: 'Too many failed attempts. Try again later.', retryAfter: retryAfterSeconds, retriesLeft: remaining, delaySeconds: backoff }, { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } });
      }
      // Otherwise apply progressive delay and return unauthorized
      const backoff = getBackoffSeconds(rateKey);
      if (backoff > 0) await new Promise((res) => setTimeout(res, backoff * 1000));
      const remaining = getRemainingAttempts(rateKey);
      return NextResponse.json({ error: 'Invalid credentials.', retriesLeft: remaining, delaySeconds: backoff }, { status: 401 });
    }

    if (user.status === 'Inactive') {
        const logDetails = {
            reason: 'User account is inactive',
            userId: user.id,
            attemptedPhoneNumber: phoneNumber,
        };
        await createAuditLog({
            actorId: user.id,
            action: 'USER_LOGIN_FAILURE',
            ipAddress,
            userAgent,
            details: logDetails
        });
        // Return a clear client-facing error for inactive accounts so admins and users
        // can understand the login failure reason. Use 403 Forbidden as this is
        // an authenticated-action denial due to account state.
        return NextResponse.json({ error: 'Your account has been deactivated. Please contact the administrator.' }, { status: 403 });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);

     if (!isPasswordValid) {
       const logDetails = {
            reason: 'Invalid password',
            userId: user.id,
            attemptedPhoneNumber: phoneNumber,
       };
       await createAuditLog({
           actorId: user.id,
           action: 'USER_LOGIN_FAILURE',
           ipAddress,
           userAgent,
           details: logDetails
       });
       // increment failed attempt and respond
       recordFailedAttempt(rateKey);
       // If we hit lockout after this attempt, respond with 429
       if (isBlocked(rateKey)) {
         const lockMs = getLockRemainingMs(rateKey);
         const retryAfterSeconds = Math.ceil(lockMs / 1000) || 1;
         const remaining = getRemainingAttempts(rateKey);
         const backoff = getBackoffSeconds(rateKey);
         return NextResponse.json({ error: 'Too many failed attempts. Try again later.', retryAfter: retryAfterSeconds, retriesLeft: remaining, delaySeconds: backoff }, { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } });
       }
       const backoff = getBackoffSeconds(rateKey);
       if (backoff > 0) await new Promise((res) => setTimeout(res, backoff * 1000));
       const remaining = getRemainingAttempts(rateKey);
       return NextResponse.json({ error: 'Invalid credentials.', retriesLeft: remaining, delaySeconds: backoff }, { status: 401 });
    }

     // Successful login: clear any recorded failed attempts
     resetAttempts(rateKey);

    // Create a session for the user and include their role permissions so
    // middleware (Edge runtime) can read permissions without a DB call.
    await createSession(user.id, undefined, user.role.permissions);

    const parsedPermissions = (() => {
      try {
        return JSON.parse(user.role.permissions as string) as Permissions;
      } catch {
        return null;
      }
    })();

    const redirectTo = user.passwordChangeRequired
      ? '/admin/change-password'
      : (computeFirstAllowedPage(parsedPermissions) || '/admin/forbidden');

    console.debug('[auth.login]', {
      requestId,
      userId: user.id,
      role: user.role.name,
      redirectTo,
    });
    
    const logDetails = {
        role: user.role.name,
    };
    await createAuditLog({
        actorId: user.id,
        action: 'USER_LOGIN_SUCCESS',
        ipAddress,
        userAgent,
        details: logDetails
    });

    const res = NextResponse.json({ message: 'Login successful', redirectTo, requestId }, { status: 200 });
    res.headers.set('x-request-id', requestId);
    // Short-lived correlation cookie so middleware can log the same id.
    res.cookies.set('rid', requestId, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 60 * 10 });
    return res;

  } catch (error) {
    console.error('[auth.login] error', { requestId, error });
    const res = NextResponse.json({ error: 'An internal server error occurred.', requestId }, { status: 500 });
    res.headers.set('x-request-id', requestId);
    return res;
  }
}
