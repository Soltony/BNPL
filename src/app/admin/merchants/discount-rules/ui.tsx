'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRequirePermission } from '@/hooks/use-require-permission';
import { useAuth } from '@/hooks/use-auth';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Loader2, PlusCircle } from 'lucide-react';
import { postPendingChange } from '@/lib/fetch-utils';

type Category = { id: string; name: string; status: 'ACTIVE' | 'INACTIVE' };
type Item = { id: string; name: string; status: 'ACTIVE' | 'INACTIVE' };

type DiscountRule = {
  id: string;
  type: 'percentage' | 'fixed' | 'buy-X-get-Y';
  value: number;
  startDate?: string | null;
  endDate?: string | null;
  itemId?: string | null;
  categoryId?: string | null;
  minimumQuantity?: number | null;
  item?: Item | null;
  category?: Category | null;
};

function TypeBadge({ type }: { type: DiscountRule['type'] }) {
  const variant = type === 'percentage' ? 'secondary' : type === 'fixed' ? 'default' : 'outline';
  return <Badge variant={variant as any}>{type}</Badge>;
}

export default function DiscountRulesPage() {
  useRequirePermission('merchants');
  const { currentUser } = useAuth();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [rules, setRules] = useState<DiscountRule[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<DiscountRule | null>(null);

  const [type, setType] = useState<DiscountRule['type']>('percentage');
  const [value, setValue] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [itemId, setItemId] = useState<string>('');
  const [categoryId, setCategoryId] = useState<string>('');
  const [minimumQuantity, setMinimumQuantity] = useState('');

  const themeColor = useMemo(() => {
    return currentUser?.role === 'Super Admin' ? 'hsl(var(--primary))' : 'hsl(var(--primary))';
  }, [currentUser]);

  const load = async () => {
    try {
      setLoading(true);
      const [rRes, iRes, cRes] = await Promise.all([
        fetch('/api/admin/discount-rules'),
        fetch('/api/admin/items'),
        fetch('/api/admin/product-categories'),
      ]);
      if (!rRes.ok) throw new Error('Failed to load discount rules');
      if (!iRes.ok) throw new Error('Failed to load items');
      if (!cRes.ok) throw new Error('Failed to load categories');

      const rulesJson = await rRes.json();
      const itemsJson = await iRes.json();
      const catsJson = await cRes.json();

      setRules(Array.isArray(rulesJson) ? rulesJson : []);
      setItems(Array.isArray(itemsJson) ? itemsJson : []);
      setCategories(Array.isArray(catsJson) ? catsJson : []);
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

  const openAdd = () => {
    setEditing(null);
    setType('percentage');
    setValue('');
    setStartDate('');
    setEndDate('');
    setItemId('');
    setCategoryId('');
    setMinimumQuantity('');
    setDialogOpen(true);
  };

  const openEdit = (r: DiscountRule) => {
    setEditing(r);
    setType(r.type);
    setValue(String(r.value));
    setStartDate(r.startDate ? r.startDate.slice(0, 10) : '');
    setEndDate(r.endDate ? r.endDate.slice(0, 10) : '');
    setItemId(r.itemId || '');
    setCategoryId(r.categoryId || '');
    setMinimumQuantity(r.minimumQuantity ? String(r.minimumQuantity) : '');
    setDialogOpen(true);
  };

  const save = async () => {
    try {
      const parsedValue = Number(value);
      if (!Number.isFinite(parsedValue)) throw new Error('Invalid value');

      const parsedMinQty = minimumQuantity.trim() ? Number(minimumQuantity) : null;
      if (parsedMinQty !== null && (!Number.isInteger(parsedMinQty) || parsedMinQty <= 0)) throw new Error('Invalid minimum quantity');

      const method = editing ? 'PUT' : 'POST';
      const payload: any = {
        type,
        value: parsedValue,
        startDate: startDate ? new Date(startDate).toISOString() : null,
        endDate: endDate ? new Date(endDate).toISOString() : null,
        itemId: itemId || null,
        categoryId: categoryId || null,
        minimumQuantity: parsedMinQty,
      };
      if (editing) payload.id = editing.id;

      await postPendingChange(
        {
          entityType: 'Merchants',
          entityId: editing?.id,
          changeType: editing ? 'UPDATE' : 'CREATE',
          payload: JSON.stringify(
            editing
              ? { original: { type: 'DiscountRule', data: editing }, updated: { type: 'DiscountRule', data: payload } }
              : { created: { type: 'DiscountRule', data: payload } }
          ),
        },
        'Failed to submit discount rule for approval.'
      );

      toast({ title: 'Submitted', description: 'Discount rule submitted for approval.' });
      setDialogOpen(false);
      await load();
    } catch (err: any) {
      toast({ title: 'Error', description: err?.message || 'Failed to save', variant: 'destructive' });
    }
  };

  const remove = async (id: string) => {
    try {
      const original = rules.find((r) => r.id === id) || { id };
      await postPendingChange(
        {
          entityType: 'Merchants',
          entityId: id,
          changeType: 'DELETE',
          payload: JSON.stringify({ original: { type: 'DiscountRule', data: original } }),
        },
        'Failed to submit discount rule deletion for approval.'
      );

      toast({ title: 'Submitted', description: 'Discount rule deletion submitted for approval.' });
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
          <CardTitle>Discount Rules</CardTitle>
          <CardDescription>Define reusable discount rules for items and categories.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex justify-end">
            <Button onClick={openAdd} style={{ backgroundColor: themeColor }} className="text-white">
              <PlusCircle className="mr-2 h-4 w-4" /> Add Rule
            </Button>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Value</TableHead>
                <TableHead>Start</TableHead>
                <TableHead>End</TableHead>
                <TableHead>Item</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Min Qty</TableHead>
                <TableHead className="w-[220px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rules.map((r) => (
                <TableRow key={r.id}>
                  <TableCell><TypeBadge type={r.type} /></TableCell>
                  <TableCell>{r.value}</TableCell>
                  <TableCell>{r.startDate ? r.startDate.slice(0, 10) : '-'}</TableCell>
                  <TableCell>{r.endDate ? r.endDate.slice(0, 10) : '-'}</TableCell>
                  <TableCell>{r.item?.name || (r.itemId ? items.find((i) => i.id === r.itemId)?.name : '') || '-'}</TableCell>
                  <TableCell>{r.category?.name || (r.categoryId ? categories.find((c) => c.id === r.categoryId)?.name : '') || '-'}</TableCell>
                  <TableCell>{r.minimumQuantity ?? '-'}</TableCell>
                  <TableCell className="flex gap-2">
                    <Button variant="outline" onClick={() => openEdit(r)}>Edit</Button>
                    <Button variant="destructive" onClick={() => remove(r.id)}>Delete</Button>
                  </TableCell>
                </TableRow>
              ))}
              {rules.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground">No discount rules yet.</TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Discount Rule' : 'Add Discount Rule'}</DialogTitle>
            <DialogDescription>Set type, validity period, and optional scope.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <div className="text-sm font-medium">Type</div>
              <Select value={type} onValueChange={(v) => setType(v as any)}>
                <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="percentage">percentage</SelectItem>
                  <SelectItem value="fixed">fixed</SelectItem>
                  <SelectItem value="buy-X-get-Y">buy-X-get-Y</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <div className="text-sm font-medium">Value</div>
              <Input value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <div className="text-sm font-medium">Start Date</div>
                <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </div>
              <div className="space-y-2">
                <div className="text-sm font-medium">End Date</div>
                <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-sm font-medium">Item (optional)</div>
              <Select value={itemId || '__none__'} onValueChange={(v) => setItemId(v === '__none__' ? '' : v)}>
                <SelectTrigger><SelectValue placeholder="Select item" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">(none)</SelectItem>
                  {items.map((it) => (
                    <SelectItem key={it.id} value={it.id}>{it.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <div className="text-sm font-medium">Category (optional)</div>
              <Select value={categoryId || '__none__'} onValueChange={(v) => setCategoryId(v === '__none__' ? '' : v)}>
                <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">(none)</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <div className="text-sm font-medium">Minimum Quantity (optional)</div>
              <Input value={minimumQuantity} onChange={(e) => setMinimumQuantity(e.target.value)} inputMode="numeric" />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={save} style={{ backgroundColor: themeColor }} className="text-white" disabled={!value.trim()}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
