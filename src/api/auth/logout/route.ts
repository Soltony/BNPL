
import { deleteSession, getSession } from '@/lib/session';
import { NextResponse } from 'next/server';
import { createAuditLog } from '@/lib/audit-log';

export async function POST() {
  const session = await getSession();
  if (session?.userId) {
    await createAuditLog({ actorId: session.userId, action: 'USER_LOGOUT_SUCCESS' });
    console.log(JSON.stringify({
        action: 'USER_LOGOUT_SUCCESS',
        userId: session.userId,
    }));
  }
  
  deleteSession();
  return NextResponse.json({ success: true });
}
