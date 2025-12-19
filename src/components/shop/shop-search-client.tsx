'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Play } from 'lucide-react';
import Link from 'next/link';

type Item = {
  id: string;
  name: string;
  imageUrl?: string | null;
  videoUrl?: string | null;
  price: number;
  merchantName?: string | null;
  categoryName?: string | null;
  discount?: { type: string; value: string } | null;
};

function formatAmount(amount: number) {
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
}

function useDebounced<T>(value: T, delay = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

export default function ShopSearchClient({
  initialItems,
  categories,
  borrowerId,
  hideControls,
  initialQ,
  initialCategoryId,
}: {
  initialItems: Item[];
  categories: { id: string; name: string }[];
  borrowerId?: string;
  hideControls?: boolean;
  initialQ?: string;
  initialCategoryId?: string;
}) {
  const [items, setItems] = useState<Item[]>(initialItems ?? []);
  const [q, setQ] = useState(initialQ ?? '');
  const [categoryId, setCategoryId] = useState(initialCategoryId ?? '');

  const debouncedQ = useDebounced(q, 300);
  const debouncedCategory = useDebounced(categoryId, 200);

  useEffect(() => {
    const abort = new AbortController();
    const run = async () => {
      try {
        const params = new URLSearchParams();
        if (debouncedQ) params.set('q', debouncedQ);
        if (debouncedCategory) params.set('categoryId', debouncedCategory);
        const res = await fetch(`/api/shop/search?${params.toString()}`, { signal: abort.signal });
        if (!res.ok) return;
        const data = (await res.json()) as Item[];
        setItems(data);
      } catch (err) {
        if ((err as any).name === 'AbortError') return;
        console.error(err);
      }
    };
    run();
    return () => abort.abort();
  }, [debouncedQ, debouncedCategory]);

  // Listen to header search events
  useEffect(() => {
    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent).detail as { q?: string; categoryId?: string };
      if (detail) {
        if (typeof detail.q === 'string') setQ(detail.q);
        if (typeof detail.categoryId === 'string') setCategoryId(detail.categoryId);
      }
    };
    window.addEventListener('shop-search', handler as EventListener);
    return () => window.removeEventListener('shop-search', handler as EventListener);
  }, []);

  return (
    <section>
      {!hideControls && (
        <div className="mb-4 flex items-center gap-3">
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="bg-white text-black px-3 py-2 rounded-md text-sm">
            <option value="">All Categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <div className="relative flex-1">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="What are you looking for..." className="pl-10" />
          </div>
        </div>
      )}

      <div className="grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4 px-2 -mx-2">
        {items.map((item) => {
          const href = borrowerId ? `/shop/${encodeURIComponent(item.id)}?borrowerId=${encodeURIComponent(borrowerId)}` : `/shop/${encodeURIComponent(item.id)}`;
          const hasDiscount = !!item.discount;
          const discountedAmount = hasDiscount
            ? item.discount!.type === 'percentage'
              ? item.price * (1 - Number(item.discount!.value) / 100)
              : item.price - Number(item.discount!.value)
            : item.price;

          return (
            <Card key={item.id} className="overflow-hidden group flex flex-col h-full min-h-[220px] rounded-lg shadow-xl hover:shadow-2xl transition-shadow">
              <div className="relative overflow-hidden">
                <Link href={href}>
                  <img src={item.imageUrl ?? `https://placehold.co/600x400/eee/ccc?text=${encodeURIComponent(item.name)}`} alt={item.name} className="w-full h-40 object-cover group-hover:scale-105 transition-transform duration-300 shadow-md" />
                </Link>
              </div>

              <CardHeader className="pt-2 pb-1 space-y-1">
                <CardDescription className="text-[10px] tracking-wide text-muted-foreground uppercase">{item.merchantName}</CardDescription>
                <CardTitle className="text-sm font-semibold leading-snug line-clamp-2">{item.name}</CardTitle>
              </CardHeader>

              <CardContent className="pt-0 flex flex-col gap-2 flex-1">
                {item.videoUrl ? (
                  <a href={item.videoUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-sm font-medium text-primary bg-primary/10 hover:bg-primary/20 px-2 py-1 rounded-md shadow-sm">
                    <Play className="h-4 w-4 text-primary" />
                    <span>Watch video</span>
                  </a>
                ) : (
                  <div className="h-5" />
                )}

                <div className="mt-auto flex items-end justify-between gap-2">
                  <div className="space-y-1">
                    {hasDiscount ? (
                      <>
                        <div className="text-xs text-muted-foreground">Now</div>
                        <div className="leading-none">
                          <span className="text-base font-semibold">{formatAmount(Math.round((discountedAmount + Number.EPSILON) * 100) / 100)}</span>
                          <span className="ml-1 text-xs text-muted-foreground">ETB</span>
                        </div>
                        <div className="text-xs text-muted-foreground">Price: <span className="line-through">{formatAmount(item.price)} ETB</span></div>
                      </>
                    ) : (
                      <>
                        <div className="text-xs text-muted-foreground">Price</div>
                        <div className="leading-none"><span className="text-base font-semibold">{formatAmount(item.price)}</span><span className="ml-1 text-xs text-muted-foreground">ETB</span></div>
                      </>
                    )}
                  </div>

                  <Button asChild size="sm" className="self-end">
                    <Link href={href}>Select</Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </section>
  );
}
