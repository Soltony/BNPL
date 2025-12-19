
import Link from 'next/link';
import { DashboardClient } from '@/components/dashboard/dashboard-client';
import type { LoanDetails, LoanProvider, FeeRule, PenaltyRule, Tax } from '@/lib/types';
import { Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import prisma from '@/lib/prisma';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

// Helper function to safely parse JSON from DB
const safeJsonParse = (jsonString: string | null | undefined, defaultValue: any) => {
    if (!jsonString) return defaultValue;
    try {
        return JSON.parse(jsonString);
    } catch (e) {
        return defaultValue;
    }
};

async function getProviders(): Promise<LoanProvider[]> {
    try {
        const providers = await prisma.loanProvider.findMany({
            include: {
                products: {
                    where: {
                        status: 'Active'
                    },
                    orderBy: {
                        name: 'asc'
                    }
                }
            },
            orderBy: {
                displayOrder: 'asc'
            }
        });

        return providers.map(p => ({
            id: p.id,
            name: p.name,
            icon: p.icon,
            colorHex: p.colorHex,
            displayOrder: p.displayOrder,
            accountNumber: p.accountNumber,
            startingCapital: p.startingCapital,
            initialBalance: p.initialBalance,
            allowCrossProviderLoans: p.allowCrossProviderLoans,
            products: p.products.map(prod => ({
                id: prod.id,
                providerId: p.id,
                name: prod.name,
                description: prod.description,
                icon: prod.icon,
                minLoan: prod.minLoan,
                maxLoan: prod.maxLoan,
                duration: prod.duration,
                serviceFee: safeJsonParse(prod.serviceFee, { type: 'percentage', value: 0 }) as FeeRule,
                dailyFee: safeJsonParse(prod.dailyFee, { type: 'percentage', value: 0 }) as FeeRule,
                penaltyRules: safeJsonParse(prod.penaltyRules, []) as PenaltyRule[],
                requiredDocuments: safeJsonParse(prod.requiredDocuments, []) as string[],
                status: prod.status as 'Active' | 'Disabled',
                allowConcurrentLoans: prod.allowConcurrentLoans,
            }))
        })) as LoanProvider[];
    } catch(e) {
        console.error(e);
        return [];
    }
}

async function getLoanHistory(borrowerId: string): Promise<LoanDetails[]> {
    try {
        if (!borrowerId) return [];

        const loans = await prisma.loan.findMany({
            where: { borrowerId },
            include: {
                product: {
                    include: {
                        provider: true
                    }
                },
                payments: {
                    orderBy: {
                        date: 'asc'
                    }
                }
            },
            orderBy: {
                disbursedDate: 'desc'
            }
        });

        return loans.map(loan => ({
            id: loan.id,
            borrowerId: loan.borrowerId,
            providerName: loan.product.provider.name,
            productName: loan.product.name,
            loanAmount: loan.loanAmount,
            serviceFee: loan.serviceFee,
            disbursedDate: loan.disbursedDate,
            dueDate: loan.dueDate,
            repaymentStatus: loan.repaymentStatus as 'Paid' | 'Unpaid',
            repaidAmount: loan.repaidAmount || 0,
            penaltyAmount: loan.penaltyAmount,
            product: {
              ...loan.product,
              id: loan.product.id,
              providerId: loan.product.providerId,
              serviceFee: safeJsonParse(loan.product.serviceFee, { type: 'percentage', value: 0 }),
              dailyFee: safeJsonParse(loan.product.dailyFee, { type: 'percentage', value: 0, calculationBase: 'principal' }),
              penaltyRules: safeJsonParse(loan.product.penaltyRules, []),
              requiredDocuments: safeJsonParse(loan.product.requiredDocuments, []) as string[],
            },
            payments: loan.payments.map(p => ({
                id: p.id,
                amount: p.amount,
                date: p.date,
                outstandingBalanceBeforePayment: p.outstandingBalanceBeforePayment,
            }))
        })) as LoanDetails[];
    } catch(e) {
        console.error(e);
        return [];
    }
}

async function getTaxConfigs(): Promise<Tax[]> {
    return await prisma.tax.findMany();
}

async function getSelectedItem(itemId?: string, qty?: number) {
    if (!itemId) return null;
    const item = await prisma.item.findUnique({
        where: { id: itemId },
        include: {
            merchant: true,
            category: true,
            optionGroups: {
                where: { status: 'ACTIVE' },
                include: {
                    values: {
                        where: { status: 'ACTIVE' },
                        orderBy: { createdAt: 'asc' },
                    },
                },
                orderBy: { createdAt: 'asc' },
            },
        },
    });
    if (!item || item.status !== 'ACTIVE') return null;
    const quantity = qty && qty > 0 ? qty : 1;

    const optionGroups = (item.optionGroups ?? []).map((g) => ({
        id: g.id,
        name: g.name,
        isRequired: g.isRequired,
        values: (g.values ?? []).map((v) => ({
            id: v.id,
            label: v.label,
            priceDelta: v.priceDelta,
            status: v.status,
        })),
    }));

    return {
        id: item.id,
        name: item.name,
        price: item.price,
        merchantName: item.merchant.name,
        categoryName: item.category.name,
        quantity,
        totalAmount: item.price * quantity,
        optionGroups,
    };
}

const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount) + ' ETB';


export default async function LoanPage({ searchParams }: { searchParams: any }) {
    const params = await searchParams;
    const borrowerId = params?.borrowerId as string;
    const itemId = params?.itemId as string | undefined;
    const qty = params?.qty ? Number(params.qty) : undefined;
    const optionValueIdsParam = params?.optionValueIds as string | undefined;
    const selectedOptionValueIds = optionValueIdsParam
        ? optionValueIdsParam.split(',').map((s) => s.trim()).filter(Boolean)
        : [];

    // Borrower must pick an item before we show loan products (DashboardClient).
    if (!itemId) {
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
                            ? `/loan?borrowerId=${encodeURIComponent(borrowerId)}&itemId=${encodeURIComponent(item.id)}&qty=1`
                            : `/loan?itemId=${encodeURIComponent(item.id)}&qty=1`;

                        return (
                            <Card key={item.id}>
                                <CardHeader>
                                    <CardTitle className="text-base">{item.name}</CardTitle>
                                    <CardDescription>
                                        {item.merchant.name} • {item.category.name}
                                    </CardDescription>
                                </CardHeader>
                                <CardContent className="flex items-center justify-between gap-4">
                                    <div className="font-medium">{formatCurrency(item.price)}</div>
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
    
    const [providers, loanHistory, taxConfigs, selectedItem] = await Promise.all([
        getProviders(),
        getLoanHistory(borrowerId),
        getTaxConfigs(),
        getSelectedItem(itemId, qty),
    ]);

    const selectedItemWithOptions = selectedItem
        ? {
            ...selectedItem,
            selectedOptionValueIds,
        }
        : selectedItem;
    
    return (
        <Suspense fallback={
            <div className="flex flex-col min-h-screen bg-background items-center justify-center">
                <Loader2 className="h-12 w-12 animate-spin text-primary" />
            </div>
        }>
            <DashboardClient providers={providers} initialLoanHistory={loanHistory} taxConfigs={taxConfigs} selectedItem={selectedItemWithOptions} />
        </Suspense>
    );
}
