import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { z } from 'zod';
import { bnplCheckoutSchema } from '@/lib/schemas';
import { checkLoanEligibility } from '@/actions/eligibility';
import { createAuditLog } from '@/lib/audit-log';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const data = bnplCheckoutSchema.parse(body);

    const item = await prisma.item.findUnique({
      where: { id: data.itemId },
      include: { merchant: true },
    });

    if (!item || item.status !== 'ACTIVE') {
      return NextResponse.json({ error: 'Item not found.' }, { status: 404 });
    }

    if (item.merchant.status !== 'ACTIVE') {
      return NextResponse.json({ error: 'Merchant is inactive.' }, { status: 400 });
    }

    const quantity = data.quantity ?? 1;
    const totalAmount = item.price * quantity;

    const product = await prisma.loanProduct.findUnique({
      where: { id: data.productId },
    });

    if (!product) {
      return NextResponse.json({ error: 'Loan product not found.' }, { status: 404 });
    }

    const { isEligible, maxLoanAmount, reason } = await checkLoanEligibility(
      data.borrowerId,
      product.providerId,
      product.id
    );

    if (!isEligible) {
      return NextResponse.json({ error: `Loan denied: ${reason}` }, { status: 400 });
    }

    if (totalAmount > maxLoanAmount) {
      return NextResponse.json(
        { error: `Insufficient limit. Item total ${totalAmount} exceeds available limit ${maxLoanAmount}.` },
        { status: 400 }
      );
    }

    await createAuditLog({
      actorId: 'system',
      action: 'BNPL_CHECKOUT_INITIATED',
      entity: 'ORDER',
      details: { borrowerId: data.borrowerId, productId: data.productId, itemId: data.itemId, quantity, totalAmount },
    });

    const result = await prisma.$transaction(async (tx) => {
      const loanApplication = await tx.loanApplication.create({
        data: {
          borrowerId: data.borrowerId,
          productId: data.productId,
          loanAmount: totalAmount,
          status: 'APPROVED_PENDING_MERCHANT_CONFIRMATION',
        },
      });

      const order = await tx.order.create({
        data: {
          borrowerId: data.borrowerId,
          merchantId: item.merchantId,
          status: 'PENDING_MERCHANT_CONFIRMATION',
          totalAmount,
          loanApplicationId: loanApplication.id,
          items: {
            create: {
              itemId: item.id,
              quantity,
              unitPrice: item.price,
              lineTotal: totalAmount,
            },
          },
        },
        include: {
          items: { include: { item: true } },
          merchant: true,
        },
      });

      return { order, loanApplication };
    });

    await createAuditLog({
      actorId: 'system',
      action: 'BNPL_CHECKOUT_SUCCESS',
      entity: 'ORDER',
      entityId: result.order.id,
      details: { orderId: result.order.id, loanApplicationId: result.loanApplication.id },
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const errorMessage = error instanceof z.ZodError ? error.errors : (error as Error).message;
    console.error('POST /api/bnpl/checkout error:', error);
    return NextResponse.json({ error: errorMessage || 'Internal Server Error' }, { status: 500 });
  }
}
