'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from './use-auth';

export function useRequirePermission(moduleName: string) {
  const { currentUser, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;
    if (!currentUser) {
      router.replace('/admin/login');
      return;
    }

    const allowed = !!currentUser.permissions?.[moduleName]?.read;
    if (!allowed) {
      router.replace('/admin/forbidden');
    }
  }, [currentUser, isLoading, moduleName, router]);
}
