import React from 'react';
import prisma from '@/lib/prisma';
import { getUserFromSession } from '@/lib/user';
import type { PendingChange, User } from '@prisma/client';
import FullApprovalView from '@/app/admin/approvals/FullApprovalView';

type PendingChangeWithDetails = PendingChange & { createdBy: User, entityName: string, providerName?: string, productName?: string };

const sanitizePayloadForDisplay = (entityType: string, payloadStr: string) => {
  try {
    if (entityType === 'EligibilityList' || entityType === 'DataProvisioningUpload') return payloadStr;
    const parsed = JSON.parse(payloadStr);
    const removeFileContent = (obj: any): any => {
      if (!obj || typeof obj !== 'object') return obj;
      if (Array.isArray(obj)) return obj.map(removeFileContent);
      const out: any = {};
      for (const k of Object.keys(obj)) {
        if (k === 'fileContent') continue;
        const v = obj[k];
        out[k] = removeFileContent(v);
      }
      return out;
    };
    ['created', 'updated', 'original'].forEach((p) => {
      if (parsed[p]) parsed[p] = removeFileContent(parsed[p]);
    });
    return JSON.stringify(parsed);
  } catch (e) {
    return payloadStr;
  }
};

async function getChange(id: string): Promise<PendingChangeWithDetails | null> {
  const change = await prisma.pendingChange.findUnique({
    where: { id },
    include: { createdBy: true },
  });
  if (!change) return null;

  const providerIds = (() => {
    try {
      const data = JSON.parse(change.payload as string);
      return [data.created?.providerId || data.updated?.providerId || data.original?.providerId].filter(Boolean);
    } catch { return []; }
  })();

  const productIds = (() => {
    try {
      const data = JSON.parse(change.payload as string);
      return [data.created?.productId || data.updated?.productId || data.original?.productId].filter(Boolean);
    } catch { return []; }
  })();

  const providers = providerIds.length ? await prisma.loanProvider.findMany({ where: { id: { in: providerIds } }, select: { id: true, name: true } }) : [];
  const providerMap = new Map(providers.map(p => [p.id, p.name]));

  const products = productIds.length ? await prisma.loanProduct.findMany({ where: { id: { in: productIds } }, select: { id: true, name: true } }) : [];
  const productMap = new Map(products.map(p => [p.id, p.name]));

  const payload = sanitizePayloadForDisplay(change.entityType, change.payload as string);

  let entityName = change.entityId || 'N/A';
  let providerName: string | undefined;
  let productName: string | undefined;
  try {
    const data = JSON.parse(payload);
    const target = data.created || data.updated || data.original;
    if (target) {
      entityName = target.name || change.entityId || 'Unnamed';
      if (change.entityType === 'ScoringRules') entityName = 'Scoring Rules';
      const pId = target.providerId;
      if (pId && providerMap.has(pId)) providerName = providerMap.get(pId);
      else if (change.entityType === 'LoanProvider') providerName = target.name;
      const prodId = target.productId || target.product || null;
      if (prodId && productMap.has(prodId)) productName = productMap.get(prodId) ?? undefined;
    } else if (change.entityType === 'DataProvisioningUpload') {
      entityName = data.created?.fileName || entityName;
    }
  } catch {}

  return { ...change, payload, entityName, providerName, productName } as PendingChangeWithDetails;
}

export default async function ApprovalDetailPage({ params }: { params: { id: string } | Promise<{ id: string }> }) {
  const { id } = await params as { id: string };
  const user = await getUserFromSession();
  if (!user) return <div className="p-8">Not authenticated</div>;

  const change = await getChange(id);
  if (!change) return <div className="p-8">Change not found</div>;

  return (
    <FullApprovalView initialChange={change} currentUser={user} />
  );
}
