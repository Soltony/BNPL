import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const borrowerId = searchParams.get('borrowerId');

    if (!borrowerId) {
      return NextResponse.json({ error: 'borrowerId is required' }, { status: 400 });
    }

    const orders = await prisma.order.findMany({
      where: { borrowerId },
      include: {
        merchant: true,
        items: { include: { item: { include: { category: true } } } },
        loanApplication: { include: { product: { include: { provider: true } } } },
        loan: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json(orders);
  } catch (err) {
    console.error('GET /api/bnpl/orders error:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
