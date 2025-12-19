'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const formatCurrency = (amount: number | null | undefined) => {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return '0.00 ETB';
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount) + ' ETB';
};

type ShopItemOptionValue = {
  id: string;
  label: string;
  priceDelta: number;
  status?: string;
};

type ShopItemOptionGroup = {
  id: string;
  name: string;
  isRequired?: boolean;
  values: ShopItemOptionValue[];
};

type ShopItem = {
  id: string;
  name: string;
  imageUrl?: string | null;
  videoUrl?: string | null;
  price: number;
  merchantName: string;
  categoryName: string;
  optionGroups?: ShopItemOptionGroup[];
};

type PricingPreview = {
  finalTotal?: number;
  finalUnitPrice?: number;
  appliedDiscount?: { ruleId: string; type: string; value: number; amount: number } | null;
};

export function ShopItemDetailClient({ item, borrowerId }: { item: ShopItem; borrowerId?: string }) {
  const quantity = 1;

  const [selectedOptionValueIdsByGroup, setSelectedOptionValueIdsByGroup] = useState<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    for (const g of item.optionGroups ?? []) {
      const first = g.values?.[0]?.id;
      if (first) map[g.id] = first;
    }
    return map;
  });

  useEffect(() => {
    const map: Record<string, string> = {};
    for (const g of item.optionGroups ?? []) {
      const first = g.values?.[0]?.id;
      if (first) map[g.id] = first;
    }
    setSelectedOptionValueIdsByGroup(map);
  }, [item.id]);

  const selectedOptionValueIds = useMemo(() => {
    return Object.values(selectedOptionValueIdsByGroup).filter(Boolean);
  }, [selectedOptionValueIdsByGroup]);

  const selectedOptionsDelta = useMemo(() => {
    const groups = item.optionGroups ?? [];
    const lookup = new Map<string, number>();
    for (const g of groups) {
      for (const v of g.values ?? []) lookup.set(v.id, v.priceDelta || 0);
    }
    return selectedOptionValueIds.reduce((sum, id) => sum + (lookup.get(id) ?? 0), 0);
  }, [item.optionGroups, selectedOptionValueIds]);

  const selectedItemUnitPrice = (item.price ?? 0) + selectedOptionsDelta;
  const selectedItemTotalAmount = quantity * selectedItemUnitPrice;

  const [preview, setPreview] = useState<PricingPreview | null>(null);

  useEffect(() => {
    const fetchPreview = async () => {
      try {
        const params = new URLSearchParams();
        params.set('itemId', item.id);
        params.set('qty', String(quantity));
        if (selectedOptionValueIds.length) params.set('optionValueIds', selectedOptionValueIds.join(','));
        const res = await fetch(`/api/pricing/preview?${params.toString()}`);
        if (!res.ok) {
          setPreview(null);
          return;
        }
        const data = (await res.json()) as PricingPreview;
        setPreview(data);
      } catch {
        setPreview(null);
      }
    };

    fetchPreview();
  }, [item.id, quantity, selectedOptionValueIds]);

  const previewFinalTotal = typeof preview?.finalTotal === 'number' ? preview!.finalTotal! : null;
  const previewAppliedDiscount = preview?.appliedDiscount ?? null;

  const changeItemHref = borrowerId ? `/shop?borrowerId=${encodeURIComponent(borrowerId)}` : '/shop';

  const loanParams = new URLSearchParams();
  loanParams.set('itemId', item.id);
  loanParams.set('qty', String(quantity));
  if (borrowerId) loanParams.set('borrowerId', borrowerId);
  if (selectedOptionValueIds.length) loanParams.set('optionValueIds', selectedOptionValueIds.join(','));
  const chooseLoanHref = `/loan?${loanParams.toString()}`;

  return (
    <Card className="my-4">
      <CardHeader>
        <CardTitle className="text-base">Selected item</CardTitle>
        <CardDescription>
          {item.merchantName} • {item.categoryName}
        </CardDescription>
      </CardHeader>
      {item.imageUrl ? (
        <div className="p-4">
          <img src={item.imageUrl} alt={item.name} className="w-full max-h-64 object-cover rounded" />
        </div>
      ) : null}
      <CardContent className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="font-medium">{item.name}</div>
          <div className="text-sm text-muted-foreground">{quantity}×</div>
        </div>

        {item.optionGroups && item.optionGroups.length > 0 ? (
          <div className="flex flex-col gap-3 pt-1">
            {item.optionGroups.map((g) => (
              <div key={g.id} className="flex flex-col gap-2">
                <div className="text-sm text-muted-foreground">{g.name}</div>
                <Select
                  value={selectedOptionValueIdsByGroup[g.id] ?? ''}
                  onValueChange={(val) => setSelectedOptionValueIdsByGroup((prev) => ({ ...prev, [g.id]: val }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={`Select ${g.name}`} />
                  </SelectTrigger>
                  <SelectContent>
                    {(g.values ?? []).map((v) => (
                      <SelectItem key={v.id} value={v.id}>
                        {v.label} ({v.priceDelta >= 0 ? '+' : ''}{formatCurrency(v.priceDelta)})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
        ) : null}

        <div className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">Total</div>
          <div className="font-semibold">
            {previewFinalTotal !== null && previewFinalTotal !== selectedItemTotalAmount ? (
              <div className="space-y-0 text-right">
                <div className="text-sm text-muted-foreground line-through">{formatCurrency(selectedItemTotalAmount)}</div>
                <div>{formatCurrency(previewFinalTotal)}</div>
                {previewAppliedDiscount ? (
                  <div className="text-xs text-green-600">Discount: -{formatCurrency(previewAppliedDiscount.amount)}</div>
                ) : null}
              </div>
            ) : (
              <div className="text-right">{formatCurrency(selectedItemTotalAmount)}</div>
            )}
          </div>
        </div>

        <div className="pt-2 flex gap-2">
          {item.videoUrl ? (
            <a href={item.videoUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center px-3 py-2 rounded-md text-sm text-primary underline">
              Watch video
            </a>
          ) : null}
          <Button asChild variant="outline">
            <Link href={changeItemHref}>Change item</Link>
          </Button>
          <Button asChild>
            <Link href={chooseLoanHref}>Choose loan product</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
