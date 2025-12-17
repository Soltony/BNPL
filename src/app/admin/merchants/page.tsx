'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRequirePermission } from '@/hooks/use-require-permission';
import { useAuth } from '@/hooks/use-auth';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Loader2, PlusCircle } from 'lucide-react';

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
};

type Order = {
  id: string;
  borrowerId: string;
  status: string;
  totalAmount: number;
  createdAt: string;
  merchant?: Merchant;
  borrower?: { id: string };
  items: { id: string; quantity: number; lineTotal: number; item: { name: string } }[];
};

function StatusBadge({ status }: { status: string }) {
  const variant = status === 'ACTIVE' || status === 'DELIVERED' ? 'secondary' : status === 'INACTIVE' ? 'destructive' : 'default';
  return <Badge variant={variant as any}>{status}</Badge>;
}

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount) + ' ETB';

export default function MerchantsAdminPage() {
  useRequirePermission('merchants');
  const { currentUser } = useAuth();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);

  const [itemDialogOpen, setItemDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<Item | null>(null);

  const [itemName, setItemName] = useState('');
  const [itemDescription, setItemDescription] = useState('');
  const [itemPrice, setItemPrice] = useState('');
  const [itemStatus, setItemStatus] = useState<'ACTIVE' | 'INACTIVE'>('ACTIVE');
  const [itemMerchantId, setItemMerchantId] = useState<string>('');
  const [itemCategoryId, setItemCategoryId] = useState<string>('');

  const themeColor = useMemo(() => {
    return currentUser?.role === 'Super Admin' ? 'hsl(var(--primary))' : 'hsl(var(--primary))';
  }, [currentUser]);

  const isMerchantUser = useMemo(() => String(currentUser?.role || '').toLowerCase() === 'merchant', [currentUser]);

  const load = async () => {
    try {
      setLoading(true);
      const [mRes, cRes, iRes, oRes] = await Promise.all([
        fetch('/api/admin/merchants'),
        fetch('/api/admin/product-categories'),
        fetch('/api/admin/items'),
        fetch('/api/admin/orders'),
      ]);
      if (!mRes.ok) throw new Error('Failed to load merchants');
      if (!cRes.ok) throw new Error('Failed to load categories');
      if (!iRes.ok) throw new Error('Failed to load items');
      if (!oRes.ok) throw new Error('Failed to load orders');

      setMerchants(await mRes.json());
      setCategories(await cRes.json());
      setItems(await iRes.json());
      setOrders(await oRes.json());
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

  const openAddItem = () => {
    setEditingItem(null);
    setItemName('');
    setItemDescription('');
    setItemPrice('');
    setItemStatus('ACTIVE');
    setItemMerchantId(isMerchantUser ? (currentUser?.merchantId || '') : (merchants[0]?.id || ''));
    setItemCategoryId(categories[0]?.id || '');
    setItemDialogOpen(true);
  };

  const openEditItem = (it: Item) => {
    setEditingItem(it);
    setItemName(it.name);
    setItemDescription(it.description || '');
    setItemPrice(String(it.price));
    setItemStatus(it.status);
    setItemMerchantId(it.merchantId);
    setItemCategoryId(it.categoryId);
    setItemDialogOpen(true);
  };

  const saveItem = async () => {
    try {
      const price = Number(itemPrice);
      if (!Number.isFinite(price) || price < 0) throw new Error('Invalid price');

      const method = editingItem ? 'PUT' : 'POST';
      const body: any = {
        merchantId: isMerchantUser ? currentUser?.merchantId : itemMerchantId,
        categoryId: itemCategoryId,
        name: itemName,
        description: itemDescription || null,
        price,
        status: itemStatus,
      };
      if (editingItem) body.id = editingItem.id;

      const res = await fetch('/api/admin/items', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Failed to save item');

      toast({ title: 'Saved', description: 'Item saved successfully.' });
      setItemDialogOpen(false);
      await load();
    } catch (err: any) {
      toast({ title: 'Error', description: err?.message || 'Failed to save', variant: 'destructive' });
    }
  };

  const deleteItem = async (id: string) => {
    try {
      const res = await fetch(`/api/admin/items?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Failed to delete item');
      toast({ title: 'Deleted', description: 'Item deleted.' });
      await load();
    } catch (err: any) {
      toast({ title: 'Error', description: err?.message || 'Failed to delete', variant: 'destructive' });
    }
  };

  const confirmAvailability = async (orderId: string) => {
    try {
      const res = await fetch('/api/admin/orders', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: orderId, status: 'ON_DELIVERY' }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Failed to update order');
      toast({ title: 'Updated', description: 'Order moved to ON_DELIVERY.' });
      await load();
    } catch (err: any) {
      toast({ title: 'Error', description: err?.message || 'Failed to update', variant: 'destructive' });
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
          <CardTitle>Merchants</CardTitle>
          <CardDescription>Manage items and merchant orders.</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="items">
            <TabsList>
              <TabsTrigger value="items">Items</TabsTrigger>
              <TabsTrigger value="orders">Orders</TabsTrigger>
            </TabsList>

            <TabsContent value="items" className="space-y-4">
              <div className="flex justify-end">
                <Button onClick={openAddItem} style={{ backgroundColor: themeColor }} className="text-white" disabled={!merchants.length || !categories.length}>
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
                      <TableCell>{it.merchant?.name || merchants.find(m => m.id === it.merchantId)?.name}</TableCell>
                      <TableCell>{it.category?.name || categories.find(c => c.id === it.categoryId)?.name}</TableCell>
                      <TableCell>{formatCurrency(it.price)}</TableCell>
                      <TableCell><StatusBadge status={it.status} /></TableCell>
                      <TableCell className="flex gap-2">
                        <Button variant="outline" onClick={() => openEditItem(it)}>Edit</Button>
                        <Button variant="destructive" onClick={() => deleteItem(it.id)}>Delete</Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TabsContent>

            <TabsContent value="orders" className="space-y-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order</TableHead>
                    <TableHead>Order Date</TableHead>
                    <TableHead>Item(s)</TableHead>
                    <TableHead>Borrower</TableHead>
                    <TableHead>Merchant</TableHead>
                    <TableHead>Total</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-[260px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orders.map((o) => (
                    <TableRow key={o.id}>
                      <TableCell className="font-mono text-xs">{o.id}</TableCell>
                      <TableCell className="font-mono text-xs">{o.createdAt ? new Date(o.createdAt).toLocaleString() : '-'}</TableCell>
                      <TableCell>{o.items?.map(it => it.item?.name).filter(Boolean).join(', ') || '-'}</TableCell>
                      <TableCell className="font-mono text-xs">{o.borrowerId}</TableCell>
                      <TableCell>{o.merchant?.name}</TableCell>
                      <TableCell>{formatCurrency(o.totalAmount)}</TableCell>
                      <TableCell><StatusBadge status={o.status} /></TableCell>
                      <TableCell className="flex gap-2">
                        <Button
                          variant="outline"
                          disabled={o.status !== 'PENDING_MERCHANT_CONFIRMATION'}
                          onClick={() => confirmAvailability(o.id)}
                        >
                          Confirm availability
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Dialog open={itemDialogOpen} onOpenChange={setItemDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingItem ? 'Edit Item' : 'Add Item'}</DialogTitle>
            <DialogDescription>Item details used by borrowers in the shop.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="text-sm font-medium">Merchant</div>
              <Select value={itemMerchantId} onValueChange={setItemMerchantId} disabled={isMerchantUser}>
                <SelectTrigger>
                  <SelectValue placeholder="Select merchant" />
                </SelectTrigger>
                <SelectContent>
                  {merchants.map((m) => (
                    <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <div className="text-sm font-medium">Category</div>
              <Select value={itemCategoryId} onValueChange={setItemCategoryId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <div className="text-sm font-medium">Name</div>
              <Input value={itemName} onChange={(e) => setItemName(e.target.value)} />
            </div>

            <div className="space-y-2">
              <div className="text-sm font-medium">Description</div>
              <Input value={itemDescription} onChange={(e) => setItemDescription(e.target.value)} />
            </div>

            <div className="space-y-2">
              <div className="text-sm font-medium">Price (ETB)</div>
              <Input value={itemPrice} onChange={(e) => setItemPrice(e.target.value)} inputMode="decimal" />
            </div>

            <div className="space-y-2">
              <div className="text-sm font-medium">Status</div>
              <Select value={itemStatus} onValueChange={(v) => setItemStatus(v as any)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ACTIVE">ACTIVE</SelectItem>
                  <SelectItem value="INACTIVE">INACTIVE</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setItemDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={saveItem}
              style={{ backgroundColor: themeColor }}
              className="text-white"
              disabled={!itemName.trim() || !itemMerchantId || !itemCategoryId}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
