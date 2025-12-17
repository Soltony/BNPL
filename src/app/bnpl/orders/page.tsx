'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

type Order = {
  id: string;
  status: string;
  totalAmount: number;
  merchant: { name: string };
  items: { quantity: number; lineTotal: number; item: { name: string } }[];
  loan?: { id: string } | null;
  createdAt: string;
};

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount) + ' ETB';

function StatusBadge({ status }: { status: string }) {
  const variant = status === 'DELIVERED' ? 'secondary' : status === 'ON_DELIVERY' ? 'default' : status === 'CANCELLED' ? 'destructive' : 'outline';
  return <Badge variant={variant as any}>{status}</Badge>;
}

export default function BnplOrdersPage() {
  const sp = useSearchParams();
  const borrowerId = sp.get('borrowerId') || '';
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<Order[]>([]);
  const [working, setWorking] = useState<string | null>(null);

  const canLoad = useMemo(() => borrowerId.trim().length > 0, [borrowerId]);

  const load = async () => {
    if (!canLoad) {
      setOrders([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const res = await fetch(`/api/bnpl/orders?borrowerId=${encodeURIComponent(borrowerId)}`);
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || 'Failed to load orders');
      }
      setOrders(await res.json());
    } catch (err: any) {
      toast({ title: 'Error', description: err?.message || 'Failed to load', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canLoad]);

  const confirmDelivered = async (orderId: string) => {
    try {
      setWorking(orderId);
      const res = await fetch(`/api/bnpl/orders/${encodeURIComponent(orderId)}/confirm-delivered`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ borrowerId }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Failed to confirm delivery');

      toast({ title: 'Confirmed', description: 'Delivery confirmed. Loan was disbursed.' });
      await load();
    } catch (err: any) {
      toast({ title: 'Error', description: err?.message || 'Failed to confirm', variant: 'destructive' });
    } finally {
      setWorking(null);
    }
  };

  if (!canLoad) {
    return (
      <div className="container py-8 md:py-12">
        <Card>
          <CardHeader>
            <CardTitle>My Orders</CardTitle>
            <CardDescription>Missing borrowerId in URL.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="container py-8 md:py-12 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">My Orders</h1>
        <p className="text-muted-foreground">Track BNPL order status and confirm delivery.</p>
      </div>

      {loading ? (
        <div className="flex justify-center items-center h-48">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Orders</CardTitle>
            <CardDescription>Borrower: {borrowerId}</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order</TableHead>
                  <TableHead>Merchant</TableHead>
                  <TableHead>Items</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-[240px]">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell className="font-mono text-xs">{o.id}</TableCell>
                    <TableCell>{o.merchant?.name}</TableCell>
                    <TableCell>
                      {o.items?.map((it, idx) => (
                        <div key={idx} className="text-sm">
                          {it.quantity}× {it.item?.name}
                        </div>
                      ))}
                    </TableCell>
                    <TableCell>{formatCurrency(o.totalAmount)}</TableCell>
                    <TableCell><StatusBadge status={o.status} /></TableCell>
                    <TableCell>
                      <Button
                        variant="outline"
                        disabled={o.status !== 'ON_DELIVERY' || working === o.id}
                        onClick={() => confirmDelivered(o.id)}
                      >
                        {working === o.id ? 'Working…' : 'Confirm delivered'}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
