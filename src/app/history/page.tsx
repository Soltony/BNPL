
import type { LoanDetails, LoanProvider, Tax } from '@/lib/types';
import { Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import { HistoryClient } from '@/components/history/history-client';
import prisma from '@/lib/prisma';
import { calculateTotalRepayable } from '@/lib/loan-calculator';


const safeJsonParse = (jsonString: string | null | undefined, defaultValue: any) => {
    if (!jsonString) return defaultValue;
    try {
        return JSON.parse(jsonString);
    } catch (e) {
        return defaultValue;
    }
};

async function getProviders(): Promise<LoanProvider[]> {
    const providers = await prisma.loanProvider.findMany({
        orderBy: { displayOrder: 'asc' }
    });
    return providers as LoanProvider[];
}


async function getLoanHistory(borrowerId: string): Promise<LoanDetails[]> {
    try {
        if (!borrowerId) return [];

        const [loans, taxConfigs] = await Promise.all([
            prisma.loan.findMany({
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
            }),
            prisma.tax.findMany()
        ]);

        return loans.map(loan => {
            const parsedProduct = {
                ...loan.product,
                serviceFee: safeJsonParse(loan.product.serviceFee as string, { type: 'percentage', value: 0 }),
                dailyFee: safeJsonParse(loan.product.dailyFee as string, { type: 'percentage', value: 0, calculationBase: 'principal' }),
                penaltyRules: safeJsonParse(loan.product.penaltyRules as string, []),
            };

            const { total: totalRepayable } = calculateTotalRepayable(loan as any, parsedProduct, taxConfigs, new Date());

            return {
                id: loan.id,
                providerId: loan.product.providerId,
                providerName: loan.product.provider.name,
                productName: loan.product.name,
                loanAmount: loan.loanAmount,
                serviceFee: loan.serviceFee,
                disbursedDate: loan.disbursedDate,
                dueDate: loan.dueDate,
                repaymentStatus: loan.repaymentStatus as 'Paid' | 'Unpaid',
                repaidAmount: loan.repaidAmount || 0,
                penaltyAmount: loan.penaltyAmount,
                product: parsedProduct,
                totalRepayableAmount: totalRepayable,
                payments: loan.payments.map(p => ({
                    id: p.id,
                    amount: p.amount,
                    date: p.date,
                    outstandingBalanceBeforePayment: p.outstandingBalanceBeforePayment,
                }))
            } as LoanDetails;
        });
    } catch(e) {
        console.error(e);
        return [];
    }
}

async function getTaxConfigs(): Promise<Tax[]> {
    return await prisma.tax.findMany();
}


export default async function HistoryPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }>}) {
    const sp = await searchParams;
    const rawBorrowerId = sp?.borrowerId;
    const borrowerId = Array.isArray(rawBorrowerId) ? rawBorrowerId[0] : rawBorrowerId;

    const [loanHistory, providers, taxConfigs] = await Promise.all([
        getLoanHistory(borrowerId || ''),
        getProviders(),
        getTaxConfigs()
    ]);
    
    return (
        <Suspense fallback={
            <div className="flex flex-col min-h-screen bg-background items-center justify-center">
                <Loader2 className="h-12 w-12 animate-spin text-primary" />
            </div>
        }>
            <HistoryClient initialLoanHistory={loanHistory} providers={providers} taxConfigs={taxConfigs} />
        </Suspense>
    );
}
