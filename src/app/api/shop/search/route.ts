import prisma from '@/lib/prisma';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = url.searchParams.get('q') || undefined;
  const categoryId = url.searchParams.get('categoryId') || undefined;

  const items = await prisma.item.findMany({
    where: {
      status: 'ACTIVE',
      merchant: { status: 'ACTIVE' },
      category: { status: 'ACTIVE', ...(categoryId ? { id: categoryId } : {}) },
      ...(q
        ? {
            OR: [
              { name: { contains: q } },
              { merchant: { name: { contains: q } } },
              { category: { name: { contains: q } } },
            ],
          }
        : {}),
    },
    include: {
      merchant: true,
      category: true,
      discountRules: {
        where: {
          startDate: { lte: new Date() },
          endDate: { gte: new Date() },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  // Serialize minimal fields for the client
  const result = items.map((item) => {
    const discount = item.discountRules?.[0];
    return {
      id: item.id,
      name: item.name,
      imageUrl: item.imageUrl,
      videoUrl: item.videoUrl,
      price: item.price,
      merchantName: item.merchant?.name ?? null,
      categoryName: item.category?.name ?? null,
      discount: discount
        ? { type: discount.type, value: String(discount.value) }
        : null,
    };
  });

  return NextResponse.json(result);
}
