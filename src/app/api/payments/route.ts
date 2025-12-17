
import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { z } from 'zod';
import { calculateTotalRepayable } from '@/lib/loan-calculator';
import { startOfDay, isBefore, isEqual } from 'date-fns';
import type { RepaymentBehavior } from '@prisma/client';
import { createAuditLog } from '@/lib/audit-log';
import sendSms from '@/lib/sms';

const paymentSchema = z.object({
  loanId: z.string(),
  amount: z.number().positive(),
});

export async function POST(req: NextRequest) {
    // repayment actions
    let paymentDetailsForLogging: any = {};
    let borrowerIdForLogging: string | null = null;
    try {
        const body = await req.json();
        const { loanId, amount: paymentAmount } = paymentSchema.parse(body);
        paymentDetailsForLogging = { loanId, amount: paymentAmount };
        
        const loanForBorrowerId = await prisma.loan.findUnique({ where: { id: loanId }, select: { borrowerId: true }});
        borrowerIdForLogging = loanForBorrowerId?.borrowerId || null;

        await createAuditLog({ actorId: borrowerIdForLogging || 'unknown', action: 'REPAYMENT_INITIATED', entity: 'LOAN', entityId: loanId, details: paymentDetailsForLogging });
       

        const [loan, taxConfigs] = await Promise.all([
            prisma.loan.findUnique({
                where: { id: loanId },
                include: { 
                    product: {
                        include: {
                            provider: {
                                include: {
                                    ledgerAccounts: true
                                }
                            }
                        }
                    }
                }
            }),
            prisma.tax.findMany()
        ]);


        if (!loan) {
            throw new Error('Loan not found');
        }
        
        const provider = loan.product.provider;
        const paymentDate = new Date();
        
        const { total, principal, interest, penalty, serviceFee } = calculateTotalRepayable(loan as any, loan.product, taxConfigs, paymentDate);
        const alreadyRepaid = loan.repaidAmount || 0;
        
        const totalDue = total - alreadyRepaid;
        
        const penaltyDue = Math.max(0, penalty - (loan.repaidAmount || 0));
        const serviceFeeDue = Math.max(0, serviceFee - Math.max(0, (loan.repaidAmount || 0) - penalty));
        const interestDue = Math.max(0, interest - Math.max(0, (loan.repaidAmount || 0) - penalty - serviceFee));
        const principalDue = Math.max(0, principal - Math.max(0, (loan.repaidAmount || 0) - penalty - serviceFee - interest));


        if (paymentAmount > totalDue + 1e-9) { // Add machine epsilon for float comparison
             throw new Error('Payment amount exceeds balance due.');
        }
        
        const updatedLoan = await prisma.$transaction(async (tx) => {
            let amountToApply = paymentAmount;
            
            // Ledger Accounts
            const principalReceivable = provider.ledgerAccounts.find(a => a.category === 'Principal' && a.type === 'Receivable');
            const interestReceivable = provider.ledgerAccounts.find(a => a.category === 'Interest' && a.type === 'Receivable');
            const penaltyReceivable = provider.ledgerAccounts.find(a => a.category === 'Penalty' && a.type === 'Receivable');
            const serviceFeeReceivable = provider.ledgerAccounts.find(a => a.category === 'ServiceFee' && a.type === 'Receivable');
            const taxReceivable = provider.ledgerAccounts.find(a => a.category === 'Tax' && a.type === 'Receivable');

            const principalReceived = provider.ledgerAccounts.find(a => a.category === 'Principal' && a.type === 'Received');
            const interestReceived = provider.ledgerAccounts.find(a => a.category === 'Interest' && a.type === 'Received');
            const penaltyReceived = provider.ledgerAccounts.find(a => a.category === 'Penalty' && a.type === 'Received');
            const serviceFeeReceived = provider.ledgerAccounts.find(a => a.category === 'ServiceFee' && a.type === 'Received');
            const taxReceived = provider.ledgerAccounts.find(a => a.category === 'Tax' && a.type === 'Received');
            
            
            if (!principalReceivable || !interestReceivable || !penaltyReceivable || !serviceFeeReceivable || !taxReceivable ||
                !principalReceived || !interestReceived || !penaltyReceived || !serviceFeeReceived || !taxReceived) {
                throw new Error(`One or more ledger accounts not found for provider ${provider.id}`);
            }

            const journalEntry = await tx.journalEntry.create({
                data: {
                    providerId: provider.id,
                    loanId: loan.id,
                    date: paymentDate,
                    description: `Repayment of ${paymentAmount} for loan ${loan.id}`
                }
            });

            // Apply payment according to priority: Penalty -> Service Fee -> Interest -> Tax -> Principal
            const penaltyToPay = Math.min(amountToApply, penaltyDue);
            if (penaltyToPay > 0) {
                await tx.ledgerAccount.update({ where: { id: penaltyReceivable.id }, data: { balance: { decrement: penaltyToPay } } });
                await tx.ledgerAccount.update({ where: { id: penaltyReceived.id }, data: { balance: { increment: penaltyToPay } } });
                await tx.ledgerEntry.createMany({ data: [
                    { journalEntryId: journalEntry.id, ledgerAccountId: penaltyReceivable.id, type: 'Credit', amount: penaltyToPay },
                    { journalEntryId: journalEntry.id, ledgerAccountId: penaltyReceived.id, type: 'Debit', amount: penaltyToPay }
                ]});
                amountToApply -= penaltyToPay;
            }

            const serviceFeeToPay = Math.min(amountToApply, serviceFeeDue);
            if (serviceFeeToPay > 0) {
                await tx.ledgerAccount.update({ where: { id: serviceFeeReceivable.id }, data: { balance: { decrement: serviceFeeToPay } } });
                await tx.ledgerAccount.update({ where: { id: serviceFeeReceived.id }, data: { balance: { increment: serviceFeeToPay } } });
                await tx.ledgerEntry.createMany({ data: [
                    { journalEntryId: journalEntry.id, ledgerAccountId: serviceFeeReceivable.id, type: 'Credit', amount: serviceFeeToPay },
                    { journalEntryId: journalEntry.id, ledgerAccountId: serviceFeeReceived.id, type: 'Debit', amount: serviceFeeToPay }
                ]});
                amountToApply -= serviceFeeToPay;
            }

            const interestToPay = Math.min(amountToApply, interestDue);
             if (interestToPay > 0) {
                await tx.ledgerAccount.update({ where: { id: interestReceivable.id }, data: { balance: { decrement: interestToPay } } });
                await tx.ledgerAccount.update({ where: { id: interestReceived.id }, data: { balance: { increment: interestToPay } } });
                await tx.ledgerEntry.createMany({ data: [
                    { journalEntryId: journalEntry.id, ledgerAccountId: interestReceivable.id, type: 'Credit', amount: interestToPay },
                    { journalEntryId: journalEntry.id, ledgerAccountId: interestReceived.id, type: 'Debit', amount: interestToPay }
                ]});
                amountToApply -= interestToPay;
            }

            // Note: Tax calculation is part of totalRepayable, but its repayment is not explicitly handled here.
            // This logic assumes tax is implicitly part of the components it's applied to.
            // A more robust system would handle tax settlement separately.

            const principalToPay = Math.min(amountToApply, principalDue);
             if (principalToPay > 0) {
                await tx.ledgerAccount.update({ where: { id: principalReceivable.id }, data: { balance: { decrement: principalToPay } } });
                await tx.ledgerAccount.update({ where: { id: principalReceived.id }, data: { balance: { increment: principalToPay } } });
                 await tx.ledgerEntry.createMany({ data: [
                    { journalEntryId: journalEntry.id, ledgerAccountId: principalReceivable.id, type: 'Credit', amount: principalToPay },
                    { journalEntryId: journalEntry.id, ledgerAccountId: principalReceived.id, type: 'Debit', amount: principalToPay }
                ]});
            }

            // Create payment record
            const newPayment = await tx.payment.create({
                data: {
                    loanId,
                    amount: paymentAmount,
                    date: paymentDate,
                    outstandingBalanceBeforePayment: totalDue,
                    journalEntryId: journalEntry.id,
                }
            });

            const newRepaidAmount = alreadyRepaid + paymentAmount;
            const isFullyPaid = newRepaidAmount >= total;
            let repaymentBehavior: RepaymentBehavior | null = null;
            
            if (isFullyPaid) {
                const today = startOfDay(new Date());
                const dueDate = startOfDay(loan.dueDate);
                if (isBefore(today, dueDate)) {
                    repaymentBehavior = 'EARLY';
                } else if (isEqual(today, dueDate)) {
                    repaymentBehavior = 'ON_TIME';
                } else {
                    repaymentBehavior = 'LATE';
                }
            }

            const finalLoan = await tx.loan.update({
                where: { id: loanId },
                data: {
                    repaidAmount: newRepaidAmount,
                    repaymentStatus: isFullyPaid ? 'Paid' : 'Unpaid',
                    ...(repaymentBehavior && { repaymentBehavior: repaymentBehavior }),
                },
                include: {
                    payments: { orderBy: { date: 'asc' } },
                    product: true,
                }
            });
            
            const logDetails = {
               loanId: loan.id,
               paymentId: newPayment.id,
               amount: paymentAmount,
               repaymentStatus: finalLoan.repaymentStatus,
            };
            await createAuditLog({ actorId: loan.borrowerId, action: 'REPAYMENT_SUCCESS', entity: 'LOAN', entityId: loan.id, details: logDetails });
           

            // Send SMS notification to borrower for manual repayment
            (async () => {
                try {
                    const phone = loan.borrowerId;
                    const msg = `Payment of ${paymentAmount} ETB received for loan ${loan.id}. Thank you.`;
                    const smsRes = await sendSms(String(phone), msg);
                    if (!smsRes.ok) console.warn('[payments] sms send failed', smsRes);
                } catch (e) {
                    console.error('[payments] sms notify error', e);
                }
            })();

            return finalLoan;
        });

        return NextResponse.json(updatedLoan, { status: 200 });

    } catch (error: any) {
        const errorMessage = (error instanceof z.ZodError) ? error.errors : (error as Error).message;
        const failureLogDetails = {
            ...paymentDetailsForLogging,
            error: errorMessage,
        };
        await createAuditLog({ actorId: borrowerIdForLogging || 'unknown', action: 'REPAYMENT_FAILED', entity: 'LOAN', entityId: paymentDetailsForLogging.loanId, details: failureLogDetails });
        console.error(JSON.stringify({ ...failureLogDetails, timestamp: new Date().toISOString(), action: 'REPAYMENT_FAILED' }));

        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: error.errors }, { status: 400 });
        }
        return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
    }
}
