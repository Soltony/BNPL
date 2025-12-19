'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function DiscountRulesRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/admin/merchants/discount-rules');
  }, [router]);

  return null;
}
