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

    const optionValueIds = (data.optionValueIds ?? []).filter(Boolean);
    const uniqueOptionValueIds = [...new Set(optionValueIds)];

    const variantId = data.variantId ?? null;
    let unitPrice = item.price;
    let selectedOptionValues: Array<{ id: string; label: string; priceDelta: number; groupId: string; groupName: string }> = [];

    if (uniqueOptionValueIds.length) {
      const values = await prisma.itemOptionValue.findMany({
        where: {
          id: { in: uniqueOptionValueIds },
          status: 'ACTIVE',
          group: {
            status: 'ACTIVE',
            itemId: item.id,
          },
        },
        include: { group: true },
      });

      if (values.length !== uniqueOptionValueIds.length) {
        return NextResponse.json({ error: 'One or more selected attributes were not found.' }, { status: 404 });
      }

      const groupSeen = new Set<string>();
      for (const v of values) {
        if (groupSeen.has(v.groupId)) {
          return NextResponse.json({ error: 'Only one value per attribute can be selected.' }, { status: 400 });
        }
        groupSeen.add(v.groupId);
      }

      const requiredGroups = await prisma.itemOptionGroup.findMany({
        where: { itemId: item.id, status: 'ACTIVE', isRequired: true },
        select: { id: true },
      });
      for (const rg of requiredGroups) {
        if (!groupSeen.has(rg.id)) {
          return NextResponse.json({ error: 'Please select all required attributes.' }, { status: 400 });
        }
      }

      const deltaSum = values.reduce<number>((acc, v) => acc + (v.priceDelta || 0), 0);
      unitPrice = item.price + deltaSum;
      selectedOptionValues = values.map((v) => ({
        id: v.id,
        label: v.label,
        priceDelta: v.priceDelta,
        groupId: v.groupId,
        groupName: v.group.name,
      }));
    } else if (variantId) {
      const variant = await prisma.itemVariant.findFirst({
        where: {
          id: variantId,
          itemId: item.id,
          status: 'ACTIVE',
        },
      });

      if (!variant) {
        return NextResponse.json({ error: 'Variant not found.' }, { status: 404 });
      }

      unitPrice = variant.price;
    }

    const totalAmount = unitPrice * quantity;

    // -- Discount rules application --
    // Load any discount rules that target this item or its category and are active for now
    const now = new Date();
    const candidateRules = await prisma.discountRule.findMany({
      where: {
        AND: [
          {
            OR: [{ itemId: item.id }, { categoryId: item.categoryId }],
          },
          { OR: [{ startDate: null }, { startDate: { lte: now } }] },
          { OR: [{ endDate: null }, { endDate: { gte: now } }] },
          { OR: [{ minimumQuantity: null }, { minimumQuantity: { lte: quantity } }] },
        ],
      },
    });

    let appliedDiscount: { ruleId: string; type: string; value: number; amount: number } | null = null;
    if (candidateRules && candidateRules.length) {
      // Compute discount amount for each candidate rule and pick the one that gives the largest absolute discount
      const computed = candidateRules.map((r) => {
        let discount = 0;
        if (r.type === 'percentage') {
          discount = unitPrice * (r.value / 100) * quantity;
        } else if (r.type === 'fixed') {
          // Treat fixed as absolute amount off per unit
          discount = r.value * quantity;
        } else if (r.type === 'buy-x-get-y') {
          // Not implemented: fallback to zero
          discount = 0;
        }
        return { rule: r, discount };
      });

      const best = computed.reduce((acc, cur) => (cur.discount > acc.discount ? cur : acc), computed[0]);
      if (best && best.discount > 0) {
        appliedDiscount = { ruleId: best.rule.id, type: best.rule.type, value: best.rule.value, amount: best.discount };
      }
    }

    let finalUnitPrice = unitPrice;
    let finalTotal = totalAmount;
    if (appliedDiscount) {
      finalTotal = Math.max(0, totalAmount - appliedDiscount.amount);
      finalUnitPrice = finalTotal / quantity;
    }
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

    if (finalTotal > maxLoanAmount) {
      return NextResponse.json(
        { error: `Insufficient limit. Item total ${finalTotal} exceeds available limit ${maxLoanAmount}.` },
        { status: 400 }
      );
    }

    await createAuditLog({
      actorId: 'system',
      action: 'BNPL_CHECKOUT_INITIATED',
      entity: 'ORDER',
      details: {
        borrowerId: data.borrowerId,
        productId: data.productId,
        itemId: data.itemId,
        variantId,
        optionValueIds: uniqueOptionValueIds,
        quantity,
        unitPrice,
        totalAmount,
        appliedDiscount,
      },
    });

    const result = await prisma.$transaction(async (tx) => {
      const loanApplication = await tx.loanApplication.create({
        data: {
          borrowerId: data.borrowerId,
          productId: data.productId,
          loanAmount: finalTotal,
          status: 'APPROVED_PENDING_MERCHANT_CONFIRMATION',
        },
      });

      const order = await tx.order.create({
        data: {
          borrowerId: data.borrowerId,
          merchantId: item.merchantId,
          status: 'PENDING_MERCHANT_CONFIRMATION',
          totalAmount: finalTotal,
          loanApplicationId: loanApplication.id,
          items: {
            create: {
              itemId: item.id,
              variantId: uniqueOptionValueIds.length ? null : variantId,
              quantity,
              unitPrice: finalUnitPrice,
              lineTotal: finalTotal,
              optionSelections: selectedOptionValues.length
                ? {
                    create: selectedOptionValues.map((v) => ({
                      optionValueId: v.id,
                      optionGroupName: v.groupName,
                      optionValueLabel: v.label,
                      priceDelta: v.priceDelta,
                    })),
                  }
                : undefined,
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

    return NextResponse.json({ ...result, appliedDiscount }, { status: 201 });
  } catch (error) {
    const errorMessage = error instanceof z.ZodError ? error.errors : (error as Error).message;
    console.error('POST /api/bnpl/checkout error:', error);
    return NextResponse.json({ error: errorMessage || 'Internal Server Error' }, { status: 500 });
  }
}
