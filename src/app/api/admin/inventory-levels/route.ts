import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { z } from 'zod';
import { getUserFromSession } from '@/lib/user';

const inventoryUpsertSchema = z.object({
  id: z.string().optional(),
  itemId: z.string(),
  locationId: z.string(),
  quantityAvailable: z.number().int().nonnegative(),
  reservedQuantity: z.number().int().nonnegative().optional(),
  lowStockThreshold: z.number().int().nonnegative().nullable().optional(),
});

export async function GET(req: NextRequest) {
  try {
    const user = await getUserFromSession();
    if (!user?.id) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const locationId = searchParams.get('locationId');
    const itemId = searchParams.get('itemId');

    const isMerchantUser = String(user.role || '').toLowerCase() === 'merchant';
    const merchantId = isMerchantUser ? user.merchantId : undefined;
    if (isMerchantUser && !merchantId) return NextResponse.json({ error: 'Merchant not set on user' }, { status: 403 });

    const rows = await prisma.inventoryLevel.findMany({
      where: {
        locationId: locationId || undefined,
        itemId: itemId || undefined,
        item: merchantId ? { merchantId } : undefined,
      },
      include: {
        location: true,
        item: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json(rows);
  } catch (err) {
    console.error('GET /api/admin/inventory-levels error:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getUserFromSession();
    if (!user?.id) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const body = await req.json();
    const data = inventoryUpsertSchema.omit({ id: true }).parse(body);

    const isMerchantUser = String(user.role || '').toLowerCase() === 'merchant';
    if (isMerchantUser) {
      const item = await prisma.item.findUnique({ where: { id: data.itemId }, select: { merchantId: true } });
      if (!item) return NextResponse.json({ error: 'Item not found' }, { status: 404 });
      if (item.merchantId !== user.merchantId) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }

    const created = await prisma.inventoryLevel.create({
      data: {
        itemId: data.itemId,
        locationId: data.locationId,
        quantityAvailable: data.quantityAvailable,
        reservedQuantity: data.reservedQuantity ?? 0,
        lowStockThreshold: data.lowStockThreshold ?? undefined,
      },
      include: {
        location: true,
        item: true,
      },
    });

    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    const msg = err instanceof z.ZodError ? err.errors : (err as Error).message;
    console.error('POST /api/admin/inventory-levels error:', err);
    return NextResponse.json({ error: msg || 'Internal Server Error' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const user = await getUserFromSession();
    if (!user?.id) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const body = await req.json();
    const data = inventoryUpsertSchema.parse(body);
    if (!data.id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

    const isMerchantUser = String(user.role || '').toLowerCase() === 'merchant';
    if (isMerchantUser) {
      const existing = await prisma.inventoryLevel.findUnique({
        where: { id: data.id },
        select: { item: { select: { merchantId: true } } },
      });
      if (!existing) return NextResponse.json({ error: 'Inventory level not found' }, { status: 404 });
      if (existing.item.merchantId !== user.merchantId) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }

    const updated = await prisma.inventoryLevel.update({
      where: { id: data.id },
      data: {
        itemId: data.itemId,
        locationId: data.locationId,
        quantityAvailable: data.quantityAvailable,
        reservedQuantity: data.reservedQuantity ?? 0,
        lowStockThreshold: data.lowStockThreshold ?? null,
      },
      include: {
        location: true,
        item: true,
      },
    });

    return NextResponse.json(updated);
  } catch (err) {
    const msg = err instanceof z.ZodError ? err.errors : (err as Error).message;
    console.error('PUT /api/admin/inventory-levels error:', err);
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

    const isMerchantUser = String(user.role || '').toLowerCase() === 'merchant';
    if (isMerchantUser) {
      const existing = await prisma.inventoryLevel.findUnique({
        where: { id },
        select: { item: { select: { merchantId: true } } },
      });
      if (!existing) return NextResponse.json({ error: 'Inventory level not found' }, { status: 404 });
      if (existing.item.merchantId !== user.merchantId) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }

    await prisma.inventoryLevel.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/admin/inventory-levels error:', err);
    return NextResponse.json({ error: (err as Error).message || 'Internal Server Error' }, { status: 500 });
  }
}
