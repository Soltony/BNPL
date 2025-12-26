import { Suspense } from 'react';
import BnplOrdersClient from './client';

export default function BnplOrdersPage() {
  return (
    <Suspense fallback={<div className="container py-8 md:py-12">Loading…</div>}>
      <BnplOrdersClient />
    </Suspense>
  );
}
