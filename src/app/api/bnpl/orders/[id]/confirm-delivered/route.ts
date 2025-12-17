import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { z } from 'zod';
import { bnplConfirmDeliveredSchema } from '@/lib/schemas';
import { createAuditLog } from '@/lib/audit-log';
import { disburseLoanTx } from '@/lib/loan-disbursement';
import { addDays } from 'date-fns';

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  let detailsForLog: any = {};
  try {
    const { id } = await ctx.params;
    const body = await req.json();
    const data = bnplConfirmDeliveredSchema.parse(body);

    detailsForLog = { orderId: id, borrowerId: data.borrowerId };

    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        loanApplication: { include: { product: true } },
      },
    });

    if (!order) {
      return NextResponse.json({ error: 'Order not found.' }, { status: 404 });
    }

    if (order.borrowerId !== data.borrowerId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (order.status !== 'ON_DELIVERY') {
      return NextResponse.json({ error: `Order is not on delivery (current: ${order.status}).` }, { status: 400 });
    }

    if (!order.loanApplicationId || !order.loanApplication) {
      return NextResponse.json({ error: 'Order is missing a linked loan application.' }, { status: 400 });
    }

    await createAuditLog({
      actorId: 'system',
      action: 'BNPL_DELIVERY_CONFIRMED_INITIATED',
      entity: 'ORDER',
      entityId: order.id,
      details: detailsForLog,
    });

    const result = await prisma.$transaction(async (tx) => {
      const disbursedDate = new Date();
      const dueDate = addDays(disbursedDate, order.loanApplication!.product.duration || 0);

      const loan = await disburseLoanTx(tx, {
        borrowerId: order.borrowerId,
        productId: order.loanApplication!.productId,
        loanApplicationId: order.loanApplicationId!,
        loanAmount: order.totalAmount,
        disbursedDate,
        dueDate,
      });

      const updatedOrder = await tx.order.update({
        where: { id: order.id },
        data: {
          status: 'DELIVERED',
          loanId: loan.id,
        },
        include: {
          items: { include: { item: true } },
          merchant: true,
        },
      });

      return { order: updatedOrder, loan };
    });

    await createAuditLog({
      actorId: 'system',
      action: 'BNPL_DISBURSEMENT_SUCCESS',
      entity: 'ORDER',
      entityId: order.id,
      details: { orderId: order.id, loanId: result.loan.id },
    });

    return NextResponse.json(result);
  } catch (error) {
    const errorMessage = error instanceof z.ZodError ? error.errors : (error as Error).message;
    console.error('POST /api/bnpl/orders/[id]/confirm-delivered error:', error);

    await createAuditLog({
      actorId: 'system',
      action: 'BNPL_DISBURSEMENT_FAILED',
      entity: 'ORDER',
      details: { ...detailsForLog, error: errorMessage },
    }).catch(() => undefined);

    return NextResponse.json({ error: errorMessage || 'Internal Server Error' }, { status: 500 });
  }
}
