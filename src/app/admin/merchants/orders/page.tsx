'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRequirePermission } from '@/hooks/use-require-permission';
import { useAuth } from '@/hooks/use-auth';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Loader2 } from 'lucide-react';

type Merchant = { id: string; name: string; status: 'ACTIVE' | 'INACTIVE' };

type Order = {
  id: string;
  borrowerId: string;
  status: string;
  totalAmount: number;
  createdAt: string;
  merchant?: Merchant;
  borrower?: { id: string };
  items: ({ id: string; quantity: number; lineTotal: number; item: { name: string };
    optionSelections?: { optionValueLabel?: string; optionGroupName?: string; optionValue?: { label?: string } }[];
    variant?: { size?: string; color?: string; material?: string } } )[];
};

function StatusBadge({ status }: { status: string }) {
  const variant = status === 'ACTIVE' || status === 'DELIVERED' ? 'secondary' : status === 'INACTIVE' ? 'destructive' : 'default';
  return <Badge variant={variant as any}>{status}</Badge>;
}

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount) + ' ETB';

export default function MerchantOrdersPage() {
  useRequirePermission('merchants');
  const { currentUser } = useAuth();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<Order[]>([]);

  const themeColor = useMemo(() => {
    return currentUser?.role === 'Super Admin' ? 'hsl(var(--primary))' : 'hsl(var(--primary))';
  }, [currentUser]);

  const load = async () => {
    try {
      setLoading(true);
      const oRes = await fetch('/api/admin/orders');
      if (!oRes.ok) throw new Error('Failed to load orders');
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
          <CardTitle>Orders</CardTitle>
          <CardDescription>Manage merchant orders.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order</TableHead>
                <TableHead>Order Date</TableHead>
                <TableHead>Item(s)</TableHead>
                <TableHead>Attributes</TableHead>
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
                  <TableCell>{o.items?.map((it) => it.item?.name).filter(Boolean).join(', ') || '-'}</TableCell>
                  <TableCell>
                    {o.items?.
                      map((it) => {
                        const parts: string[] = [];
                        if (it.variant) {
                          const vals = [] as string[];
                          if (it.variant.size) vals.push(`Size: ${it.variant.size}`);
                          if (it.variant.color) vals.push(`Color: ${it.variant.color}`);
                          if (it.variant.material) vals.push(`Material: ${it.variant.material}`);
                          if (vals.length) parts.push(vals.join(', '));
                        }
                        if (it.optionSelections && it.optionSelections.length) {
                          const opts = it.optionSelections
                            .map((s) => {
                              const label = s.optionValueLabel || s.optionValue?.label;
                              if (!label) return null;
                              return s.optionGroupName ? `${s.optionGroupName}: ${label}` : label;
                            })
                            .filter(Boolean)
                            .join(', ');
                          if (opts) parts.push(opts);
                        }
                        return parts.join(' | ');
                      })
                      .filter(Boolean)
                      .join(' ; ') || '-'}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{o.borrowerId}</TableCell>
                  <TableCell>{o.merchant?.name || '-'}</TableCell>
                  <TableCell>{formatCurrency(o.totalAmount)}</TableCell>
                  <TableCell>
                    <StatusBadge status={o.status} />
                  </TableCell>
                  <TableCell className="flex gap-2">
                    <Button
                      variant="outline"
                      disabled={o.status !== 'PENDING_MERCHANT_CONFIRMATION'}
                      onClick={() => confirmAvailability(o.id)}
                      style={{ borderColor: themeColor }}
                    >
                      Confirm availability
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
