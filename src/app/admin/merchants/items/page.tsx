'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRequirePermission } from '@/hooks/use-require-permission';
import { useAuth } from '@/hooks/use-auth';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
// Dialog removed: edit is now a dedicated page
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Loader2, PlusCircle } from 'lucide-react';
import { postPendingChange } from '@/lib/fetch-utils';

type Merchant = { id: string; name: string; status: 'ACTIVE' | 'INACTIVE' };
type Category = { id: string; name: string; status: 'ACTIVE' | 'INACTIVE' };

type Item = {
  id: string;
  name: string;
  description?: string | null;
  price: number;
  currency: string;
  status: 'ACTIVE' | 'INACTIVE';
  stockQuantity?: number | null;
  merchantId: string;
  categoryId: string;
  merchant?: Merchant;
  category?: Category;
  variants?: Array<{
    id: string;
    size?: string | null;
    color?: string | null;
    material?: string | null;
    price: number;
    status: 'ACTIVE' | 'INACTIVE';
  }>;
  imageUrl?: string | null;
};

type VariantDraft = {
  id?: string;
  size: string;
  color: string;
  material: string;
  price: string;
  status: 'ACTIVE' | 'INACTIVE';
};

function StatusBadge({ status }: { status: string }) {
  const variant = status === 'ACTIVE' || status === 'DELIVERED' ? 'secondary' : status === 'INACTIVE' ? 'destructive' : 'default';
  return <Badge variant={variant as any}>{status}</Badge>;
}

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount) + ' ETB';

export default function MerchantItemsPage() {
  useRequirePermission('merchants');
  const { currentUser } = useAuth();
  const { toast } = useToast();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<Item[]>([]);

  // edit dialog state removed; edit now uses a dedicated edit page

  const [itemName, setItemName] = useState('');
  const [itemDescription, setItemDescription] = useState('');
  const [itemPrice, setItemPrice] = useState('');
  const [itemStatus, setItemStatus] = useState<'ACTIVE' | 'INACTIVE'>('ACTIVE');
  const [itemMerchantId, setItemMerchantId] = useState<string>('');
  const [itemCategoryId, setItemCategoryId] = useState<string>('');
  const [itemImageFile, setItemImageFile] = useState<File | null>(null);
  const [itemImagePreview, setItemImagePreview] = useState<string | null>(null);

  const [variants, setVariants] = useState<VariantDraft[]>([]);

  const themeColor = useMemo(() => {
    return currentUser?.role === 'Super Admin' ? 'hsl(var(--primary))' : 'hsl(var(--primary))';
  }, [currentUser]);

  const isMerchantUser = useMemo(() => String(currentUser?.role || '').toLowerCase() === 'merchant', [currentUser]);

  const load = async () => {
    try {
      setLoading(true);
      const [mRes, cRes, iRes] = await Promise.all([
        fetch('/api/admin/merchants'),
        fetch('/api/admin/product-categories'),
        fetch('/api/admin/items'),
      ]);
      if (!mRes.ok) throw new Error('Failed to load merchants');
      if (!cRes.ok) throw new Error('Failed to load categories');
      if (!iRes.ok) throw new Error('Failed to load items');

      setMerchants(await mRes.json());
      setCategories(await cRes.json());
      setItems(await iRes.json());
    } catch (err: any) {
      toast({ title: 'Error', description: err?.message || 'Failed to load data', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // add/edit logic moved to dedicated pages

  const deleteItem = async (id: string) => {
    try {
      const original = items.find((it) => it.id === id) || { id };
      await postPendingChange(
        {
          entityType: 'Merchants',
          entityId: id,
          changeType: 'DELETE',
          payload: JSON.stringify({ original: { type: 'Item', data: original } }),
        },
        'Failed to submit item deletion for approval.'
      );

      toast({ title: 'Submitted', description: 'Item deletion submitted for approval.' });
    } catch (err: any) {
      toast({ title: 'Error', description: err?.message || 'Failed to delete', variant: 'destructive' });
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-48">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Items</CardTitle>
          <CardDescription>Manage merchant items.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex justify-end">
            <Button
              onClick={() => router.push('/admin/merchants/items/new')}
              style={{ backgroundColor: themeColor }}
              className="text-white"
              disabled={!merchants.length || !categories.length}
            >
              <PlusCircle className="mr-2 h-4 w-4" /> Add Item
            </Button>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Merchant</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Price</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[220px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((it) => (
                <TableRow key={it.id}>
                  <TableCell className="font-medium">{it.name}</TableCell>
                  <TableCell>{it.merchant?.name || merchants.find((m) => m.id === it.merchantId)?.name}</TableCell>
                  <TableCell>{it.category?.name || categories.find((c) => c.id === it.categoryId)?.name}</TableCell>
                  <TableCell>{formatCurrency(it.price)}</TableCell>
                  <TableCell>
                    <StatusBadge status={it.status} />
                  </TableCell>
                  <TableCell className="flex gap-2">
                    <Button variant="outline" onClick={() => router.push(`/admin/merchants/items/${it.id}/edit`)}>
                      Edit
                    </Button>
                    <Button variant="destructive" onClick={() => deleteItem(it.id)}>
                      Delete
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* edit/add dialog removed — use /admin/merchants/items/new and /admin/merchants/items/[id]/edit */}
    </div>
  );
}
