import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { z } from 'zod';
import { getUserFromSession } from '@/lib/user';

const updateOrderSchema = z.object({
  id: z.string(),
  status: z.enum(['PENDING_MERCHANT_CONFIRMATION', 'ON_DELIVERY', 'DELIVERED', 'CANCELLED']),
});

export async function GET(req: NextRequest) {
  try {
    const user = await getUserFromSession();
    if (!user?.id) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const merchantId = searchParams.get('merchantId');

    // Scope orders for merchant users to their merchant only
    const isMerchantUser = String(user.role || '').toLowerCase() === 'merchant';
    const scopedMerchantId = isMerchantUser ? user.merchantId : merchantId || undefined;

    const orders = await prisma.order.findMany({
      where: scopedMerchantId ? { merchantId: scopedMerchantId } : undefined,
      include: {
        merchant: true,
        borrower: true,
        items: { include: { item: { include: { category: true } } } },
        loanApplication: { include: { product: { include: { provider: true } } } },
        loan: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json(orders);
  } catch (err) {
    console.error('GET /api/admin/orders error:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const user = await getUserFromSession();
    if (!user?.id) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const body = await req.json();
    const data = updateOrderSchema.parse(body);

    const order = await prisma.order.findUnique({ where: { id: data.id } });
    if (!order) return NextResponse.json({ error: 'Order not found.' }, { status: 404 });

    // Prevent merchant users from modifying orders that don't belong to their merchant
    const isMerchantUser = String(user.role || '').toLowerCase() === 'merchant';
    if (isMerchantUser && order.merchantId !== user.merchantId) {
      return NextResponse.json({ error: 'Not authorized to modify this order.' }, { status: 403 });
    }

    // Minimal state machine enforcement for merchant updates
    if (data.status === 'ON_DELIVERY' && order.status !== 'PENDING_MERCHANT_CONFIRMATION') {
      return NextResponse.json({ error: 'Order must be pending merchant confirmation first.' }, { status: 400 });
    }

    const updated = await prisma.order.update({
      where: { id: data.id },
      data: { status: data.status },
      include: {
        merchant: true,
        borrower: true,
        items: { include: { item: { include: { category: true } } } },
      },
    });

    return NextResponse.json(updated);
  } catch (err) {
    const msg = err instanceof z.ZodError ? err.errors : (err as Error).message;
    console.error('PUT /api/admin/orders error:', err);
    return NextResponse.json({ error: msg || 'Internal Server Error' }, { status: 500 });
  }
}
