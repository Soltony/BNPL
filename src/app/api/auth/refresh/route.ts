import { NextResponse } from 'next/server';
import { rotateSessionCookies } from '../../../../lib/session';

export async function GET() {
  const payload = await rotateSessionCookies();
  if (!payload) return new NextResponse(null, { status: 401 });
  return NextResponse.json({ ok: true, user: payload });
}
