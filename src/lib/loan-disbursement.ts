'use server';

import type { Prisma } from '@prisma/client';
import { calculateTotalRepayable } from '@/lib/loan-calculator';

export async function disburseLoanTx(
  tx: Prisma.TransactionClient,
  args: {
    borrowerId: string;
    productId: string;
    loanApplicationId: string;
    loanAmount: number;
    disbursedDate: Date;
    dueDate: Date;
  }
) {
  const [product, taxConfigs] = await Promise.all([
    tx.loanProduct.findUnique({
      where: { id: args.productId },
      include: {
        provider: {
          include: {
            ledgerAccounts: true,
          },
        },
      },
    }),
    tx.tax.findMany(),
  ]);

  if (!product) {
    throw new Error('Loan product not found.');
  }

  if (product.provider.initialBalance < args.loanAmount) {
    throw new Error(
      `Insufficient provider funds. Available: ${product.provider.initialBalance}, Requested: ${args.loanAmount}`
    );
  }

  const provider = product.provider;

  const tempLoanForCalc = {
    id: 'temp',
    borrowerId: args.borrowerId,
    loanAmount: args.loanAmount,
    disbursedDate: args.disbursedDate,
    dueDate: args.dueDate,
    serviceFee: 0,
    repaymentStatus: 'Unpaid' as 'Unpaid' | 'Paid',
    payments: [],
    productName: product.name,
    providerName: provider.name,
    repaidAmount: 0,
    penaltyAmount: 0,
    product: product as any,
  };

  const { serviceFee: calculatedServiceFee } = calculateTotalRepayable(
    tempLoanForCalc,
    product as any,
    taxConfigs as any,
    args.disbursedDate
  );

  const principalReceivableAccount = provider.ledgerAccounts.find(
    (acc: any) => acc.category === 'Principal' && acc.type === 'Receivable'
  );
  const serviceFeeReceivableAccount = provider.ledgerAccounts.find(
    (acc: any) => acc.category === 'ServiceFee' && acc.type === 'Receivable'
  );
  const serviceFeeIncomeAccount = provider.ledgerAccounts.find(
    (acc: any) => acc.category === 'ServiceFee' && acc.type === 'Income'
  );

  if (!principalReceivableAccount) throw new Error('Principal Receivable ledger account not found.');
  if (calculatedServiceFee > 0 && (!serviceFeeReceivableAccount || !serviceFeeIncomeAccount)) {
    throw new Error('Service Fee ledger accounts not configured.');
  }

  const createdLoan = await tx.loan.create({
    data: {
      borrowerId: args.borrowerId,
      productId: args.productId,
      loanApplicationId: args.loanApplicationId,
      loanAmount: args.loanAmount,
      disbursedDate: args.disbursedDate,
      dueDate: args.dueDate,
      serviceFee: calculatedServiceFee,
      penaltyAmount: 0,
      repaymentStatus: 'Unpaid',
      repaidAmount: 0,
    },
  });

  await tx.loanApplication.update({
    where: { id: args.loanApplicationId },
    data: { status: 'DISBURSED' },
  });

  const journalEntry = await tx.journalEntry.create({
    data: {
      providerId: provider.id,
      loanId: createdLoan.id,
      date: args.disbursedDate,
      description: `Loan disbursement for ${product.name} to borrower ${args.borrowerId}`,
    },
  });

  await tx.ledgerEntry.createMany({
    data: [
      {
        journalEntryId: journalEntry.id,
        ledgerAccountId: principalReceivableAccount.id,
        type: 'Debit',
        amount: args.loanAmount,
      },
    ],
  });

  if (calculatedServiceFee > 0 && serviceFeeReceivableAccount && serviceFeeIncomeAccount) {
    await tx.ledgerEntry.createMany({
      data: [
        {
          journalEntryId: journalEntry.id,
          ledgerAccountId: serviceFeeReceivableAccount.id,
          type: 'Debit',
          amount: calculatedServiceFee,
        },
        {
          journalEntryId: journalEntry.id,
          ledgerAccountId: serviceFeeIncomeAccount.id,
          type: 'Credit',
          amount: calculatedServiceFee,
        },
      ],
    });

    await tx.ledgerAccount.update({
      where: { id: serviceFeeReceivableAccount.id },
      data: { balance: { increment: calculatedServiceFee } },
    });

    await tx.ledgerAccount.update({
      where: { id: serviceFeeIncomeAccount.id },
      data: { balance: { increment: calculatedServiceFee } },
    });
  }

  await tx.ledgerAccount.update({
    where: { id: principalReceivableAccount.id },
    data: { balance: { increment: args.loanAmount } },
  });

  await tx.loanProvider.update({
    where: { id: provider.id },
    data: { initialBalance: { decrement: args.loanAmount } },
  });

  return createdLoan;
}
