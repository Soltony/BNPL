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

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {items.map((item) => {
          const href = borrowerId
            ? `/shop/${encodeURIComponent(item.id)}?borrowerId=${encodeURIComponent(borrowerId)}`
            : `/shop/${encodeURIComponent(item.id)}`;

          return (
            <Card key={item.id} className="overflow-hidden group">
               <div className="relative overflow-hidden">
                <Link href={href}>
                    <img 
                        src={item.imageUrl ?? `https://placehold.co/600x400/eee/ccc?text=${encodeURIComponent(item.name)}`} 
                        alt={item.name} 
                        className="w-full h-48 object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                </Link>
              </div>
              <CardHeader className="pt-4">
                <CardTitle className="text-base truncate">{item.name}</CardTitle>
                <CardDescription className="text-xs">
                  {item.merchant.name} • {item.category.name}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex items-center justify-between gap-4 pt-0">
                <div className="font-semibold text-sm">{formatCurrency(item.price)}</div>
                <Button asChild size="sm">
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
