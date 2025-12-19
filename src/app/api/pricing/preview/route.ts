import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const itemId = url.searchParams.get('itemId');
    const qtyParam = url.searchParams.get('qty') || '1';
    const optionValueIdsParam = url.searchParams.get('optionValueIds') || '';
    const quantity = parseInt(qtyParam, 10) || 1;
    const optionValueIds = optionValueIdsParam.split(',').filter(Boolean);

    if (!itemId) return NextResponse.json({ error: 'itemId required' }, { status: 400 });

    const item = await prisma.item.findUnique({ where: { id: itemId } });
    if (!item || item.status !== 'ACTIVE') return NextResponse.json({ error: 'Item not found' }, { status: 404 });

    let unitPrice = item.price;

    if (optionValueIds.length) {
      const values = await prisma.itemOptionValue.findMany({
        where: { id: { in: optionValueIds }, status: 'ACTIVE', group: { status: 'ACTIVE', itemId: item.id } },
        include: { group: true },
      });
      if (values.length !== optionValueIds.length) {
        return NextResponse.json({ error: 'One or more selected attributes were not found.' }, { status: 404 });
      }
      const deltaSum = values.reduce<number>((acc, v) => acc + (v.priceDelta || 0), 0);
      unitPrice = item.price + deltaSum;
    }

    const totalAmount = unitPrice * quantity;

    const now = new Date();
    const candidateRules = await prisma.discountRule.findMany({
      where: {
        AND: [
          { OR: [{ itemId: item.id }, { categoryId: item.categoryId }] },
          { OR: [{ startDate: null }, { startDate: { lte: now } }] },
          { OR: [{ endDate: null }, { endDate: { gte: now } }] },
          { OR: [{ minimumQuantity: null }, { minimumQuantity: { lte: quantity } }] },
        ],
      },
    });

    let appliedDiscount = null;
    if (candidateRules && candidateRules.length) {
      const computed = candidateRules.map((r) => {
        let discount = 0;
        if (r.type === 'percentage') discount = unitPrice * (r.value / 100) * quantity;
        else if (r.type === 'fixed') discount = r.value * quantity;
        else discount = 0;
        return { rule: r, discount };
      });
      const best = computed.reduce((acc, cur) => (cur.discount > acc.discount ? cur : acc), computed[0]);
      if (best && best.discount > 0) appliedDiscount = { ruleId: best.rule.id, type: best.rule.type, value: best.rule.value, amount: best.discount };
    }

    let finalUnitPrice = unitPrice;
    let finalTotal = totalAmount;
    if (appliedDiscount) {
      finalTotal = Math.max(0, totalAmount - appliedDiscount.amount);
      finalUnitPrice = finalTotal / quantity;
    }

    return NextResponse.json({ unitPrice, totalAmount, finalUnitPrice, finalTotal, appliedDiscount });
  } catch (err) {
    console.error('/api/pricing/preview error', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
