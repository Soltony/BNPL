

'use server';

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getUserFromSession } from '@/lib/user';
import { getSession } from '@/lib/session';
import { z, ZodError } from 'zod';
import { validationErrorResponse, handleApiError } from '@/lib/error-utils';
import { createAuditLog } from '@/lib/audit-log';
import ExcelJS from 'exceljs';
import bcrypt from 'bcryptjs';
import { toCamelCase } from '@/lib/utils';
import { Prisma } from '@prisma/client';

const approvalSchema = z.object({
  changeId: z.string(),
  approved: z.boolean(),
  rejectionReason: z.string().optional(),
});

const defaultLedgerAccounts = [
    // Assets (Receivables)
    { name: 'Principal Receivable', type: 'Receivable', category: 'Principal' },
    { name: 'Interest Receivable', type: 'Receivable', category: 'Interest' },
    { name: 'Service Fee Receivable', type: 'Receivable', category: 'ServiceFee' },
    { name: 'Penalty Receivable', type: 'Receivable', category: 'Penalty' },
    { name: 'Tax Receivable', type: 'Receivable', category: 'Tax' },
    // Cash / Received
    { name: 'Principal Received', type: 'Received', category: 'Principal' },
    { name: 'Interest Received', type: 'Received', category: 'Interest' },
    { name: 'Service Fee Received', type: 'Received', category: 'ServiceFee' },
    { name: 'Penalty Received', type: 'Received', category: 'Penalty' },
    { name: 'Tax Received', type: 'Received', category: 'Tax' },
    // Income
    { name: 'Interest Income', type: 'Income', category: 'Interest' },
    { name: 'Service Fee Income', type: 'Income', category: 'ServiceFee' },
    { name: 'Penalty Income', type: 'Income', category: 'Penalty' },
];

async function applyMerchantItemCreate(data: any) {
    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const item = await tx.item.create({
            data: {
                merchantId: data.merchantId,
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
                        create: data.optionGroups.map((g: any) => ({
                            name: g.name,
                            status: g.status ?? 'ACTIVE',
                            isRequired: g.isRequired ?? true,
                            values: g.values?.length
                                ? {
                                    create: g.values.map((v: any) => ({
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
                        create: data.variants.map((v: any) => ({
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
            for (const g of (item as any).optionGroups || []) {
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
    });
}

async function applyMerchantItemUpdate(itemId: string, data: any) {
    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.item.update({
            where: { id: itemId },
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
            const existingGroups = await tx.itemOptionGroup.findMany({ where: { itemId }, select: { id: true } });
            const existingGroupIds = new Set(existingGroups.map((g) => g.id));
            const incomingGroupIds = new Set((data.optionGroups || []).map((g: any) => g.id).filter(Boolean) as string[]);

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
                            itemId,
                            name: g.name,
                            status: g.status ?? 'ACTIVE',
                            isRequired: g.isRequired ?? true,
                        },
                    });
                    groupId = createdGroup.id;
                }

                if (g.values) {
                    const existingValues = await tx.itemOptionValue.findMany({ where: { groupId }, select: { id: true } });
                    const existingValueIds = new Set(existingValues.map((v) => v.id));
                    const incomingValueIds = new Set((g.values || []).map((v: any) => v.id).filter(Boolean) as string[]);

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
            const existing = await tx.itemVariant.findMany({ where: { itemId }, select: { id: true } });
            const existingIds = new Set(existing.map((e) => e.id));
            const incomingIds = new Set((data.variants || []).map((v: any) => v.id).filter(Boolean) as string[]);

            const toDelete = [...existingIds].filter((vid) => !incomingIds.has(vid));
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
                            itemId,
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
            const incoming = (data.combinationInventoryLevels || []).map((r: any) => ({
                locationId: r.locationId,
                quantityAvailable: r.quantityAvailable,
                optionValueIds: [...new Set(r.optionValueIds || [])],
            }));

            const allOptionValueIds = [...new Set(incoming.flatMap((r: any) => r.optionValueIds))];
            const values = await tx.itemOptionValue.findMany({
                where: {
                    id: { in: allOptionValueIds },
                    group: { itemId },
                },
                select: { id: true, groupId: true },
            });
            if (values.length !== allOptionValueIds.length) {
                throw new Error('One or more option values do not belong to this item');
            }
            const groupByValueId = new Map(values.map((v) => [v.id, v.groupId] as const));

            const normalizedIncoming = incoming.map((r: any) => {
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
                where: { itemId },
                select: { id: true, locationId: true, combinationKey: true },
            });
            const existingByKey = new Map(existing.map((r) => [`${r.locationId}|${r.combinationKey}`, r] as const));
            const incomingKeys = new Set(normalizedIncoming.map((r) => `${r.locationId}|${r.combinationKey}`));

            const toDelete = existing
                .filter((r) => !incomingKeys.has(`${r.locationId}|${r.combinationKey}`))
                .map((r) => r.id);
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
                            itemId,
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
    });
}


async function applyDataProvisioningUpload(change: any, data: any) {
    const { fileContent, fileName, configId } = data.created;

    const config = await prisma.dataProvisioningConfig.findUnique({
        where: { id: configId }
    });
    if (!config) throw new Error('Data Provisioning Config not found.');

    const buffer = Buffer.from(fileContent, 'base64');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const worksheet = workbook.worksheets[0];

    const columnCount = worksheet.columnCount || 0;
    const jsonData: any[][] = [];
    worksheet.eachRow((row) => {
        const rowArr: any[] = [];
        for (let i = 1; i <= columnCount; i++) {
            rowArr.push(row.getCell(i).value);
        }
        jsonData.push(rowArr);
    });

    const originalHeaders = jsonData.length > 0 ? jsonData[0].map(h => String(h)) : [];
    const camelCaseHeaders = originalHeaders.map(toCamelCase);
    const rows = jsonData.length > 1 ? jsonData.slice(1) : [];

    await prisma.$transaction(async (tx) => {
        const newUpload = await tx.dataProvisioningUpload.create({
            data: {
                configId: configId,
                fileName: fileName,
                rowCount: rows.length,
                uploadedBy: change.createdById, // User who requested the change
            }
        });

        const idColumnConfig = JSON.parse(config.columns as string).find((c: any) => c.isIdentifier);
        if (!idColumnConfig) throw new Error('No identifier column found in config');
        const idColumnCamelCase = toCamelCase(idColumnConfig.name);

        for (const row of rows) {
            const newRowData: { [key: string]: any } = {};
            camelCaseHeaders.forEach((header, index) => { newRowData[header] = row[index]; });
            
            const borrowerId = String(newRowData[idColumnCamelCase]);
            if (!borrowerId) continue;

            await tx.borrower.upsert({ where: { id: borrowerId }, update: {}, create: { id: borrowerId } });

            const compoundId = { borrowerId, configId, uploadId: newUpload.id };

            const existingData = await tx.provisionedData.findUnique({
                where: { borrowerId_configId_uploadId: compoundId },
            });
            
            let mergedData = newRowData;
            if (existingData?.data) {
                mergedData = { ...JSON.parse(existingData.data as string), ...newRowData };
            }

            await tx.provisionedData.upsert({
                where: { borrowerId_configId_uploadId: compoundId },
                update: { data: JSON.stringify(mergedData) },
                create: { ...compoundId, data: JSON.stringify(mergedData) }
            });
        }
    });
}


async function applyEligibilityList(change: any, data: any) {
    const { productId, fileContent, configId, fileName } = data.created;
    
    const config = await prisma.dataProvisioningConfig.findUnique({ where: { id: configId } });
    if (!config) throw new Error('Data Provisioning Config not found.');

    const buffer = Buffer.from(fileContent, 'base64');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const worksheet = workbook.worksheets[0];

    const columnCount = worksheet.columnCount || 0;
    const jsonData: any[][] = [];
    worksheet.eachRow((row) => {
        const rowArr: any[] = [];
        for (let i = 1; i <= columnCount; i++) {
            rowArr.push(row.getCell(i).value);
        }
        jsonData.push(rowArr);
    });

    const originalHeaders = jsonData.length > 0 ? jsonData[0].map(h => String(h)) : [];
    const rows = jsonData.length > 1 ? jsonData.slice(1) : [];
    
    const idColumnConfig = JSON.parse(config.columns as string).find((c: any) => c.isIdentifier);
    if (!idColumnConfig) throw new Error('No identifier column found in config');
    
    const idColumnName = idColumnConfig.name;
    const idColumnIndex = originalHeaders.findIndex(h => h === idColumnName);
    if (idColumnIndex === -1) throw new Error(`Identifier column "${idColumnName}" not found in uploaded file.`);
    
    const borrowerIds = rows.map(row => String(row[idColumnIndex]).trim()).filter(Boolean);

    if (borrowerIds.length === 0) {
        throw new Error("No identifiers found in the uploaded file.");
    }
    
    const filterString = borrowerIds.join(',');
    const filterObject = JSON.stringify({ [idColumnName]: filterString });

    await prisma.$transaction(async (tx) => {
        const newUpload = await tx.dataProvisioningUpload.create({
            data: {
                configId: configId,
                fileName: fileName,
                rowCount: rows.length,
                uploadedBy: change.createdById,
            }
        });

        for (const row of rows) {
             const rowData: { [key: string]: any } = {};
             originalHeaders.forEach((header, index) => {
                 rowData[header] = row[index];
             });

            const borrowerId = String(rowData[idColumnName]);
            if (!borrowerId) continue;
            
             await tx.borrower.upsert({
                 where: { id: borrowerId },
                 update: {},
                 create: { id: borrowerId }
             });

            await tx.provisionedData.upsert({
                where: { borrowerId_configId_uploadId: { borrowerId, configId, uploadId: newUpload.id } },
                update: { data: JSON.stringify(rowData) },
                create: {
                    borrowerId,
                    configId,
                    uploadId: newUpload.id,
                    data: JSON.stringify(rowData)
                }
            });
        }
        
        await tx.loanProduct.update({
            where: { id: productId },
            data: {
                eligibilityUploadId: newUpload.id,
                eligibilityFilter: filterObject,
            }
        });
    });
}


// Main function to apply an approved change
async function applyChange(change: any) {
  const { entityType, entityId, changeType, payload } = change;
  const data = JSON.parse(payload);

  switch (entityType) {
    case 'EligibilityList':
        if (changeType === 'CREATE') {
            await applyEligibilityList(change, data);
        }
        break;
    case 'DataProvisioningConfig':
        if (changeType === 'UPDATE') {
            await prisma.dataProvisioningConfig.update({
                where: { id: entityId },
                data: {
                    name: data.updated.name,
                    columns: JSON.stringify(data.updated.columns),
                }
            });
        } else if (changeType === 'CREATE') {
            await prisma.dataProvisioningConfig.create({
                data: {
                    ...data.created,
                    providerId: data.created.providerId,
                    columns: JSON.stringify(data.created.columns),
                }
            });
        } else if (changeType === 'DELETE') {
            await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
                await tx.loanProduct.updateMany({
                    where: { dataProvisioningConfigId: entityId },
                    data: { dataProvisioningConfigId: null, eligibilityUploadId: null, eligibilityFilter: null }
                });

                await tx.provisionedData.deleteMany({ where: { configId: entityId } });
                await tx.dataProvisioningUpload.deleteMany({ where: { configId: entityId } });
                await tx.dataProvisioningConfig.delete({ where: { id: entityId } });
            });
        }
      break;
    case 'DataProvisioningUpload':
        if (changeType === 'CREATE') {
            await applyDataProvisioningUpload(change, data);
        }
      break;
    case 'LoanProvider':
        if (changeType === 'UPDATE') {
            const { id, products, dataProvisioningConfigs, termsAndConditions, ledgerAccounts, ...providerData } = data.updated;

            // Remove nested relation arrays or other non-scalar fields before updating
            const updateData: any = { ...providerData, status: 'Active' };
            for (const k of Object.keys(updateData)) {
                if (Array.isArray(updateData[k])) {
                    delete updateData[k];
                }
            }

            await prisma.loanProvider.update({
                where: { id: entityId },
                data: updateData,
            });
        } else if (changeType === 'CREATE') {
            await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
                const providerToCreate = {
                    ...data.created,
                    initialBalance: data.created.startingCapital,
                    status: 'Active',
                };
                const newProvider = await tx.loanProvider.create({
                    data: providerToCreate,
                });
                
                const accountsToCreate = defaultLedgerAccounts.map(acc => ({
                    ...acc,
                    providerId: newProvider.id,
                }));

                await tx.ledgerAccount.createMany({
                    data: accountsToCreate,
                });

                const desiredColumns = [
                    { id: 'col-ext-0', name: 'AccountNumber', type: 'string', isIdentifier: true, options: [] },
                    { id: 'col-ext-1', name: 'AccountOpeningDate', type: 'string', isIdentifier: false, options: [] },
                    { id: 'col-ext-2', name: 'CustomerName', type: 'string', isIdentifier: false, options: [] },
                    { id: 'col-ext-3', name: 'Country', type: 'string', isIdentifier: false, options: [] },
                    { id: 'col-ext-4', name: 'Street', type: 'string', isIdentifier: false, options: [] },
                    { id: 'col-ext-5', name: 'City', type: 'string', isIdentifier: false, options: [] },
                    { id: 'col-ext-6', name: 'Nationality', type: 'string', isIdentifier: false, options: [] },
                    { id: 'col-ext-7', name: 'Residence', type: 'string', isIdentifier: false, options: [] },
                    { id: 'col-ext-8', name: 'NationalId', type: 'string', isIdentifier: false, options: [] },
                    { id: 'col-ext-9', name: 'ResidenceRegion', type: 'string', isIdentifier: false, options: [] },
                    { id: 'col-ext-10', name: 'Gender', type: 'string', isIdentifier: false, options: [] },
                    { id: 'col-ext-11', name: 'DateOfBirth', type: 'string', isIdentifier: false, options: [] },
                    { id: 'col-ext-12', name: 'MaritalStatus', type: 'string', isIdentifier: false, options: [] },
                    { id: 'col-ext-13', name: 'Occupation', type: 'string', isIdentifier: false, options: [] },
                    { id: 'col-ext-14', name: 'EmployersName', type: 'string', isIdentifier: false, options: [] },
                    { id: 'col-ext-15', name: 'NetMonthlyIncome', type: 'number', isIdentifier: false, options: [] },
                    { id: 'col-ext-16', name: 'Woreda', type: 'string', isIdentifier: false, options: [] },
                    { id: 'col-ext-17', name: 'MotherName', type: 'string', isIdentifier: false, options: [] },
                    { id: 'col-ext-18', name: 'SubCity', type: 'string', isIdentifier: false, options: [] }
                ];

                try {
                    await tx.dataProvisioningConfig.create({ data: { providerId: newProvider.id, name: 'ExternalCustomerInfo', columns: JSON.stringify(desiredColumns) } });
                } catch (e) {
                    // ignore create conflicts
                }

                return newProvider;
            });
        }
        else if (changeType === 'DELETE') {
            const productCount = await prisma.loanProduct.count({ where: { providerId: entityId } });
            if (productCount > 0) {
                throw new Error('Cannot delete provider with associated products. Remove or reassign products before approving deletion.');
            }

            // Remove any DataProvisioningConfig and its dependent rows for this provider
            await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
                const configs = await tx.dataProvisioningConfig.findMany({ where: { providerId: entityId }, select: { id: true } });
                const configIds = configs.map(c => c.id);

                if (configIds.length > 0) {
                    await tx.loanProduct.updateMany({
                        where: { dataProvisioningConfigId: { in: configIds } },
                        data: { dataProvisioningConfigId: null, eligibilityUploadId: null, eligibilityFilter: null }
                    });

                    await tx.provisionedData.deleteMany({ where: { configId: { in: configIds } } });
                    await tx.dataProvisioningUpload.deleteMany({ where: { configId: { in: configIds } } });
                    await tx.dataProvisioningConfig.deleteMany({ where: { id: { in: configIds } } });
                }

                await tx.loanProvider.delete({ where: { id: entityId } });
            });
        }
      break;
    case 'Branch':
        // Branch is used as a wrapper for several admin sub-entities (Merchant, MerchantUser, ProductCategory, StockLocation, InventoryLevel)
        // Payload shape expected: { created?: { type: string, data: any }, updated?: { type: string, data: any }, original?: { type: string, id?: string } }
        {
            const inner = data.created || data.updated || data.original || {};
            const subtype = inner.type || (typeof inner === 'string' ? inner : null);
            const payloadData = inner.data || inner;

            if (!subtype) {
                throw new Error('Missing subtype for Branch change');
            }

            switch (subtype) {
                case 'Merchant':
                    if (changeType === 'CREATE') {
                        await prisma.merchant.create({ data: payloadData });
                    } else if (changeType === 'UPDATE') {
                        await prisma.merchant.update({ where: { id: entityId! }, data: payloadData });
                    } else if (changeType === 'DELETE') {
                        await prisma.merchant.delete({ where: { id: entityId! } });
                    }
                    break;
                case 'ProductCategory':
                    if (changeType === 'CREATE') {
                        await prisma.productCategory.create({ data: payloadData });
                    } else if (changeType === 'UPDATE') {
                        await prisma.productCategory.update({ where: { id: entityId! }, data: payloadData });
                    } else if (changeType === 'DELETE') {
                        await prisma.productCategory.delete({ where: { id: entityId! } });
                    }
                    break;
                case 'StockLocation':
                    if (changeType === 'CREATE') {
                        await prisma.stockLocation.create({ data: payloadData });
                    } else if (changeType === 'UPDATE') {
                        await prisma.stockLocation.update({ where: { id: entityId! }, data: payloadData });
                    } else if (changeType === 'DELETE') {
                        await prisma.stockLocation.delete({ where: { id: entityId! } });
                    }
                    break;
                case 'InventoryLevel':
                    // payloadData may use variantId or itemId; map variantId -> itemId if needed
                    const invData: any = { ...payloadData };
                    if (!invData.itemId && invData.variantId) {
                        invData.itemId = invData.variantId;
                        delete invData.variantId;
                    }
                    if (changeType === 'CREATE') {
                        await prisma.inventoryLevel.create({ data: { itemId: invData.itemId, locationId: invData.locationId, quantityAvailable: invData.quantityAvailable, reservedQuantity: invData.reservedQuantity ?? 0, lowStockThreshold: invData.lowStockThreshold ?? undefined } });
                    } else if (changeType === 'UPDATE') {
                        await prisma.inventoryLevel.update({ where: { id: entityId! }, data: { itemId: invData.itemId, locationId: invData.locationId, quantityAvailable: invData.quantityAvailable, reservedQuantity: invData.reservedQuantity ?? 0, lowStockThreshold: invData.lowStockThreshold ?? null } });
                    } else if (changeType === 'DELETE') {
                        await prisma.inventoryLevel.delete({ where: { id: entityId! } });
                    }
                    break;
                case 'MerchantUser':
                    if (changeType === 'CREATE') {
                        // create a user with role 'merchant'
                        const info = payloadData || {};
                        let role = await prisma.role.findUnique({ where: { name: 'merchant' } });
                        if (!role) {
                            // ensure a merchant role exists to avoid hard failures during approvals
                            role = await prisma.role.create({ data: { name: 'merchant', permissions: JSON.stringify({}) } });
                        }

                        const nowSuffix = Date.now().toString().slice(-6);
                        const safeEmail = info.email || `merchant+${nowSuffix}@example.com`;
                        const safePhone = info.phone || `000${nowSuffix}`;
                        const rawPassword = info.password || Math.random().toString(36).slice(2, 10);
                        const hashed = await bcrypt.hash(rawPassword, 10);

                        await prisma.user.create({ data: { fullName: info.fullName, email: safeEmail, phoneNumber: safePhone, password: hashed, passwordChangeRequired: true, status: 'Active', roleId: role.id, merchantId: info.merchantId ?? undefined } });
                    } else if (changeType === 'UPDATE') {
                        const info = payloadData || {};
                        await prisma.user.update({ where: { id: entityId! }, data: { fullName: info.fullName, email: info.email, phoneNumber: info.phone } });
                    } else if (changeType === 'DELETE') {
                        await prisma.user.delete({ where: { id: entityId! } });
                    }
                    break;
                default:
                    throw new Error(`Unknown branch subtype for approval: ${subtype}`);
            }
        }
      break;

    case 'Merchants':
        // Wrapper for Merchants module operations (excluding Orders)
        // Payload shape expected: { created?: { type: string, data: any }, updated?: { type: string, data: any }, original?: { type: string, data: any } }
        {
            const inner = data.created || data.updated || data.original || {};
            const subtype = inner.type || null;
            const payloadData = inner.data || inner;

            if (!subtype) {
                throw new Error('Missing subtype for Merchants change');
            }

            switch (subtype) {
                case 'StockLocation':
                    if (changeType === 'CREATE') {
                        await prisma.stockLocation.create({ data: payloadData });
                    } else if (changeType === 'UPDATE') {
                        await prisma.stockLocation.update({ where: { id: entityId! }, data: payloadData });
                    } else if (changeType === 'DELETE') {
                        await prisma.stockLocation.delete({ where: { id: entityId! } });
                    }
                    break;
                case 'DiscountRule':
                    if (changeType === 'CREATE') {
                        await prisma.discountRule.create({
                            data: {
                                type: payloadData.type,
                                value: payloadData.value,
                                startDate: payloadData.startDate ? new Date(payloadData.startDate) : undefined,
                                endDate: payloadData.endDate ? new Date(payloadData.endDate) : undefined,
                                itemId: payloadData.itemId ?? undefined,
                                categoryId: payloadData.categoryId ?? undefined,
                                minimumQuantity: payloadData.minimumQuantity ?? undefined,
                            },
                        });
                    } else if (changeType === 'UPDATE') {
                        await prisma.discountRule.update({
                            where: { id: entityId! },
                            data: {
                                type: payloadData.type,
                                value: payloadData.value,
                                startDate: payloadData.startDate ? new Date(payloadData.startDate) : null,
                                endDate: payloadData.endDate ? new Date(payloadData.endDate) : null,
                                itemId: payloadData.itemId ?? null,
                                categoryId: payloadData.categoryId ?? null,
                                minimumQuantity: payloadData.minimumQuantity ?? null,
                            },
                        });
                    } else if (changeType === 'DELETE') {
                        await prisma.discountRule.delete({ where: { id: entityId! } });
                    }
                    break;
                case 'Item':
                    if (changeType === 'CREATE') {
                        await applyMerchantItemCreate(payloadData);
                    } else if (changeType === 'UPDATE') {
                        await applyMerchantItemUpdate(entityId as string, payloadData);
                    } else if (changeType === 'DELETE') {
                        await prisma.item.delete({ where: { id: entityId as string } });
                    }
                    break;
                default:
                    throw new Error(`Unknown Merchants subtype for approval: ${subtype}`);
            }
        }
      break;
    case 'LoanProduct':
        if (changeType === 'UPDATE') {
            const { loanAmountTiers, eligibilityUpload, ...restOfUpdateData } = data.updated;
            // Keep product disabled even after an approved update per requested policy
            const updateData = { ...restOfUpdateData, status: 'Disabled' };

            if (updateData.serviceFee && typeof updateData.serviceFee === 'object') {
                updateData.serviceFee = JSON.stringify(updateData.serviceFee);
            }
            if (updateData.dailyFee && typeof updateData.dailyFee === 'object') {
                updateData.dailyFee = JSON.stringify(updateData.dailyFee);
            }
            if (updateData.penaltyRules && Array.isArray(updateData.penaltyRules)) {
                updateData.penaltyRules = JSON.stringify(updateData.penaltyRules);
            }
            
            await prisma.$transaction(async (tx) => {
                await tx.loanProduct.update({
                    where: { id: entityId },
                    data: updateData,
                });

                await tx.loanAmountTier.deleteMany({ where: { productId: entityId } });
                if (loanAmountTiers && Array.isArray(loanAmountTiers) && loanAmountTiers.length > 0) {
                    await tx.loanAmountTier.createMany({
                        data: loanAmountTiers.map((tier: any) => ({
                            productId: entityId,
                            fromScore: parseInt(String(tier.fromScore), 10),
                            toScore: parseInt(String(tier.toScore), 10),
                            loanAmount: parseInt(String(tier.loanAmount), 10),
                        })),
                    });
                }
            });

        } else if (changeType === 'CREATE') {
            const productToCreate = {
                ...data.created,
                status: 'Disabled',
                serviceFee: JSON.stringify(data.created.serviceFee || { type: 'percentage', value: 0 }),
                dailyFee: JSON.stringify(data.created.dailyFee || { type: 'percentage', value: 0, calculationBase: 'principal' }),
                penaltyRules: JSON.stringify(data.created.penaltyRules || []),
            };
            await prisma.loanProduct.create({
                data: productToCreate
            });
        } else if (changeType === 'DELETE') {
            await prisma.loanProduct.delete({ where: { id: entityId } });
        }
      break;
    case 'LoanCycleConfig':
        if (changeType === 'UPDATE') {
            const prodId = entityId;
            const updated = data.updated || {};
            await prisma.loanCycleConfig.updateMany({ where: { productId: prodId }, data: {
                metric: updated.metric,
                enabled: typeof updated.enabled === 'boolean' ? updated.enabled : true,
                cycleRanges: updated.cycleRanges ? JSON.stringify(updated.cycleRanges) : undefined,
                grades: updated.grades ? JSON.stringify(updated.grades) : undefined,
            }});
        } else if (changeType === 'CREATE') {
            const prodId = entityId;
            const created = data.created || {};
            await prisma.loanCycleConfig.create({ data: {
                productId: prodId as string,
                metric: created.metric,
                enabled: typeof created.enabled === 'boolean' ? created.enabled : true,
                cycleRanges: created.cycleRanges ? JSON.stringify(created.cycleRanges) : JSON.stringify([]),
                grades: created.grades ? JSON.stringify(created.grades) : JSON.stringify([]),
            }});
        } else if (changeType === 'DELETE') {
            await prisma.loanCycleConfig.deleteMany({ where: { productId: entityId } });
        }
      break;
    case 'ScoringRules':
        await prisma.$transaction(async (tx) => {
            const historyRecord = await tx.scoringConfigurationHistory.create({
                data: {
                    providerId: entityId,
                    parameters: JSON.stringify(data.updated),
                },
            });

            if (data.appliedProductIds && data.appliedProductIds.length > 0) {
                await tx.scoringConfigurationProduct.createMany({
                    data: data.appliedProductIds.map((productId: string) => ({
                        configId: historyRecord.id,
                        productId: productId,
                        assignedBy: change.createdById, 
                    })),
                });
            }

            await tx.scoringParameter.deleteMany({ where: { providerId: entityId } });
            for (const param of data.updated) {
                await tx.scoringParameter.create({
                    data: {
                        providerId: entityId,
                        name: param.name,
                        weight: param.weight,
                        rules: {
                            create: param.rules.map((rule: any) => ({
                                field: rule.field,
                                condition: rule.condition,
                                value: String(rule.value),
                                score: rule.score,
                            })),
                        },
                    },
                });
            }
        });
        break;
     case 'TermsAndConditions':
        await prisma.$transaction(async (tx) => {
            const { providerId, content } = data.updated;
            await tx.termsAndConditions.updateMany({
                where: { providerId },
                data: { isActive: false },
            });

            const latestVersion = await tx.termsAndConditions.findFirst({
                where: { providerId },
                orderBy: { version: 'desc' },
            });
            const newVersionNumber = (latestVersion?.version || 0) + 1;

            await tx.termsAndConditions.create({
                data: {
                    providerId,
                    content,
                    version: newVersionNumber,
                    isActive: true,
                    publishedAt: new Date(),
                },
            });
        });
        break;
    case 'Tax':
        if (changeType === 'UPDATE') {
             await prisma.tax.update({
                where: { id: entityId },
                data: { ...data.updated, status: 'Active' }
            });
        } else if (changeType === 'CREATE') {
            const { id, ...creationData } = data.created;
            await prisma.tax.create({
                data: { ...creationData, status: 'Active' }
            });
        } else if (changeType === 'DELETE') {
            await prisma.tax.delete({ where: { id: entityId } });
        }
      break;
    default:
      throw new Error(`Unknown entity type for approval: ${entityType}`);
  }
}


export async function POST(req: NextRequest) {
  const user = await getUserFromSession();
  if (!user || !user.permissions?.['approvals']?.update) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { changeId, approved, rejectionReason } = approvalSchema.parse(body);

    const change = await prisma.pendingChange.findUnique({
      where: { id: changeId },
    });

    if (!change) {
      return NextResponse.json({ error: 'Change request not found.' }, { status: 404 });
    }

    if (change.createdById === user.id) {
      return NextResponse.json({ error: 'You cannot approve or reject your own changes.' }, { status: 403 });
    }
    
    if (change.status !== 'PENDING') {
      return NextResponse.json({ error: 'This change has already been processed.' }, { status: 409 });
    }

    if (approved) {
      await applyChange(change);

      await prisma.pendingChange.update({
        where: { id: changeId },
        data: {
          status: 'APPROVED',
          approvedById: user.id,
          approvedAt: new Date(),
        },
      });

      await createAuditLog({
        actorId: user.id,
        action: 'CHANGE_APPROVED',
        entity: change.entityType,
        entityId: change.entityId,
        details: { changeId },
      });

        } else { // Rejected
            if (!rejectionReason) {
                return NextResponse.json({ error: 'A reason is required for rejection.' }, { status: 400 });
            }

            await prisma.pendingChange.update({
                where: { id: changeId },
                data: {
                    status: 'REJECTED',
                    approvedById: user.id,
                    approvedAt: new Date(),
                    rejectionReason,
                },
            });

            const entityId = change.entityId;
            if (entityId && change.changeType !== 'CREATE') {
                // Try to restore the original status if present in the pending-change payload
                let originalStatus: string | null = null;
                try {
                    const parsed = JSON.parse(change.payload || '{}');
                    originalStatus = parsed.original?.status ?? parsed.created?.status ?? null;
                } catch (e) {
                    // ignore
                }

                if (change.entityType === 'LoanProvider') {
                    await prisma.loanProvider.update({ where: { id: entityId }, data: { status: originalStatus || 'Active' } });
                } else if (change.entityType === 'LoanProduct') {
                    await prisma.loanProduct.update({ where: { id: entityId }, data: { status: originalStatus || 'Active' } });
                } else if (change.entityType === 'Tax' && change.changeType !== 'CREATE') {
                    await prisma.tax.update({ where: { id: entityId }, data: { status: originalStatus || 'Active' } });
                }
            }

            await createAuditLog({
                actorId: user.id,
                action: 'CHANGE_REJECTED',
                entity: change.entityType,
                entityId: change.entityId,
                details: { changeId, reason: rejectionReason },
            });
        }

    return NextResponse.json({ success: true });

    } catch (error: any) {
        console.error("Error processing change request:", error);
        if (error instanceof ZodError) {
            return validationErrorResponse(error);
        }
        return handleApiError(error, { operation: 'POST /api/approvals' });
    }
}
