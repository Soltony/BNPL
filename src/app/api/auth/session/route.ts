import { NextResponse } from 'next/server';
import { getUserFromSession } from '@/lib/user';

export async function GET() {
  try {
    const user = await getUserFromSession();
    if (!user?.id) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    // Return essential information for middleware/UI
    return NextResponse.json({
      id: user.id,
      role: user.role,
      permissions: user.permissions || {},
      passwordChangeRequired: user.passwordChangeRequired || false,
    });
  } catch (err) {
    console.error('Session API error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
