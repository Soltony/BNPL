import Link from 'next/link';
import prisma from '@/lib/prisma';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Menu, User, Heart, ShoppingBasket, Search } from 'lucide-react';
import { Carousel, CarouselContent, CarouselItem } from '@/components/ui/carousel';

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

  const [items, merchants] = await Promise.all([
    prisma.item.findMany({
      where: {
        status: 'ACTIVE',
        merchant: { status: 'ACTIVE' },
        category: { status: 'ACTIVE' },
      },
      include: {
        merchant: true,
        category: true,
        discountRules: {
          where: {
            startDate: { lte: new Date() },
            endDate: { gte: new Date() },
          }
        }
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.merchant.findMany({
      where: {
        status: 'ACTIVE'
      },
      take: 10,
      orderBy: {
        name: 'asc'
      }
    })
  ]);

  return (
    <div className="bg-background min-h-screen">
      {/* Header */}
      <header className="bg-primary text-primary-foreground p-4" style={{ 
          backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'40\' height=\'69.28\' viewBox=\'0 0 40 69.28\'%3E%3Cpolygon points=\'20,0 40,17.32 40,51.96 20,69.28 0,51.96 0,17.32\' style=\'fill:none;stroke:rgba(255,255,255,0.1);stroke-width:1\' /%3E%3C/svg%3E")',
          backgroundRepeat: 'repeat'
        }}>
        <div className="container mx-auto">
          <div className="flex justify-between items-center mb-4">
            <h1 className="text-2xl font-bold">Nib'era Gebeya</h1>
            <div className="relative flex-1 max-w-lg">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
              <Input
                placeholder="What are you looking for..."
                className="pl-10 bg-white text-black"
              />
            </div>
          </div>
          <div className="flex justify-between items-center text-sm">
            <Button variant="ghost" className="text-white hover:bg-white/20">
              <Menu className="mr-2 h-5 w-5" />
              Menu
            </Button>
            <div className="flex items-center space-x-4">
              <Button variant="ghost" className="text-white hover:bg-white/20">
                <User className="mr-1 h-5 w-5" />
                Log in
              </Button>
              <Button variant="ghost" className="text-white hover:bg-white/20">
                <Heart className="mr-1 h-5 w-5" />
                Wishlist
              </Button>
              <Button variant="ghost" className="text-white hover:bg-white/20">
                <ShoppingBasket className="mr-1 h-5 w-5" />
                Basket
              </Button>
            </div>
          </div>
        </div>
      </header>
      
      <main className="container mx-auto py-8 space-y-12">
        {/* Top Merchants */}
        <section>
          <h2 className="text-2xl font-bold mb-4 text-center">Top Merchants</h2>
           <Carousel
            opts={{
              align: "start",
              loop: true,
            }}
            className="w-full"
          >
            <CarouselContent>
              {merchants.map((merchant, index) => (
                <CarouselItem key={index} className="md:basis-1/3 lg:basis-1/4">
                  <div className="p-1">
                    <Card className="overflow-hidden">
                      <CardContent className="flex flex-col items-center justify-center p-6 space-y-2">
                        <div className="h-32 w-32 flex items-center justify-center bg-muted rounded-lg">
                           <p className="font-bold text-lg text-center p-2">{merchant.name}</p>
                        </div>
                        <p className="text-sm font-medium">{merchant.name}</p>
                      </CardContent>
                    </Card>
                  </div>
                </CarouselItem>
              ))}
            </CarouselContent>
          </Carousel>
        </section>

        {/* Latest Products */}
        <section>
          <h2 className="text-2xl font-bold mb-4 text-center">Latest Products</h2>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {items.map((item) => {
              const href = borrowerId
                ? `/shop/${encodeURIComponent(item.id)}?borrowerId=${encodeURIComponent(borrowerId)}`
                : `/shop/${encodeURIComponent(item.id)}`;
              
              const discount = item.discountRules?.[0];

              return (
                <Card key={item.id} className="overflow-hidden group flex flex-col">
                   <div className="relative overflow-hidden">
                    <Link href={href}>
                        <img 
                            src={item.imageUrl ?? `https://placehold.co/600x400/eee/ccc?text=${encodeURIComponent(item.name)}`} 
                            alt={item.name} 
                            className="w-full h-48 object-cover group-hover:scale-105 transition-transform duration-300"
                        />
                    </Link>
                    {discount && (
                       <div className="absolute top-2 left-2 flex gap-1">
                        {discount.type === 'percentage' && <Badge className="bg-red-500 text-white">-{discount.value}%</Badge>}
                        <Badge variant="secondary">Discount</Badge>
                       </div>
                    )}
                  </div>
                  <CardHeader className="pt-4 pb-2">
                    <CardTitle className="text-base truncate">{item.name}</CardTitle>
                  </CardHeader>
                  <CardContent className="flex-grow flex flex-col justify-end">
                    <div className="flex items-center justify-between gap-4 mt-auto">
                      <div className="font-semibold text-sm">{formatCurrency(item.price)}</div>
                      <Button asChild size="sm" style={{backgroundColor: '#FDB913', color: 'black'}}>
                        <Link href={href}>Select</Link>
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
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
