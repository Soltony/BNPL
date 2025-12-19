import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { z } from 'zod';
import { getUserFromSession } from '@/lib/user';

const itemUpsertSchema = z.object({
  id: z.string().optional(),
  merchantId: z.string(),
  categoryId: z.string(),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  price: z.number().nonnegative(),
  currency: z.string().min(1).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  stockQuantity: z.number().int().nonnegative().nullable().optional(),
  // Inventory per combination of option values (attributes) by stock location
  combinationInventoryLevels: z
    .array(
      z.object({
        // For create flow when option values don't exist yet; matched in transaction
        optionSelections: z
          .array(
            z.object({
              optionGroupName: z.string().min(1),
              optionValueLabel: z.string().min(1),
            })
          )
          .optional(),
        // For edit flow when option values already exist
        optionValueIds: z.array(z.string()).optional(),
        locationId: z.string(),
        quantityAvailable: z.number().int().nonnegative(),
      })
    )
    .optional(),
  optionGroups: z
    .array(
      z.object({
        id: z.string().optional(),
        name: z.string().min(1),
        status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
        isRequired: z.boolean().optional(),
        values: z
          .array(
            z.object({
              id: z.string().optional(),
              label: z.string().min(1),
              priceDelta: z.number(),
              status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
            })
          )
          .optional(),
      })
    )
    .optional(),
  variants: z
    .array(
      z.object({
        id: z.string().optional(),
        size: z.string().min(1).nullable().optional(),
        color: z.string().min(1).nullable().optional(),
        material: z.string().min(1).nullable().optional(),
        price: z.number().nonnegative(),
        status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
      })
    )
    .optional(),
  imageUrl: z.string().optional().nullable(),
  videoUrl: z.string().url().optional().nullable(),
});

export async function GET(req: NextRequest) {
  try {
    const user = await getUserFromSession();
    if (!user?.id) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    const merchantId = searchParams.get('merchantId');

    // If the caller is a merchant user, scope results to their merchant only
    const isMerchantUser = String(user.role || '').toLowerCase() === 'merchant';
    const scopedMerchantId = isMerchantUser ? user.merchantId : merchantId || undefined;

    if (id) {
      const item = await prisma.item.findUnique({
        where: { id },
        include: {
          merchant: true,
          category: true,
          variants: true,
          optionGroups: { include: { values: true } },
          inventoryLevels: { include: { location: true } },
          combinationInventoryLevels: { include: { location: true } },
        },
      });
      if (!item) return NextResponse.json({ error: 'Item not found' }, { status: 404 });
      if (scopedMerchantId && item.merchantId !== scopedMerchantId) {
        return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
      }
      return NextResponse.json(item);
    }

    const items = await prisma.item.findMany({
      where: scopedMerchantId ? { merchantId: scopedMerchantId } : undefined,
      include: {
        merchant: true,
        category: true,
        variants: true,
        optionGroups: { include: { values: true } },
        inventoryLevels: { include: { location: true } },
        combinationInventoryLevels: { include: { location: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json(items);
  } catch (err) {
    console.error('GET /api/admin/items error:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getUserFromSession();
    if (!user?.id) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const body = await req.json();
    const data = itemUpsertSchema.omit({ id: true }).parse(body);

    if (data.combinationInventoryLevels) {
      const seen = new Set<string>();
      for (const row of data.combinationInventoryLevels) {
        const sel = row.optionSelections || [];
        const key = `loc:${row.locationId}|sel:${sel.map((s) => `${s.optionGroupName}::${s.optionValueLabel}`).sort().join('|')}`;
        if (seen.has(key)) {
          return NextResponse.json({ error: 'Duplicate combination + location in combinationInventoryLevels' }, { status: 400 });
        }
        seen.add(key);
      }
    }

    // If merchant user, force merchantId to their merchant to prevent escalation
    const isMerchantUser = String(user.role || '').toLowerCase() === 'merchant';
    const merchantIdToUse = isMerchantUser ? user.merchantId : data.merchantId;

    const created = await prisma.$transaction(async (tx) => {
      const item = await tx.item.create({
        data: {
          merchantId: merchantIdToUse,
          categoryId: data.categoryId,
          name: data.name,
          description: data.description ?? undefined,
          price: data.price,
          imageUrl: data.imageUrl ?? undefined,
          videoUrl: data.videoUrl ?? undefined,
          currency: data.currency ?? 'ETB',
          status: data.status ?? 'ACTIVE',
          stockQuantity: data.stockQuantity ?? undefined,
          optionGroups: data.optionGroups?.length
            ? {
                create: data.optionGroups.map((g) => ({
                  name: g.name,
                  status: g.status ?? 'ACTIVE',
                  isRequired: g.isRequired ?? true,
                  values: g.values?.length
                    ? {
                        create: g.values.map((v) => ({
                          label: v.label,
                          priceDelta: v.priceDelta,
                          status: v.status ?? 'ACTIVE',
                        })),
                      }
                    : undefined,
                })),
              }
            : undefined,
          variants: data.variants?.length
            ? {
                create: data.variants.map((v) => ({
                  size: v.size ?? undefined,
                  color: v.color ?? undefined,
                  material: v.material ?? undefined,
                  price: v.price,
                  status: v.status ?? 'ACTIVE',
                })),
              }
            : undefined,
        },
        include: {
          optionGroups: { include: { values: true } },
        },
      });

      // Create combination inventory levels (matched by group name + label)
      if (data.combinationInventoryLevels?.length) {
        const byGroupAndLabel = new Map<string, { id: string; groupId: string }>();
        for (const g of item.optionGroups || []) {
          for (const v of (g as any).values || []) {
            byGroupAndLabel.set(`${g.name}::${v.label}`, { id: v.id, groupId: g.id });
          }
        }

        for (const row of data.combinationInventoryLevels) {
          const selections = row.optionSelections || [];
          if (!selections.length) throw new Error('optionSelections is required for combinationInventoryLevels on create');

          const groupSeen = new Set<string>();
          const optionValueIds: string[] = [];
          for (const s of selections) {
            const ov = byGroupAndLabel.get(`${s.optionGroupName}::${s.optionValueLabel}`);
            if (!ov) throw new Error(`No option value found for ${s.optionGroupName}: ${s.optionValueLabel}`);
            if (groupSeen.has(ov.groupId)) throw new Error('Only one value per attribute group is allowed in a combination');
            groupSeen.add(ov.groupId);
            optionValueIds.push(ov.id);
          }

          const sorted = [...new Set(optionValueIds)].sort();
          const combinationKey = sorted.join('|');

          await tx.combinationInventoryLevel.create({
            data: {
              itemId: item.id,
              locationId: row.locationId,
              combinationKey,
              optionValueIds: JSON.stringify(sorted),
              quantityAvailable: row.quantityAvailable,
              reservedQuantity: 0,
            },
          });
        }
      }

      return tx.item.findUnique({
        where: { id: item.id },
        include: {
          merchant: true,
          category: true,
          variants: true,
          optionGroups: { include: { values: true } },
          inventoryLevels: { include: { location: true } },
          combinationInventoryLevels: { include: { location: true } },
        },
      });
    });

    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    const msg = err instanceof z.ZodError ? err.errors : (err as Error).message;
    console.error('POST /api/admin/items error:', err);
    return NextResponse.json({ error: msg || 'Internal Server Error' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const user = await getUserFromSession();
    if (!user?.id) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const body = await req.json();
    const data = itemUpsertSchema.parse(body);
    if (!data.id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

    if (data.combinationInventoryLevels) {
      const seen = new Set<string>();
      for (const row of data.combinationInventoryLevels) {
        if (!row.optionValueIds?.length) {
          return NextResponse.json({ error: 'optionValueIds is required for combinationInventoryLevels on edit' }, { status: 400 });
        }
        const combinationKey = [...new Set(row.optionValueIds)].sort().join('|');
        const key = `${combinationKey}|${row.locationId}`;
        if (seen.has(key)) {
          return NextResponse.json({ error: 'Duplicate combination + locationId in combinationInventoryLevels' }, { status: 400 });
        }
        seen.add(key);
      }
    }

    // Prevent merchants from updating items that don't belong to them
    const isMerchantUser = String(user.role || '').toLowerCase() === 'merchant';
    if (isMerchantUser) {
      const existing = await prisma.item.findUnique({ where: { id: data.id } });
      if (!existing) return NextResponse.json({ error: 'Item not found' }, { status: 404 });
      if (existing.merchantId !== user.merchantId) return NextResponse.json({ error: 'Not authorized to modify this item' }, { status: 403 });
      // ensure merchantId cannot be changed
      data.merchantId = existing.merchantId;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const updatedItem = await tx.item.update({
        where: { id: data.id },
        data: {
          merchantId: data.merchantId,
          categoryId: data.categoryId,
          name: data.name,
          description: data.description ?? undefined,
          price: data.price,
          imageUrl: data.imageUrl ?? undefined,
          videoUrl: data.videoUrl ?? undefined,
          currency: data.currency ?? 'ETB',
          status: data.status,
          stockQuantity: data.stockQuantity ?? undefined,
        },
      });

      if (data.optionGroups) {
        const existingGroups = await tx.itemOptionGroup.findMany({
          where: { itemId: data.id },
          select: { id: true },
        });
        const existingGroupIds = new Set(existingGroups.map((g) => g.id));
        const incomingGroupIds = new Set(data.optionGroups.map((g) => g.id).filter(Boolean) as string[]);

        const groupsToDelete = [...existingGroupIds].filter((gid) => !incomingGroupIds.has(gid));
        if (groupsToDelete.length) {
          await tx.itemOptionGroup.deleteMany({ where: { id: { in: groupsToDelete } } });
        }

        for (const g of data.optionGroups) {
          let groupId: string;
          if (g.id && existingGroupIds.has(g.id)) {
            const updatedGroup = await tx.itemOptionGroup.update({
              where: { id: g.id },
              data: {
                name: g.name,
                status: g.status ?? undefined,
                isRequired: g.isRequired ?? undefined,
              },
            });
            groupId = updatedGroup.id;
          } else {
            const createdGroup = await tx.itemOptionGroup.create({
              data: {
                itemId: data.id,
                name: g.name,
                status: g.status ?? 'ACTIVE',
                isRequired: g.isRequired ?? true,
              },
            });
            groupId = createdGroup.id;
          }

          if (g.values) {
            const existingValues = await tx.itemOptionValue.findMany({
              where: { groupId },
              select: { id: true },
            });
            const existingValueIds = new Set(existingValues.map((v) => v.id));
            const incomingValueIds = new Set(g.values.map((v) => v.id).filter(Boolean) as string[]);

            const valuesToDelete = [...existingValueIds].filter((vid) => !incomingValueIds.has(vid));
            if (valuesToDelete.length) {
              await tx.itemOptionValue.deleteMany({ where: { id: { in: valuesToDelete } } });
            }

            for (const v of g.values) {
              if (v.id && existingValueIds.has(v.id)) {
                await tx.itemOptionValue.update({
                  where: { id: v.id },
                  data: {
                    label: v.label,
                    priceDelta: v.priceDelta,
                    status: v.status ?? undefined,
                  },
                });
              } else {
                await tx.itemOptionValue.create({
                  data: {
                    groupId,
                    label: v.label,
                    priceDelta: v.priceDelta,
                    status: v.status ?? 'ACTIVE',
                  },
                });
              }
            }
          }
        }
      }

      if (data.variants) {
        const existing = await tx.itemVariant.findMany({
          where: { itemId: data.id },
          select: { id: true },
        });
        const existingIds = new Set(existing.map((e) => e.id));
        const incomingIds = new Set(data.variants.map((v) => v.id).filter(Boolean) as string[]);

        // delete removed variants
        const toDelete = [...existingIds].filter((id) => !incomingIds.has(id));
        if (toDelete.length) {
          await tx.itemVariant.deleteMany({ where: { id: { in: toDelete } } });
        }

        for (const v of data.variants) {
          if (v.id && existingIds.has(v.id)) {
            await tx.itemVariant.update({
              where: { id: v.id },
              data: {
                size: v.size ?? undefined,
                color: v.color ?? undefined,
                material: v.material ?? undefined,
                price: v.price,
                status: v.status ?? undefined,
              },
            });
          } else {
            await tx.itemVariant.create({
              data: {
                itemId: data.id,
                size: v.size ?? undefined,
                color: v.color ?? undefined,
                material: v.material ?? undefined,
                price: v.price,
                status: v.status ?? 'ACTIVE',
              },
            });
          }
        }
      }

      if (data.combinationInventoryLevels) {
        // Validate option values belong to the item and no duplicates per group in any combination
        const incoming = data.combinationInventoryLevels.map((r) => ({
          locationId: r.locationId,
          quantityAvailable: r.quantityAvailable,
          optionValueIds: [...new Set(r.optionValueIds || [])],
        }));

        const allOptionValueIds = [...new Set(incoming.flatMap((r) => r.optionValueIds))];
        const values = await tx.itemOptionValue.findMany({
          where: {
            id: { in: allOptionValueIds },
            group: { itemId: data.id },
          },
          select: { id: true, groupId: true },
        });
        if (values.length !== allOptionValueIds.length) {
          throw new Error('One or more option values do not belong to this item');
        }
        const groupByValueId = new Map(values.map((v) => [v.id, v.groupId] as const));

        const normalizedIncoming = incoming.map((r) => {
          const groupSeen = new Set<string>();
          for (const ovId of r.optionValueIds) {
            const gid = groupByValueId.get(ovId);
            if (!gid) throw new Error('Invalid option value');
            if (groupSeen.has(gid)) throw new Error('Only one value per attribute group is allowed in a combination');
            groupSeen.add(gid);
          }
          const sorted = [...new Set(r.optionValueIds)].sort();
          return {
            locationId: r.locationId,
            quantityAvailable: r.quantityAvailable,
            optionValueIds: sorted,
            combinationKey: sorted.join('|'),
          };
        });

        const existing = await tx.combinationInventoryLevel.findMany({
          where: { itemId: data.id },
          select: { id: true, locationId: true, combinationKey: true },
        });
        const existingByKey = new Map(existing.map((r) => [`${r.locationId}|${r.combinationKey}`, r] as const));
        const incomingKeys = new Set(normalizedIncoming.map((r) => `${r.locationId}|${r.combinationKey}`));

        const toDelete = existing.filter((r) => !incomingKeys.has(`${r.locationId}|${r.combinationKey}`)).map((r) => r.id);
        if (toDelete.length) await tx.combinationInventoryLevel.deleteMany({ where: { id: { in: toDelete } } });

        for (const row of normalizedIncoming) {
          const key = `${row.locationId}|${row.combinationKey}`;
          const ex = existingByKey.get(key);
          if (ex) {
            await tx.combinationInventoryLevel.update({
              where: { id: ex.id },
              data: {
                quantityAvailable: row.quantityAvailable,
                optionValueIds: JSON.stringify(row.optionValueIds),
              },
            });
          } else {
            await tx.combinationInventoryLevel.create({
              data: {
                itemId: data.id,
                locationId: row.locationId,
                combinationKey: row.combinationKey,
                optionValueIds: JSON.stringify(row.optionValueIds),
                quantityAvailable: row.quantityAvailable,
                reservedQuantity: 0,
              },
            });
          }
        }
      }

      return tx.item.findUnique({
        where: { id: updatedItem.id },
        include: {
          merchant: true,
          category: true,
          variants: true,
          optionGroups: { include: { values: true } },
          inventoryLevels: { include: { location: true } },
          combinationInventoryLevels: { include: { location: true } },
        },
      });
    });

    return NextResponse.json(updated);
  } catch (err) {
    const msg = err instanceof z.ZodError ? err.errors : (err as Error).message;
    console.error('PUT /api/admin/items error:', err);
    return NextResponse.json({ error: msg || 'Internal Server Error' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = await getUserFromSession();
    if (!user?.id) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
    // Prevent merchant users from deleting items belonging to other merchants
    const isMerchantUser = String(user.role || '').toLowerCase() === 'merchant';
    if (isMerchantUser) {
      const existing = await prisma.item.findUnique({ where: { id } });
      if (!existing) return NextResponse.json({ error: 'Item not found' }, { status: 404 });
      if (existing.merchantId !== user.merchantId) return NextResponse.json({ error: 'Not authorized to delete this item' }, { status: 403 });
    }

    await prisma.item.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/admin/items error:', err);
    return NextResponse.json({ error: (err as Error).message || 'Internal Server Error' }, { status: 500 });
  }
}
