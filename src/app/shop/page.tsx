import Link from 'next/link';
import prisma from '@/lib/prisma';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount) + ' ETB';

export default async function ShopPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  const rawBorrowerId = sp?.borrowerId;
  const borrowerId = Array.isArray(rawBorrowerId) ? rawBorrowerId[0] : rawBorrowerId;

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

  return (
    <div className="container py-8 md:py-12 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Shop</h1>
        <p className="text-muted-foreground">Select an item, then choose a loan product to pay later.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => {
          const href = borrowerId
            ? `/shop/${encodeURIComponent(item.id)}?borrowerId=${encodeURIComponent(borrowerId)}`
            : `/shop/${encodeURIComponent(item.id)}`;

          return (
            <Card key={item.id}>
              <CardHeader>
                <CardTitle className="text-base">{item.name}</CardTitle>
                <CardDescription>
                  {item.merchant.name} • {item.category.name}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  {item.imageUrl ? (
                    <img src={item.imageUrl} alt={item.name} className="w-20 h-20 object-cover rounded" />
                  ) : (
                    <div className="w-20 h-20 bg-muted rounded" />
                  )}
                  <div>
                    <div className="font-medium">{formatCurrency(item.price)}</div>
                    {item.videoUrl ? (
                      <div className="text-sm mt-1">
                        <a href={item.videoUrl} target="_blank" rel="noopener noreferrer" className="text-primary underline">Watch video</a>
                      </div>
                    ) : null}
                  </div>
                </div>
                <Button asChild>
                  <Link href={href}>Select</Link>
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {items.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No items yet</CardTitle>
            <CardDescription>Ask a merchant to create items in Admin → Merchants.</CardDescription>
          </CardHeader>
        </Card>
      ) : null}
    </div>
  );
}
