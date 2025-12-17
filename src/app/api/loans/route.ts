
'use server';

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { z } from 'zod';
import { loanCreationSchema } from '@/lib/schemas';
import { checkLoanEligibility } from '@/actions/eligibility';
import { createAuditLog } from '@/lib/audit-log';
import { disburseLoanTx } from '@/lib/loan-disbursement';

async function handlePersonalLoan(data: z.infer<typeof loanCreationSchema>) {
    return await prisma.$transaction(async (tx) => {
        const loanApplication = await tx.loanApplication.create({
            data: {
                borrowerId: data.borrowerId,
                productId: data.productId,
                loanAmount: data.loanAmount,
                status: 'DISBURSED',
            }
        });

        const createdLoan = await disburseLoanTx(tx, {
            borrowerId: data.borrowerId,
            productId: data.productId,
            loanApplicationId: loanApplication.id,
            loanAmount: data.loanAmount,
            disbursedDate: new Date(data.disbursedDate),
            dueDate: new Date(data.dueDate),
        });

        return createdLoan;
    });
}

export async function POST(req: NextRequest) {
    if (req.method !== 'POST') {
        return new NextResponse(null, { status: 405, statusText: "Method Not Allowed" });
    }
    // enforce CSRF for loan disbursement
    
    let loanDetailsForLogging: any = {};
    try {
        const body = await req.json();
        const data = loanCreationSchema.parse(body);
        loanDetailsForLogging = { ...data };

        const product = await prisma.loanProduct.findUnique({
            where: { id: data.productId },
        });
        
        if (!product) {
            throw new Error('Loan product not found.');
        }

        const logDetails = { borrowerId: data.borrowerId, productId: data.productId, amount: data.loanAmount };
        await createAuditLog({ actorId: 'system', action: 'LOAN_DISBURSEMENT_INITIATED', entity: 'LOAN', details: logDetails });

        const { isEligible, maxLoanAmount, reason } = await checkLoanEligibility(data.borrowerId, product.providerId, product.id);

        if (!isEligible) {
            throw new Error(`Loan denied: ${reason}`);
        }

        if (data.loanAmount > maxLoanAmount) {
            throw new Error(`Requested amount of ${data.loanAmount} exceeds the maximum allowed limit of ${maxLoanAmount}.`);
        }

        const newLoan = await handlePersonalLoan(data);

        const successLogDetails = {
            loanId: newLoan.id,
            borrowerId: newLoan.borrowerId,
            productId: newLoan.productId,
            amount: newLoan.loanAmount,
            serviceFee: newLoan.serviceFee,
        };
        await createAuditLog({ actorId: 'system', action: 'LOAN_DISBURSEMENT_SUCCESS', entity: 'LOAN', entityId: newLoan.id, details: successLogDetails });

        return NextResponse.json(newLoan, { status: 201 });

    } catch (error) {
        const errorMessage = (error instanceof z.ZodError) ? error.errors : (error as Error).message;
        const failureLogDetails = {
            ...loanDetailsForLogging,
            error: errorMessage,
        };
        await createAuditLog({ actorId: 'system', action: 'LOAN_DISBURSEMENT_FAILED', entity: 'LOAN', details: failureLogDetails });

        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: error.errors }, { status: 400 });
        }
        console.error("Error in POST /api/loans:", error);
        return NextResponse.json({ error: (error as Error).message || 'Internal Server Error' }, { status: 500 });
    }
}
