import { NextResponse } from 'next/server';
import { getUserFromSession } from '@/lib/user';

export async function GET(req: Request) {
  const requestId = req.headers.get('x-request-id') || 'n/a';
  try {
    const user = await getUserFromSession();
    if (!user?.id) {
      console.debug('[auth.session]', { requestId, ok: false });
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    console.debug('[auth.session]', { requestId, ok: true, userId: user.id, role: user.role });

    // Return essential information for middleware/UI
    const res = NextResponse.json({
      id: user.id,
      role: user.role,
      permissions: user.permissions || {},
      passwordChangeRequired: user.passwordChangeRequired || false,
    });
    res.headers.set('x-request-id', requestId);
    return res;
  } catch (err) {
    console.error('[auth.session] error', { requestId, err });
    const res = NextResponse.json({ error: 'Internal error', requestId }, { status: 500 });
    res.headers.set('x-request-id', requestId);
    return res;
  }
}
