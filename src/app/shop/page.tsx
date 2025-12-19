import Link from 'next/link';
import prisma from '@/lib/prisma';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Play, ShoppingCart } from 'lucide-react';
import ShopSearchClient from '@/components/shop/shop-search-client';
import ShopHeaderSearchClient from '@/components/shop/shop-header-search-client';

const formatAmount = (amount: number) =>
  new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);

const CURRENCY = 'ETB';

export default async function ShopPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  const rawBorrowerId = sp?.borrowerId;
  const borrowerId = Array.isArray(rawBorrowerId) ? rawBorrowerId[0] : rawBorrowerId;
  const rawQuery = sp?.q;
  const query = Array.isArray(rawQuery) ? rawQuery[0] : rawQuery;
  const rawCategoryId = sp?.categoryId;
  const categoryId = Array.isArray(rawCategoryId) ? rawCategoryId[0] : rawCategoryId;

  const ordersHref = borrowerId
    ? `/bnpl/orders?borrowerId=${encodeURIComponent(borrowerId)}`
    : '/bnpl/orders';

  const categories = await prisma.productCategory.findMany({ where: { status: 'ACTIVE' }, orderBy: { name: 'asc' } });

  const items = await prisma.item.findMany({
    where: {
      status: 'ACTIVE',
      merchant: { status: 'ACTIVE' },
      category: { status: 'ACTIVE', ...(categoryId ? { id: categoryId } : {}) },
      ...(query
        ? {
            OR: [
              { name: { contains: query } },
              { merchant: { name: { contains: query } } },
              { category: { name: { contains: query } } },
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
  });
  // Serialize minimal fields for client hydration
  const serializedItems = items.map((item) => {
    const discount = item.discountRules?.[0];
    return {
      id: item.id,
      name: item.name,
      imageUrl: item.imageUrl,
      videoUrl: item.videoUrl,
      price: item.price,
      merchantName: item.merchant?.name ?? null,
      categoryName: item.category?.name ?? null,
      discount: discount ? { type: discount.type, value: String(discount.value) } : null,
    };
  });

  // `ShopSearchClient` is a client component imported above and will be rendered from this server page.

  return (
    <div className="bg-background min-h-screen">
      {/* Header */}
      <header className="bg-primary text-primary-foreground p-4" style={{ 
          backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'40\' height=\'69.28\' viewBox=\'0 0 40 69.28\'%3E%3Cpolygon points=\'20,0 40,17.32 40,51.96 20,69.28 0,51.96 0,17.32\' style=\'fill:none;stroke:rgba(255,255,255,0.1);stroke-width:1\' /%3E%3C/svg%3E")',
          backgroundRepeat: 'repeat'
        }}>
        <div className="container mx-auto">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center justify-between sm:justify-start gap-3">
              <h1 className="text-2xl font-bold">Shop</h1>
              <Button asChild variant="ghost" size="sm" className="h-10 px-0">
                <Link href={ordersHref} className="inline-flex items-center gap-2 px-3 py-2 text-primary-foreground hover:bg-primary/20 rounded-md">
                  <ShoppingCart className="h-4 w-4" />
                  <span>Orders</span>
                </Link>
              </Button>
            </div>

            <div className="w-full sm:max-w-2xl">
              <ShopHeaderSearchClient
                initialQ={query ?? ''}
                initialCategoryId={categoryId ?? ''}
                categories={categories.map((c) => ({ id: c.id, name: c.name }))}
                borrowerId={borrowerId}
              />
            </div>
          </div>
        </div>
      </header>
      
      <main className="container mx-auto py-8 px-4 sm:px-6 lg:px-8 space-y-12">
        {/* Top Merchants removed */}

        {/* Latest Products */}
        <section>
          <h2 className="text-2xl font-bold mb-4 text-center">Latest Products</h2>
          <ShopSearchClient
            initialItems={serializedItems}
            categories={categories.map((c) => ({ id: c.id, name: c.name }))}
            borrowerId={borrowerId}
            hideControls
            initialQ={query ?? ''}
            initialCategoryId={categoryId ?? ''}
          />
          {items.length === 0 && (
            <Card>
              <CardHeader>
                <CardTitle>No items yet</CardTitle>
                <CardDescription>Ask a merchant to create items in Admin → Merchants.</CardDescription>
              </CardHeader>
            </Card>
          )}
        </section>
      </main>
    </div>
  );
}
