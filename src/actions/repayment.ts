
'use server';
/**
 * @fileOverview Implements the logic for loan repayments, including automated deductions.
 *
 * - processAutomatedRepayments - A service that finds overdue loans and attempts to deduct payment from customer accounts.
 */

import prisma from '@/lib/prisma';
import { calculateTotalRepayable } from '@/lib/loan-calculator';
import { startOfDay } from 'date-fns';
import { createAuditLog } from '@/lib/audit-log';
import sendSms from '@/lib/sms';

async function getBorrowerBalance(borrowerId: string): Promise<number> {
    const provisionedData = await prisma.provisionedData.findFirst({
        where: { borrowerId },
        orderBy: { createdAt: 'desc' },
    });

    if (provisionedData) {
        try {
            const data = JSON.parse(provisionedData.data as string);
            const balanceKey = Object.keys(data).find(k => k.toLowerCase() === 'accountbalance');
            if (balanceKey) {
                return parseFloat(data[balanceKey]) || 0;
            }
        } catch (e) {
            console.error(`Could not parse provisioned data for borrower ${borrowerId}`, e);
            return 0;
        }
    }
    return 0;
}

export async function processAutomatedRepayments(): Promise<{ success: boolean; message: string; processedCount: number }> {
    console.log('Starting automated repayment process...');
    const today = startOfDay(new Date());

    // 1. Find all unpaid loans that are overdue
    const overdueLoans = await prisma.loan.findMany({
        where: {
            repaymentStatus: 'Unpaid',
            dueDate: {
                lt: today,
            },
        },
        include: {
            product: {
                include: {
                    provider: {
                        include: {
                            ledgerAccounts: true,
                        }
                    }
                }
            }
        },
    });

    if (overdueLoans.length === 0) {
        console.log('No overdue loans found.');
        return { success: true, message: 'No overdue loans to process.', processedCount: 0 };
    }

    let processedCount = 0;

    for (const loan of overdueLoans) {
        const { total, principal, interest, penalty, serviceFee } = calculateTotalRepayable(loan as any, loan.product, today);
        const alreadyRepaid = loan.repaidAmount || 0;
        const totalDue = total - alreadyRepaid;

        if (totalDue <= 0) {
            continue; // Skip if already paid off
        }

        const borrowerBalance = await getBorrowerBalance(loan.borrowerId);
        
        if (borrowerBalance >= totalDue) {
            try {
                await prisma.$transaction(async (tx) => {
                    const provider = loan.product.provider;
                    
                    // Ledger Accounts
                    const principalReceivable = provider.ledgerAccounts.find(a => a.category === 'Principal' && a.type === 'Receivable');
                    const interestReceivable = provider.ledgerAccounts.find(a => a.category === 'Interest' && a.type === 'Receivable');
                    const penaltyReceivable = provider.ledgerAccounts.find(a => a.category === 'Penalty' && a.type === 'Receivable');
                    const serviceFeeReceivable = provider.ledgerAccounts.find(a => a.category === 'ServiceFee' && a.type === 'Receivable');

                    const principalReceived = provider.ledgerAccounts.find(a => a.category === 'Principal' && a.type === 'Received');
                    const interestReceived = provider.ledgerAccounts.find(a => a.category === 'Interest' && a.type === 'Received');
                    const penaltyReceived = provider.ledgerAccounts.find(a => a.category === 'Penalty' && a.type === 'Received');
                    const serviceFeeReceived = provider.ledgerAccounts.find(a => a.category === 'ServiceFee' && a.type === 'Received');
                    
                    
                    if (!principalReceivable || !interestReceivable || !penaltyReceivable || !serviceFeeReceivable ||
                        !principalReceived || !interestReceived || !penaltyReceived || !serviceFeeReceived) {
                        throw new Error(`One or more ledger accounts not found for provider ${provider.id}`);
                    }
                    
                     const journalEntry = await tx.journalEntry.create({
                        data: {
                            providerId: provider.id,
                            loanId: loan.id,
                            date: today,
                            description: `Automated repayment for loan ${loan.id}`,
                        }
                    });
                    
                    let paymentAmount = totalDue;

                    const penaltyDue = Math.max(0, penalty - (loan.repaidAmount || 0));
                    const serviceFeeDue = Math.max(0, serviceFee - Math.max(0, (loan.repaidAmount || 0) - penalty));
                    const interestDue = Math.max(0, interest - Math.max(0, (loan.repaidAmount || 0) - penalty - serviceFee));

                    const penaltyToPay = Math.min(paymentAmount, penaltyDue);
                    if (penaltyToPay > 0) {
                        await tx.ledgerAccount.update({ where: { id: penaltyReceivable.id }, data: { balance: { decrement: penaltyToPay } } });
                        await tx.ledgerAccount.update({ where: { id: penaltyReceived.id }, data: { balance: { increment: penaltyToPay } } });
                         await tx.ledgerEntry.createMany({ data: [
                            { journalEntryId: journalEntry.id, ledgerAccountId: penaltyReceivable.id, type: 'Credit', amount: penaltyToPay },
                            { journalEntryId: journalEntry.id, ledgerAccountId: penaltyReceived.id, type: 'Debit', amount: penaltyToPay }
                        ]});
                        paymentAmount -= penaltyToPay;
                    }
                    
                    const serviceFeeToPay = Math.min(paymentAmount, serviceFeeDue);
                    if (serviceFeeToPay > 0) {
                        await tx.ledgerAccount.update({ where: { id: serviceFeeReceivable.id }, data: { balance: { decrement: serviceFeeToPay } } });
                        await tx.ledgerAccount.update({ where: { id: serviceFeeReceived.id }, data: { balance: { increment: serviceFeeToPay } } });
                        await tx.ledgerEntry.createMany({ data: [
                            { journalEntryId: journalEntry.id, ledgerAccountId: serviceFeeReceivable.id, type: 'Credit', amount: serviceFeeToPay },
                            { journalEntryId: journalEntry.id, ledgerAccountId: serviceFeeReceived.id, type: 'Debit', amount: serviceFeeToPay }
                        ]});
                        paymentAmount -= serviceFeeToPay;
                    }

                    const interestToPay = Math.min(paymentAmount, interestDue);
                     if (interestToPay > 0) {
                        await tx.ledgerAccount.update({ where: { id: interestReceivable.id }, data: { balance: { decrement: interestToPay } } });
                        await tx.ledgerAccount.update({ where: { id: interestReceived.id }, data: { balance: { increment: interestToPay } } });
                         await tx.ledgerEntry.createMany({ data: [
                            { journalEntryId: journalEntry.id, ledgerAccountId: interestReceivable.id, type: 'Credit', amount: interestToPay },
                            { journalEntryId: journalEntry.id, ledgerAccountId: interestReceived.id, type: 'Debit', amount: interestToPay }
                        ]});
                        paymentAmount -= interestToPay;
                    }
                    
                    const principalToPay = paymentAmount;
                     if (principalToPay > 0) {
                        await tx.ledgerAccount.update({ where: { id: principalReceivable.id }, data: { balance: { decrement: principalToPay } } });
                        await tx.ledgerAccount.update({ where: { id: principalReceived.id }, data: { balance: { increment: principalToPay } } });
                        await tx.ledgerEntry.createMany({ data: [
                            { journalEntryId: journalEntry.id, ledgerAccountId: principalReceivable.id, type: 'Credit', amount: principalToPay },
                            { journalEntryId: journalEntry.id, ledgerAccountId: principalReceived.id, type: 'Debit', amount: principalToPay }
                        ]});
                    }
                    
                    await tx.payment.create({
                        data: {
                            loanId: loan.id,
                            amount: totalDue,
                            date: today,
                            outstandingBalanceBeforePayment: totalDue,
                            journalEntryId: journalEntry.id,
                        },
                    });

                    await tx.loan.update({
                        where: { id: loan.id },
                        data: {
                            repaidAmount: (loan.repaidAmount || 0) + totalDue,
                            repaymentStatus: 'Paid',
                        },
                    });
                });
                
                processedCount++;
                const logDetails = {
                    loanId: loan.id,
                    borrowerId: loan.borrowerId,
                    amount: totalDue
                };
                await createAuditLog({ actorId: 'system', action: 'AUTOMATED_REPAYMENT_SUCCESS', entity: 'LOAN', entityId: loan.id, details: logDetails });
                console.log(JSON.stringify({
                    action: 'AUTOMATED_REPAYMENT_SUCCESS',
                    actorId: 'system',
                    details: logDetails
                }));

                // (no SMS for automated repayments)

            } catch (error) {
                const failureDetails = {
                    loanId: loan.id,
                    borrowerId: loan.borrowerId,
                    error: (error as Error).message
                };
                await createAuditLog({ actorId: 'system', action: 'AUTOMATED_REPAYMENT_FAILURE', entity: 'LOAN', entityId: loan.id, details: failureDetails });
                 console.error(JSON.stringify({
                    action: 'AUTOMATED_REPAYMENT_FAILURE',
                    actorId: 'system',
                    details: failureDetails
                }));

                // (no SMS for automated repayment failures)
            }
        } else {
            const skipDetails = {
                loanId: loan.id,
                borrowerId: loan.borrowerId,
                balance: borrowerBalance,
                amountDue: totalDue
            };
            await createAuditLog({ actorId: 'system', action: 'AUTOMATED_REPAYMENT_SKIPPED', entity: 'LOAN', entityId: loan.id, details: { reason: 'Insufficient funds', ...skipDetails } });
             console.log(JSON.stringify({
                action: 'AUTOMATED_REPAYMENT_SKIPPED',
                actorId: 'system',
                reason: 'Insufficient funds',
                details: skipDetails
            }));

            // (no SMS for automated repayment skipped)
        }
    }
    
    console.log(`Automated repayment process finished. Processed ${processedCount} loans.`);
    return { success: true, message: `Processed ${overdueLoans.length} overdue loans, successfully repaid ${processedCount}.`, processedCount };
}

// Send due-date reminders for loans that are due today
export async function sendDueDateReminders(): Promise<{ sent: number }> {
    const today = startOfDay(new Date());
    // Find loans due today and unpaid
    const dueLoans = await prisma.loan.findMany({
        where: {
            repaymentStatus: 'Unpaid',
            dueDate: {
                gte: today,
                lt: new Date(today.getTime() + 24 * 60 * 60 * 1000),
            }
        }
    });

    let sent = 0;
    for (const loan of dueLoans) {
        try {
            const phone = loan.borrowerId; // borrowerId is phone in this app
            const msg = `Reminder: Loan ${loan.id} of amount ${loan.loanAmount} is due today (${loan.dueDate.toISOString().split('T')[0]}). Please repay to avoid penalties.`;
            const res = await sendSms(String(phone), msg);
            if (res.ok) sent++;
        } catch (e) {
            console.error('[repayment][dueReminder] failed to send sms', { loanId: loan.id, error: e });
        }
    }

    return { sent };
}
