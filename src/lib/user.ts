

'use server';

import { getSession, deleteSession } from './session';
import prisma from './prisma';
import type { User as AuthUser, Permissions } from '@/lib/types';
import { Prisma } from '@prisma/client';

export async function getUserFromSession(): Promise<AuthUser | null> {
  try {
    const session = await getSession();

    if (!session?.userId) {
      return null;
    }

    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      include: {
        role: true,
        loanProvider: true,
      },
    });

    if (!user) {
      return null;
    }
    
    if (user.status === 'Inactive') {
        await deleteSession();
        return null;
    }
    
    const { password, ...userWithoutPassword } = user;
    
    const authUser: AuthUser = {
      ...userWithoutPassword,
      role: user.role.name as AuthUser['role'],
      providerName: user.loanProvider?.name,
      permissions: JSON.parse(user.role.permissions as string) as Permissions,
      passwordChangeRequired: user.passwordChangeRequired,
    };

    return authUser;

  } catch (error) {
    const e = error as any;
    if (e && (e.name === 'PrismaClientKnownRequestError' || typeof e.code === 'string')) {
    }
    console.error('Get User Error:', error);
    return null;
  }
}

// Re-export cookies from next/headers to be used in server components
import { cookies } from 'next/headers';
export { cookies };
