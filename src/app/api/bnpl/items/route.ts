import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export async function GET() {
  try {
    const items = await prisma.item.findMany({
      where: {
        status: 'ACTIVE',
        merchant: { status: 'ACTIVE' },
        category: { status: 'ACTIVE' },
      },
      include: {
        merchant: true,
        category: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json(items);
  } catch (err) {
    console.error('GET /api/bnpl/items error:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
