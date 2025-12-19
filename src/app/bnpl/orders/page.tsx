'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

type Order = {
  id: string;
  status: string;
  totalAmount: number;
  merchant: { name: string };
  items: { quantity: number; lineTotal: number; item: { id: string; name: string; imageUrl?: string | null } }[];
  loan?: { id: string } | null;
  createdAt: string;
};

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount) + ' ETB';

const formatShortDate = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' });
};

function StatusBadge({ status }: { status: string }) {
  const variant = status === 'DELIVERED' ? 'secondary' : status === 'ON_DELIVERY' ? 'default' : status === 'CANCELLED' ? 'destructive' : 'outline';
  return <Badge variant={variant as any}>{status}</Badge>;
}

function OrderItemsSummary({ items }: { items: Order['items'] }) {
  if (!items?.length) return null;
  return (
    <div className="space-y-1">
      {items.map((it, idx) => (
        <div key={idx} className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{it.quantity}×</span> {it.item?.name}
        </div>
      ))}
    </div>
  );
}

export default function BnplOrdersPage() {
  const sp = useSearchParams();
  const borrowerId = sp.get('borrowerId') || '';
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<Order[]>([]);
  const [working, setWorking] = useState<string | null>(null);
  const [openOrderId, setOpenOrderId] = useState<string | null>(null);

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
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Orders</CardTitle>
              <CardDescription>Borrower: {borrowerId}</CardDescription>
            </CardHeader>
          </Card>

          {orders.length === 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">No orders yet</CardTitle>
                <CardDescription>Your BNPL orders will appear here.</CardDescription>
              </CardHeader>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {orders.map((o) => (
                <Card key={o.id} className="overflow-hidden">
                  <button
                    type="button"
                    className="w-full text-left"
                    onClick={() => setOpenOrderId((prev) => (prev === o.id ? null : o.id))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setOpenOrderId((prev) => (prev === o.id ? null : o.id));
                      }
                    }}
                  >
                    <CardContent className="p-4">
                      {(() => {
                        const first = o.items?.[0];
                        const title = first?.item?.name ?? 'Order';
                        const img =
                          first?.item?.imageUrl ??
                          `https://placehold.co/120x120/eee/ccc?text=${encodeURIComponent(title)}`;

                        return (
                          <div className="flex items-center gap-3">
                            <img
                              src={img}
                              alt={title}
                              className="h-14 w-14 rounded-md object-cover border bg-muted"
                            />
                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-semibold leading-tight line-clamp-2">{title}</div>
                            </div>
                            <div className="flex items-center gap-2">
                              <div className="text-sm font-semibold whitespace-nowrap">{formatCurrency(o.totalAmount)}</div>
                              {openOrderId === o.id ? (
                                <ChevronUp className="h-4 w-4 text-muted-foreground" />
                              ) : (
                                <ChevronDown className="h-4 w-4 text-muted-foreground" />
                              )}
                            </div>
                          </div>
                        );
                      })()}
                    </CardContent>
                  </button>

                  {openOrderId === o.id ? (
                    <CardContent className="pt-0 px-4 pb-4 space-y-4">
                      <div className="grid gap-2">
                        <div className="flex items-start justify-between gap-4">
                          <div className="text-xs text-muted-foreground">Status</div>
                          <div className="shrink-0">
                            <StatusBadge status={o.status} />
                          </div>
                        </div>

                        <div className="flex items-start justify-between gap-4">
                          <div className="text-xs text-muted-foreground">Order ID</div>
                          <div className="text-xs font-mono text-right break-all">{o.id}</div>
                        </div>

                        {o.createdAt ? (
                          <div className="flex items-start justify-between gap-4">
                            <div className="text-xs text-muted-foreground">Date</div>
                            <div className="text-xs text-right">{formatShortDate(o.createdAt)}</div>
                          </div>
                        ) : null}

                        {o.merchant?.name ? (
                          <div className="flex items-start justify-between gap-4">
                            <div className="text-xs text-muted-foreground">Merchant</div>
                            <div className="text-xs text-right">{o.merchant.name}</div>
                          </div>
                        ) : null}

                        <div className="flex items-start justify-between gap-4">
                          <div className="text-xs text-muted-foreground">Items</div>
                          <div className="text-right">
                            <OrderItemsSummary items={o.items} />
                          </div>
                        </div>
                      </div>

                      <div className="flex justify-end">
                        <Button
                          variant="outline"
                          className="w-full sm:w-auto"
                          disabled={o.status !== 'ON_DELIVERY' || working === o.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            confirmDelivered(o.id);
                          }}
                        >
                          {working === o.id ? 'Working…' : 'Confirm delivered'}
                        </Button>
                      </div>
                    </CardContent>
                  ) : null}
                </Card>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
