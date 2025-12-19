import prisma from '@/lib/prisma';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ShopItemDetailClient } from '@/components/shop/shop-item-detail-client';

export default async function ItemDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const p = await params;
  const id = p.id;
  const sp = await searchParams;
  const rawBorrowerId = sp?.borrowerId;
  const borrowerId = Array.isArray(rawBorrowerId) ? rawBorrowerId[0] : rawBorrowerId;

  const item = await prisma.item.findUnique({
    where: { id },
    include: {
      merchant: true,
      category: true,
      optionGroups: { include: { values: true } },
    },
  });

  if (!item) {
    return (
      <div className="container py-8">
        <Card>
          <CardHeader>
            <CardTitle>Item not found</CardTitle>
            <CardDescription>Please return to the shop.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="container py-8 md:py-12">
      <ShopItemDetailClient
        borrowerId={borrowerId}
        item={{
          id: item.id,
          name: item.name,
          imageUrl: item.imageUrl ?? null,
          videoUrl: item.videoUrl ?? null,
          price: item.price,
          merchantName: item.merchant?.name ?? '',
          categoryName: item.category?.name ?? '',
          optionGroups: (item.optionGroups || []).map((g: any) => ({
            id: g.id,
            name: g.name,
            isRequired: g.isRequired,
            values: (g.values || [])
              .filter((v: any) => (v.status || 'ACTIVE') === 'ACTIVE')
              .map((v: any) => ({
                id: v.id,
                label: v.label,
                priceDelta: v.priceDelta ?? 0,
                status: v.status,
              })),
          })),
        }}
      />
    </div>
  );
}
