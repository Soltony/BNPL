import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { z } from 'zod';
import { getUserFromSession } from '@/lib/user';

const categoryUpsertSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
});

export async function GET() {
  try {
    const user = await getUserFromSession();
    if (!user?.id) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const categories = await prisma.productCategory.findMany({
      orderBy: { name: 'asc' },
    });

    return NextResponse.json(categories);
  } catch (err) {
    console.error('GET /api/admin/product-categories error:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getUserFromSession();
    if (!user?.id) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const body = await req.json();
    const data = categoryUpsertSchema.omit({ id: true }).parse(body);

    const created = await prisma.productCategory.create({
      data: {
        name: data.name,
        status: data.status ?? 'ACTIVE',
      },
    });

    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    const msg = err instanceof z.ZodError ? err.errors : (err as Error).message;
    console.error('POST /api/admin/product-categories error:', err);
    return NextResponse.json({ error: msg || 'Internal Server Error' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const user = await getUserFromSession();
    if (!user?.id) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const body = await req.json();
    const data = categoryUpsertSchema.parse(body);
    if (!data.id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

    const updated = await prisma.productCategory.update({
      where: { id: data.id },
      data: {
        name: data.name,
        status: data.status,
      },
    });

    return NextResponse.json(updated);
  } catch (err) {
    const msg = err instanceof z.ZodError ? err.errors : (err as Error).message;
    console.error('PUT /api/admin/product-categories error:', err);
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

    await prisma.productCategory.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/admin/product-categories error:', err);
    return NextResponse.json({ error: (err as Error).message || 'Internal Server Error' }, { status: 500 });
  }
}
