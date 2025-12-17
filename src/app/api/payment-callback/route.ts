
import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import prisma from '@/lib/prisma';
import { calculateTotalRepayable } from '@/lib/loan-calculator';
import { startOfDay, isBefore, isEqual } from 'date-fns';

// Local alias for repayment behavior values used in the code
type RepaymentBehavior = 'EARLY' | 'ON_TIME' | 'LATE';
import { createAuditLog } from '@/lib/audit-log';

// Function to validate the token from the Authorization header
async function validateAuthHeader(authHeader: string | null) {
  const TOKEN_VALIDATION_API_URL = process.env.TOKEN_VALIDATION_API_URL;
  if (!TOKEN_VALIDATION_API_URL) {
    throw new Error("Token validation URL is not configured.");
  }
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error("Authorization header is malformed or missing.");
  }

  const response = await fetch(TOKEN_VALIDATION_API_URL, {
    method: 'GET',
    headers: {
      'Authorization': authHeader,
      'Accept': 'application/json'
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    const errorData = await response.text();
    console.error("Token validation failed:", errorData);
    throw new Error("External token validation failed.");
  }

  return true;
}

export async function POST(request: NextRequest) {
  let requestBody;
  try {
    requestBody = await request.json();
    // callback payload received (log removed to reduce console noise)

    // ✅ Extract and normalize Authorization header
    const authHeader = request.headers.get('Authorization');

// Extract token if format is like: Bearer {"token":"YOUR_TOKEN"}
let fixedAuthHeader: string | null = null;

if (authHeader) {
  // Match both quoted or unquoted token values
  const tokenMatch = authHeader.match(/"token"\s*:\s*"([^"]+)"/);
  const rawToken = tokenMatch?.[1];

  // If found, reconstruct standard Bearer token format
  fixedAuthHeader = rawToken ? `Bearer ${rawToken}` : authHeader;
}

if (!fixedAuthHeader) {
  throw new Error('Invalid Authorization header format.');
}

    // ✅ Validate fixed token
    await validateAuthHeader(fixedAuthHeader);

  } catch (e: any) {
    console.error("Callback Error: Initial validation failed.", e);
    return NextResponse.json(
      { message: e.message || "Authentication or parsing error." },
      { status: 400 }
    );
  }

  const {
    paidAmount,
    paidByNumber,
    txnRef,
    transactionId,
    transactionTime,
    accountNo,
    token,
    Signature: receivedSignature
  } = requestBody;

  // --- Log payment transaction ---
  try {
    await prisma.paymentTransaction.upsert({
      where: { transactionId: txnRef }, // Use txnRef as the unique identifier
      update: {
        status: 'RECEIVED',
        payload: JSON.stringify(requestBody)
      },
      create: {
        transactionId: txnRef, // Use txnRef as the unique identifier
        status: 'RECEIVED',
        payload: JSON.stringify(requestBody)
      }
    });
  } catch (e) {
    console.error("Failed to log payment transaction:", e);
  }

  
 
  // Step 3: Process payment
  try {
    const pendingPayment = await prisma.pendingPayment.findUnique({
      where: { transactionId: txnRef },
    });

    if (!pendingPayment) {
      console.error(`Callback Error: No pending payment found for txnRef: ${txnRef}`);
      return NextResponse.json({ message: "Transaction reference not found or already processed." }, { status: 200 });
    }

    const { loanId, amount: paymentAmount, borrowerId } = pendingPayment;

    const [loan, taxConfig] = await Promise.all([
      prisma.loan.findUnique({
        where: { id: loanId },
        include: {
          product: { include: { provider: { include: { ledgerAccounts: true } } } },
        },
      }),
      prisma.tax.findMany(),
    ]);

    if (!loan) throw new Error(`Loan with ID ${loanId} not found.`);

    const provider = loan.product.provider;
    const paymentDate = new Date();
    // provider ledger accounts log removed to reduce console noise
    const totals = calculateTotalRepayable(loan as any, loan.product as any, taxConfig, paymentDate);
    const alreadyRepaid = loan.repaidAmount || 0;
    const totalDue = totals.total - alreadyRepaid;

if (paymentAmount > totalDue + 0.01) { // Add tolerance for floating point
        console.error(`[PAYMENT_CALLBACK_ERROR] Overpayment detected. Payment amount (${paymentAmount}) exceeds balance due (${totalDue}).`);
        // We still have to accept the callback, but we will not process the payment.
        // And we will flag the pending payment as failed.
        await prisma.pendingPayment.update({
            where: { transactionId: txnRef },
            data: { status: 'FAILED' },
        });
        return NextResponse.json({ message: "Overpayment detected, transaction will not be processed." }, { status: 200 });
    }

    const updatedLoan = await prisma.$transaction(async (tx) => {
      const journalEntry = await tx.journalEntry.create({
        data: {
          providerId: provider.id,
          loanId: loan.id,
          date: paymentDate,
          description: `SuperApp repayment for loan ${loan.id} via TxRef ${txnRef}`
        },
      });

      // Find provider ledger accounts for receivable/received
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

      // Prepare ledger entry creations
      const ledgerEntryCreates: Array<{ journalEntryId: string; ledgerAccountId: string; type: string; amount: number }> = [];

      // Apply payment in order: Penalty -> ServiceFee -> Interest -> Principal
      let amountToApply = paymentAmount;

      const penaltyDue = Math.max(0, totals.penalty - (loan.repaidAmount || 0));
      const penaltyToPay = Math.min(amountToApply, penaltyDue);
      if (penaltyToPay > 0) {
        await tx.ledgerAccount.update({ where: { id: penaltyReceivable.id }, data: { balance: { decrement: penaltyToPay } } });
        await tx.ledgerAccount.update({ where: { id: penaltyReceived.id }, data: { balance: { increment: penaltyToPay } } });
        ledgerEntryCreates.push({ journalEntryId: journalEntry.id, ledgerAccountId: penaltyReceivable.id, type: 'Credit', amount: penaltyToPay });
        ledgerEntryCreates.push({ journalEntryId: journalEntry.id, ledgerAccountId: penaltyReceived.id, type: 'Debit', amount: penaltyToPay });
        amountToApply -= penaltyToPay;
      }

      const serviceFeeDue = Math.max(0, totals.serviceFee - Math.max(0, (loan.repaidAmount || 0) - penaltyToPay));
      const serviceFeeToPay = Math.min(amountToApply, serviceFeeDue);
      if (serviceFeeToPay > 0) {
        await tx.ledgerAccount.update({ where: { id: serviceFeeReceivable.id }, data: { balance: { decrement: serviceFeeToPay } } });
        await tx.ledgerAccount.update({ where: { id: serviceFeeReceived.id }, data: { balance: { increment: serviceFeeToPay } } });
        ledgerEntryCreates.push({ journalEntryId: journalEntry.id, ledgerAccountId: serviceFeeReceivable.id, type: 'Credit', amount: serviceFeeToPay });
        ledgerEntryCreates.push({ journalEntryId: journalEntry.id, ledgerAccountId: serviceFeeReceived.id, type: 'Debit', amount: serviceFeeToPay });
        amountToApply -= serviceFeeToPay;
      }

      const interestDue = Math.max(0, totals.interest - Math.max(0, (loan.repaidAmount || 0) - penaltyToPay - serviceFeeToPay));
      const interestToPay = Math.min(amountToApply, interestDue);
      if (interestToPay > 0) {
        await tx.ledgerAccount.update({ where: { id: interestReceivable.id }, data: { balance: { decrement: interestToPay } } });
        await tx.ledgerAccount.update({ where: { id: interestReceived.id }, data: { balance: { increment: interestToPay } } });
        ledgerEntryCreates.push({ journalEntryId: journalEntry.id, ledgerAccountId: interestReceivable.id, type: 'Credit', amount: interestToPay });
        ledgerEntryCreates.push({ journalEntryId: journalEntry.id, ledgerAccountId: interestReceived.id, type: 'Debit', amount: interestToPay });
        amountToApply -= interestToPay;
      }

      const principalDue = Math.max(0, totals.principal - Math.max(0, (loan.repaidAmount || 0) - penaltyToPay - serviceFeeToPay - interestToPay));
      const principalToPay = Math.min(amountToApply, principalDue);
      if (principalToPay > 0) {
        await tx.ledgerAccount.update({ where: { id: principalReceivable.id }, data: { balance: { decrement: principalToPay } } });
        await tx.ledgerAccount.update({ where: { id: principalReceived.id }, data: { balance: { increment: principalToPay } } });
        ledgerEntryCreates.push({ journalEntryId: journalEntry.id, ledgerAccountId: principalReceivable.id, type: 'Credit', amount: principalToPay });
        ledgerEntryCreates.push({ journalEntryId: journalEntry.id, ledgerAccountId: principalReceived.id, type: 'Debit', amount: principalToPay });
        amountToApply -= principalToPay;
      }

      if (ledgerEntryCreates.length > 0) {
        await tx.ledgerEntry.createMany({ data: ledgerEntryCreates });
      }

      const newPayment = await tx.payment.create({
        data: {
          loanId,
          amount: paymentAmount,
          date: paymentDate,
          outstandingBalanceBeforePayment: totalDue,
          journalEntryId: journalEntry.id,
        },
      });

      const newRepaidAmount = alreadyRepaid + paymentAmount;
      const isFullyPaid = newRepaidAmount >= totals.total;
      let repaymentBehavior: RepaymentBehavior | null = null;

      if (isFullyPaid) {
        const today = startOfDay(new Date());
        const dueDate = startOfDay(loan.dueDate);
        if (isBefore(today, dueDate)) repaymentBehavior = 'EARLY';
        else if (isEqual(today, dueDate)) repaymentBehavior = 'ON_TIME';
        else repaymentBehavior = 'LATE';
      }

      const finalLoan = await tx.loan.update({
        where: { id: loanId },
        data: {
          repaidAmount: newRepaidAmount,
          repaymentStatus: isFullyPaid ? 'Paid' : 'Unpaid',
          ...(repaymentBehavior && { repaymentBehavior }),
        },
      });

      await createAuditLog({
        actorId: borrowerId,
        action: 'REPAYMENT_SUCCESS',
        entity: 'LOAN',
        entityId: loan.id,
        details: { transactionId: txnRef, amount: paymentAmount, paidBy: paidByNumber },
      });

      await tx.pendingPayment.update({
        where: { transactionId: txnRef },
        data: { status: 'COMPLETED' },
      });

      return finalLoan;
    });

    return NextResponse.json({ message: "Payment confirmed and updated." }, { status: 200 });
  } catch (error: any) {
    console.error("Callback Error: Failed to process payment update.", error);
    return NextResponse.json(
      { message: error.message || "Internal server error during payment processing." },
      { status: 400 }
    );
  }
}
