import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { z } from 'zod';
import { getUserFromSession } from '@/lib/user';

const discountRuleUpsertSchema = z.object({
  id: z.string().optional(),
  type: z.enum(['percentage', 'fixed', 'buy-X-get-Y']),
  value: z.number(),
  startDate: z.string().datetime().nullable().optional(),
  endDate: z.string().datetime().nullable().optional(),
  itemId: z.string().nullable().optional(),
  categoryId: z.string().nullable().optional(),
  minimumQuantity: z.number().int().positive().nullable().optional(),
});

export async function GET() {
  try {
    const user = await getUserFromSession();
    if (!user?.id) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const rules = await prisma.discountRule.findMany({
      include: {
        item: true,
        category: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json(rules);
  } catch (err) {
    console.error('GET /api/admin/discount-rules error:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getUserFromSession();
    if (!user?.id) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const body = await req.json();
    const data = discountRuleUpsertSchema.omit({ id: true }).parse(body);

    const created = await prisma.discountRule.create({
      data: {
        type: data.type,
        value: data.value,
        startDate: data.startDate ? new Date(data.startDate) : undefined,
        endDate: data.endDate ? new Date(data.endDate) : undefined,
        itemId: data.itemId ?? undefined,
        categoryId: data.categoryId ?? undefined,
        minimumQuantity: data.minimumQuantity ?? undefined,
      },
      include: { item: true, category: true },
    });

    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    const msg = err instanceof z.ZodError ? err.errors : (err as Error).message;
    console.error('POST /api/admin/discount-rules error:', err);
    return NextResponse.json({ error: msg || 'Internal Server Error' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const user = await getUserFromSession();
    if (!user?.id) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const body = await req.json();
    const data = discountRuleUpsertSchema.parse(body);
    if (!data.id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

    const updated = await prisma.discountRule.update({
      where: { id: data.id },
      data: {
        type: data.type,
        value: data.value,
        startDate: data.startDate ? new Date(data.startDate) : null,
        endDate: data.endDate ? new Date(data.endDate) : null,
        itemId: data.itemId ?? null,
        categoryId: data.categoryId ?? null,
        minimumQuantity: data.minimumQuantity ?? null,
      },
      include: { item: true, category: true },
    });

    return NextResponse.json(updated);
  } catch (err) {
    const msg = err instanceof z.ZodError ? err.errors : (err as Error).message;
    console.error('PUT /api/admin/discount-rules error:', err);
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

    await prisma.discountRule.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/admin/discount-rules error:', err);
    return NextResponse.json({ error: (err as Error).message || 'Internal Server Error' }, { status: 500 });
  }
}
