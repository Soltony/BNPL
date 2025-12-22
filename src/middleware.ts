import { NextRequest, NextResponse } from 'next/server';
import { decryptJwt } from '@/lib/session';
import { allMenuItems } from './lib/menu-items';
import type { Permissions } from '@/lib/types';

function pathMatchesPrefix(path: string, prefix: string) {
  if (path === prefix) return true;
  if (prefix === '/') return true;
  return path.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`);
}

function findBestMenuItemMatch(path: string) {
  let best: (typeof allMenuItems)[number] | undefined;
  let bestLen = -1;
  for (const item of allMenuItems) {
    if (pathMatchesPrefix(path, item.path) && item.path.length > bestLen) {
      best = item;
      bestLen = item.path.length;
    }
  }
  return best;
}

function computeFirstAllowedPage(userPermissions: Set<string>, permissionMap: Record<string, string>, orderedPages: string[]) {
  for (const pagePath of orderedPages) {
    const perm = permissionMap[pagePath];
    if (perm && userPermissions.has(perm.toLowerCase())) return pagePath;
  }
  return null;
}

// Helper: resolve allowed roles for a given path
function getAllowedRolesForPath(path: string): string[] | undefined {
  const route = findBestMenuItemMatch(path);
  const maybe = (route as any)?.allowedRoles;
  if (Array.isArray(maybe) && maybe.length > 0) return maybe.map((r: any) => String(r));

  const apiPrefixToMenuPath: Record<string, string> = {
    '/api/audit-logs': '/admin/audit-logs',
    '/api/approvals': '/admin/approvals',
    '/api/roles': '/admin/access-control',
    '/api/settings': '/admin/settings',
    '/api/providers': '/admin/providers',
    '/api/users': '/admin/users',
    '/api/reports': '/admin/reports',
  };

  for (const prefix in apiPrefixToMenuPath) {
    if (path.startsWith(prefix)) {
      const menuPath = apiPrefixToMenuPath[prefix];
      const menuItem = allMenuItems.find(item => item.path === menuPath);
      const ar = (menuItem as any)?.allowedRoles;
      if (Array.isArray(ar) && ar.length > 0) return ar.map((r: any) => String(r));
    }
  }

  return undefined;
}

// Add CSP + Security headers to ANY response (HTML or JSON)
function withSecurityHeaders(res: NextResponse, csp: string, nonce: string) {
  res.headers.set('Content-Security-Policy', csp);
  res.headers.set('x-nonce', nonce);
  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('X-Frame-Options', 'DENY');
  res.headers.set('Referrer-Policy', 'no-referrer');
  res.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  return res;
}

const protectedAdminRoutes = [
  '/admin', '/api/admin', '/api/audit-logs', '/api/approvals', '/api/roles',
  '/api/settings', '/api/providers', '/api/users', '/api/reports'
];
const publicRoutes = ['/admin/login', '/loan/connect', '/admin/change-password'];

export const config = {
  matcher: [
    '/admin/:path*',
    '/admin',
    '/api/admin/:path*',
    '/api/admin',
    '/api/audit-logs/:path*',
    '/api/audit-logs',
    '/api/approvals/:path*',
    '/api/approvals',
    '/api/roles/:path*',
    '/api/roles',
    '/api/settings/:path*',
    '/api/settings',
    '/api/providers/:path*',
    '/api/providers',
    '/api/users/:path*',
    '/api/users',
    '/api/reports/:path*',
    '/api/reports',
  ],
};

export default async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;

  const requestId = req.headers.get('x-request-id') || req.cookies.get('rid')?.value || self.crypto.randomUUID();

  // Generate nonce
  const nonce = btoa(self.crypto.randomUUID());

  // Build CSP
  const cspHeader = `
    default-src 'self';
    script-src 'self' 'nonce-${nonce}';
    style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
    font-src 'self' https://fonts.gstatic.com;
    img-src 'self' data: blob: https://placehold.co https://play-lh.googleusercontent.com;
    connect-src 'self';
    frame-ancestors 'self';
    media-src 'self';
    object-src 'none';
    base-uri 'self';
    form-action 'self';
    worker-src 'self';
    manifest-src 'self';
    upgrade-insecure-requests;
  `.replace(/\s{2,}/g, ' ').trim();

  // Clone request headers for NextResponse.next()
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', cspHeader);
  requestHeaders.set('x-request-id', requestId);

  let response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('x-request-id', requestId);

  // ----------------------------------------
  // START ACCESS CONTROL ENFORCEMENT
  // ----------------------------------------

  const isProtected = protectedAdminRoutes.some(prefix => path.startsWith(prefix));

  if (isProtected && !publicRoutes.includes(path)) {
    const cookieHeader = req.headers.get('cookie') || '';
    let sessionResp: Response | null = null;

    try {
      sessionResp = await fetch(new URL('/api/auth/session', req.nextUrl.origin).toString(), {
        headers: { cookie: cookieHeader }
      });
    } catch (e) {
      console.error('Failed to fetch session in middleware:', e);

      if (path.startsWith('/api/')) {
        return withSecurityHeaders(
          NextResponse.json({ error: 'Not authenticated' }, { status: 401 }),
          cspHeader,
          nonce
        );
      }

      return withSecurityHeaders(
        NextResponse.redirect(new URL('/admin/login', req.nextUrl.origin)),
        cspHeader,
        nonce
      );
    }

    if (!sessionResp || !sessionResp.ok) {
      if (path.startsWith('/api/')) {
        return withSecurityHeaders(
          NextResponse.json({ error: 'Not authenticated' }, { status: 401 }),
          cspHeader,
          nonce
        );
      }

      return withSecurityHeaders(
        NextResponse.redirect(new URL('/admin/login', req.nextUrl.origin)),
        cspHeader,
        nonce
      );
    }

    const session = await sessionResp.json();

    // If the user is already on the forbidden page, allow rendering it without
    // additional permission redirects to avoid redirect loops.
    if (path === '/admin/forbidden') {
      return withSecurityHeaders(response, cspHeader, nonce);
    }

    // Force password change
    if (session.passwordChangeRequired &&
        path !== '/admin/change-password' &&
        !path.startsWith('/api/auth/change-password')) {
      return withSecurityHeaders(
        NextResponse.redirect(new URL('/admin/change-password', req.nextUrl.origin)),
        cspHeader,
        nonce
      );
    }

    if (!session.passwordChangeRequired && path === '/admin/change-password') {
      return withSecurityHeaders(
        NextResponse.redirect(new URL('/admin', req.nextUrl.origin)),
        cspHeader,
        nonce
      );
    }

    let permissions: Permissions = session.permissions || {};

    const PERMISSION_MAP: Record<string, string> = {};
    const ORDERED_ADMIN_PAGES: string[] = [];
    for (const item of allMenuItems) {
      const moduleKey = item.label.toLowerCase().replace(/\s+/g, '-');
      PERMISSION_MAP[item.path] = moduleKey;
      ORDERED_ADMIN_PAGES.push(item.path);
    }

    const userPermissions = new Set<string>();
    for (const [k, v] of Object.entries(permissions || {})) {
      if (v && Object.values(v as any).some(Boolean)) {
        userPermissions.add(k.toLowerCase());
      }
    }

    const firstAllowedPage = computeFirstAllowedPage(userPermissions, PERMISSION_MAP, ORDERED_ADMIN_PAGES);

    const currentRouteConfig = findBestMenuItemMatch(path);

    console.debug('[middleware]', {
      requestId,
      path,
      role: session?.role,
      firstAllowedPage,
      matchedMenuPath: currentRouteConfig?.path,
    });

    // Permission enforcement (non-super-admin)
    const isSuperAdmin = session?.role === 'Super Admin';

    if (!isSuperAdmin) {
      let requiredPermission: string | undefined;
      let longestMatch = '';

      for (const [prefix, perm] of Object.entries(PERMISSION_MAP)) {
        if (pathMatchesPrefix(path, prefix) && prefix.length >= longestMatch.length) {
          longestMatch = prefix;
          requiredPermission = perm;
        }
      }

      if (requiredPermission && !userPermissions.has(requiredPermission.toLowerCase())) {
        if (path.startsWith('/api/')) {
          return withSecurityHeaders(
            NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
            cspHeader,
            nonce
          );
        }

        // Redirect to the first allowed page; if user has no allowed pages,
        // send them to /admin/forbidden (not /admin) to avoid redirect loops.
        const target = firstAllowedPage || '/admin/forbidden';
        if (target === path) {
          return withSecurityHeaders(response, cspHeader, nonce);
        }

        const redirectUrl = new URL(target, req.nextUrl.origin);
        redirectUrl.searchParams.set('error', 'Access Denied');

        return withSecurityHeaders(
          NextResponse.redirect(redirectUrl),
          cspHeader,
          nonce
        );
      }
    }

    // allowedRoles enforcement
    try {
      const userRole = session?.role ? String(session.role) : undefined;
      const allowedRoles: string[] | undefined = (currentRouteConfig as any)?.allowedRoles;

      if (allowedRoles?.length) {
        const normAllowed = allowedRoles.map(r => r.toLowerCase());
        const normUserRole = userRole?.toLowerCase();

        if (!normUserRole || !normAllowed.includes(normUserRole)) {
          if (path.startsWith('/api/')) {
            return withSecurityHeaders(
              NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
              cspHeader,
              nonce
            );
          }

          return withSecurityHeaders(
            NextResponse.redirect(new URL('/admin', req.nextUrl.origin)),
            cspHeader,
            nonce
          );
        }
      }
    } catch (_) {}

    // menu permission read check
    if (currentRouteConfig) {
      const moduleName = currentRouteConfig.label.toLowerCase().replace(/\s+/g, '-');
      const hasPermission = !!permissions[moduleName]?.read;

      if (!hasPermission) {
        if (path.startsWith('/api/')) {
          return withSecurityHeaders(
            NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
            cspHeader,
            nonce
          );
        }

        const target = firstAllowedPage || '/admin/forbidden';
        if (target === path) {
          return withSecurityHeaders(response, cspHeader, nonce);
        }

        return withSecurityHeaders(NextResponse.redirect(new URL(target, req.nextUrl.origin)), cspHeader, nonce);
      }
    } else if (path !== '/admin' && !path.startsWith('/api/')) {
      // Unknown admin route: route them to their first allowed page if possible.
      const target = firstAllowedPage || '/admin/forbidden';
      if (target !== path) {
        return withSecurityHeaders(NextResponse.redirect(new URL(target, req.nextUrl.origin)), cspHeader, nonce);
      }
    }
  }

  // FINAL RETURN WITH HEADERS APPLIED
  return withSecurityHeaders(response, cspHeader, nonce);
}
