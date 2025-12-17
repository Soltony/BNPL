
import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfYear, endOfYear, differenceInDays, isValid } from 'date-fns';
import { calculateTotalRepayable } from '@/lib/loan-calculator';
import type { Loan, LoanProduct, Payment, ProvisionedData } from '@prisma/client';
import { getUserFromSession } from '@/lib/user';

const getDates = (timeframe: string, from?: string, to?: string) => {
    if (from && to) {
        const fromDate = new Date(from);
        const toDate = new Date(to);
        if(isValid(fromDate) && isValid(toDate)) {
            return { gte: startOfDay(fromDate), lte: endOfDay(toDate) };
        }
    }
    const now = new Date();
    switch (timeframe) {
        case 'daily':
            return { gte: startOfDay(now), lte: endOfDay(now) };
        case 'weekly':
            return { gte: startOfWeek(now, { weekStartsOn: 1 }), lte: endOfWeek(now, { weekStartsOn: 1 }) };
        case 'monthly':
            return { gte: startOfMonth(now), lte: endOfMonth(now) };
        case 'quarterly': {
            const qStartMonth = Math.floor(now.getMonth() / 3) * 3;
            const qStart = startOfMonth(new Date(now.getFullYear(), qStartMonth, 1));
            const qEnd = endOfMonth(new Date(now.getFullYear(), qStartMonth + 2, 1));
            return { gte: qStart, lte: qEnd };
        }
        case 'semiAnnually': {
            const year = now.getFullYear();
            if (now.getMonth() < 6) {
                const s = startOfMonth(new Date(year, 0, 1));
                const e = endOfMonth(new Date(year, 5, 1));
                return { gte: s, lte: e };
            } else {
                const s = startOfMonth(new Date(year, 6, 1));
                const e = endOfMonth(new Date(year, 11, 1));
                return { gte: s, lte: e };
            }
        }
        case 'annually':
        case 'yearly':
            return { gte: startOfYear(now), lte: endOfYear(now) };
        case 'overall':
        default:
            return { gte: undefined, lte: undefined };
    }
};

type LoanWithRelations = Loan & {
    product: LoanProduct & { provider: { name: string } };
    payments: Payment[];
    borrower: {
        id: string;
        provisionedData: ProvisionedData[];
     };
};

const getBorrowerName = (borrower: { provisionedData: ProvisionedData[] }): string => {
    if (!borrower || !borrower.provisionedData || borrower.provisionedData.length === 0) {
        return 'N/A';
    }
    // Find the latest provisioned data that might have a name
    for (const entry of borrower.provisionedData) {
         try {
            const data = JSON.parse(entry.data as string);
            const fullNameKey = Object.keys(data).find(k => k.toLowerCase() === 'fullname' || k.toLowerCase() === 'full name' || k.toLowerCase() === 'customername');
            if (fullNameKey && data[fullNameKey]) {
                return data[fullNameKey];
            }
        } catch (e) {
            // Ignore parsing errors
        }
    }
    return 'N/A';
};


export async function GET(req: NextRequest) {
    const user = await getUserFromSession();
    if (!user || !user.permissions?.['reports']?.read) {
        return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    let providerId = searchParams.get('providerId');
    const timeframe = searchParams.get('timeframe') || 'overall';
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const dateRange = getDates(timeframe, from ?? undefined, to ?? undefined);

    const whereClause: any = {};

    if (dateRange.gte && dateRange.lte) {
        whereClause.disbursedDate = {
            gte: dateRange.gte,
            lte: dateRange.lte,
        };
    }
    
    const isSuperAdminOrRecon = user.role === 'Super Admin' || user.role === 'Reconciliation';

    if (!isSuperAdminOrRecon) {
        providerId = user.loanProviderId || 'none';
    }
    
    if (providerId && providerId !== 'all' && providerId !== 'none') {
        whereClause.product = { providerId };
    }

    if (providerId === 'none') {
        return NextResponse.json([]);
    }

    try {
        const [loans, taxConfigs] = await Promise.all([
            prisma.loan.findMany({
                where: whereClause,
                include: {
                    product: {
                        include: {
                            provider: true,
                        },
                    },
                    payments: true,
                    borrower: {
                       include: {
                            // Include all provisioned data and sort by latest, we'll find the name in code.
                            provisionedData: {
                                orderBy: {
                                    createdAt: 'desc'
                                }
                            }
                        }
                    }
                },
                orderBy: {
                    disbursedDate: 'desc',
                },
            }),
            prisma.tax.findMany()
        ]);
        
        const today = new Date();
        const reportData = loans.map(loan => {
            const { total, principal, interest, penalty, serviceFee } = calculateTotalRepayable(loan as any, loan.product, taxConfigs, today);
            
            const totalRepaid = (loan.repaidAmount || 0);

            // Correct calculation for outstanding amounts
            const penaltyPaid = Math.min(totalRepaid, penalty);
            const penaltyOutstanding = penalty - penaltyPaid;

            const serviceFeePaid = Math.min(Math.max(0, totalRepaid - penalty), serviceFee);
            const serviceFeeOutstanding = serviceFee - serviceFeePaid;
            
            const interestPaid = Math.min(Math.max(0, totalRepaid - penalty - serviceFee), interest);
            const interestOutstanding = interest - interestPaid;

            const principalPaid = Math.max(0, totalRepaid - penalty - serviceFee - interest);
            const principalOutstanding = principal - principalPaid;

            const totalOutstanding = Math.max(0, total - totalRepaid);


            let status = 'Current';
            const daysInArrears = differenceInDays(today, loan.dueDate);
            if (loan.repaymentStatus === 'Unpaid' && daysInArrears > 0) {
                status = 'Overdue';
                if (daysInArrears > 60) { // Example for NPL/Defaulted
                    status = 'Defaulted';
                }
            } else if (loan.repaymentStatus === 'Paid') {
                status = 'Paid';
            }
            
            const borrowerName = getBorrowerName(loan.borrower);
            
            return {
                provider: loan.product.provider.name,
                loanId: loan.id,
                borrowerId: loan.borrowerId,
                borrowerName: borrowerName !== 'N/A' ? borrowerName : `B-${loan.borrowerId.slice(0, 4)}`,
                principalDisbursed: loan.loanAmount,
                principalOutstanding,
                interestOutstanding,
                serviceFeeOutstanding,
                penaltyOutstanding,
                totalOutstanding,
                status,
                daysInArrears: status === 'Overdue' ? daysInArrears : 0,
            };
        });

        return NextResponse.json(reportData);

    } catch (error) {
        console.error('Failed to fetch loans report:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
