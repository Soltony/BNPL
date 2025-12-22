
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import prisma from '@/lib/prisma';
import type { User as PrismaUser, Role as PrismaRole, LoanProvider as PrismaLoanProvider } from '@prisma/client';
import type { User as AuthUser, Permissions } from '@/lib/types';


export async function GET(req: NextRequest) {
  const requestId = req.headers.get('x-request-id') || 'n/a';
  try {
    const session = await getSession();

    if (!session?.userId) {
      console.debug('[auth.user]', { requestId, ok: false });
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      include: {
        role: true,
        loanProvider: true,
      },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const { password, ...userWithoutPassword } = user;
    
    const authUser: AuthUser = {
      ...userWithoutPassword,
      role: user.role.name as AuthUser['role'],
      providerName: user.loanProvider?.name,
      permissions: JSON.parse(user.role.permissions as string) as Permissions,
    };

    console.debug('[auth.user]', { requestId, ok: true, userId: authUser.id, role: authUser.role });
    const res = NextResponse.json(authUser, { status: 200 });
    res.headers.set('x-request-id', requestId);
    return res;

  } catch (error) {
    console.error('[auth.user] error', { requestId, error });
    const res = NextResponse.json({ error: 'An internal server error occurred.', requestId }, { status: 500 });
    res.headers.set('x-request-id', requestId);
    return res;
  }
}
