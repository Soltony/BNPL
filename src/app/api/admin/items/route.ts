import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { z } from 'zod';
import { getUserFromSession } from '@/lib/user';

const itemUpsertSchema = z.object({
  id: z.string().optional(),
  merchantId: z.string(),
  categoryId: z.string(),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  price: z.number().nonnegative(),
  currency: z.string().min(1).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  stockQuantity: z.number().int().nonnegative().nullable().optional(),
});

export async function GET(req: NextRequest) {
  try {
    const user = await getUserFromSession();
    if (!user?.id) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const merchantId = searchParams.get('merchantId');

    // If the caller is a merchant user, scope results to their merchant only
    const isMerchantUser = String(user.role || '').toLowerCase() === 'merchant';
    const scopedMerchantId = isMerchantUser ? user.merchantId : merchantId || undefined;

    const items = await prisma.item.findMany({
      where: scopedMerchantId ? { merchantId: scopedMerchantId } : undefined,
      include: { merchant: true, category: true },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json(items);
  } catch (err) {
    console.error('GET /api/admin/items error:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getUserFromSession();
    if (!user?.id) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const body = await req.json();
    const data = itemUpsertSchema.omit({ id: true }).parse(body);

    // If merchant user, force merchantId to their merchant to prevent escalation
    const isMerchantUser = String(user.role || '').toLowerCase() === 'merchant';
    const merchantIdToUse = isMerchantUser ? user.merchantId : data.merchantId;

    const created = await prisma.item.create({
      data: {
        merchantId: merchantIdToUse,
        categoryId: data.categoryId,
        name: data.name,
        description: data.description ?? undefined,
        price: data.price,
        currency: data.currency ?? 'ETB',
        status: data.status ?? 'ACTIVE',
        stockQuantity: data.stockQuantity ?? undefined,
      },
      include: { merchant: true, category: true },
    });

    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    const msg = err instanceof z.ZodError ? err.errors : (err as Error).message;
    console.error('POST /api/admin/items error:', err);
    return NextResponse.json({ error: msg || 'Internal Server Error' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const user = await getUserFromSession();
    if (!user?.id) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const body = await req.json();
    const data = itemUpsertSchema.parse(body);
    if (!data.id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

    // Prevent merchants from updating items that don't belong to them
    const isMerchantUser = String(user.role || '').toLowerCase() === 'merchant';
    if (isMerchantUser) {
      const existing = await prisma.item.findUnique({ where: { id: data.id } });
      if (!existing) return NextResponse.json({ error: 'Item not found' }, { status: 404 });
      if (existing.merchantId !== user.merchantId) return NextResponse.json({ error: 'Not authorized to modify this item' }, { status: 403 });
      // ensure merchantId cannot be changed
      data.merchantId = existing.merchantId;
    }

    const updated = await prisma.item.update({
      where: { id: data.id },
      data: {
        merchantId: data.merchantId,
        categoryId: data.categoryId,
        name: data.name,
        description: data.description ?? undefined,
        price: data.price,
        currency: data.currency ?? 'ETB',
        status: data.status,
        stockQuantity: data.stockQuantity ?? undefined,
      },
      include: { merchant: true, category: true },
    });

    return NextResponse.json(updated);
  } catch (err) {
    const msg = err instanceof z.ZodError ? err.errors : (err as Error).message;
    console.error('PUT /api/admin/items error:', err);
    return NextResponse.json({ error: msg || 'Internal Server Error' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = await getUserFromSession();
    if (!user?.id) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
    // Prevent merchant users from deleting items belonging to other merchants
    const isMerchantUser = String(user.role || '').toLowerCase() === 'merchant';
    if (isMerchantUser) {
      const existing = await prisma.item.findUnique({ where: { id } });
      if (!existing) return NextResponse.json({ error: 'Item not found' }, { status: 404 });
      if (existing.merchantId !== user.merchantId) return NextResponse.json({ error: 'Not authorized to delete this item' }, { status: 403 });
    }

    await prisma.item.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/admin/items error:', err);
    return NextResponse.json({ error: (err as Error).message || 'Internal Server Error' }, { status: 500 });
  }
}
