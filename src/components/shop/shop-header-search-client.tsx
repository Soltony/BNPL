'use client';

import React, { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Search } from 'lucide-react';

function useDebounced<T>(value: T, delay = 250) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

export default function ShopHeaderSearchClient({
  initialQ,
  initialCategoryId,
  categories,
  borrowerId,
}: {
  initialQ?: string;
  initialCategoryId?: string;
  categories: { id: string; name: string }[];
  borrowerId?: string;
}) {
  const [q, setQ] = useState(initialQ ?? '');
  const [categoryId, setCategoryId] = useState(initialCategoryId ?? '');

  const debouncedQ = useDebounced(q, 250);
  const debouncedCategory = useDebounced(categoryId, 200);

  useEffect(() => {
    const detail = { q: debouncedQ, categoryId: debouncedCategory };
    window.dispatchEvent(new CustomEvent('shop-search', { detail }));

    // keep URL in sync so reload preserves state
    try {
      const url = new URL(window.location.href);
      if (debouncedQ) url.searchParams.set('q', debouncedQ); else url.searchParams.delete('q');
      if (debouncedCategory) url.searchParams.set('categoryId', debouncedCategory); else url.searchParams.delete('categoryId');
      if (borrowerId) url.searchParams.set('borrowerId', borrowerId);
      window.history.replaceState({}, '', url.toString());
    } catch (_) {}
  }, [debouncedQ, debouncedCategory, borrowerId]);

  // fire initial event on mount
  useEffect(() => {
    const detail = { q, categoryId };
    window.dispatchEvent(new CustomEvent('shop-search', { detail }));
  }, []);

  return (
    <form className="flex items-center gap-3 w-full" onSubmit={(e) => e.preventDefault()}>
      <select
        name="categoryId"
        value={categoryId}
        onChange={(e) => setCategoryId(e.target.value)}
        className="bg-white text-black px-3 h-10 rounded-md text-sm"
      >
        <option value="">All Categories</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>

      <div className="relative flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
        <Input
          name="q"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="What are you looking for..."
          className="h-10 pl-10 bg-white text-black w-full"
        />
      </div>

      {borrowerId ? <input type="hidden" name="borrowerId" value={borrowerId} /> : null}
    </form>
  );
}
