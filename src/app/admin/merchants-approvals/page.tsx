'use server';

import prisma from '@/lib/prisma';
import { getUserFromSession } from '@/lib/user';
import { ApprovalsClient } from '../approvals/client';
import type { PendingChangeWithDetails } from '../approvals/page';
import type { PendingChange } from '@prisma/client';
import type { User } from '@/lib/types';

// Requests created from the /admin/merchants module (excluding Orders)
const MERCHANT_ENTITY_TYPES = new Set(['Merchants']);

async function getPendingChanges(): Promise<PendingChangeWithDetails[]> {
  const changes = await prisma.pendingChange.findMany({
    where: {
      status: 'PENDING',
      entityType: { in: Array.from(MERCHANT_ENTITY_TYPES) },
    },
    include: {
      createdBy: true,
    },
    orderBy: {
      createdAt: 'desc',
    },
  });

  // Keep the same enrichment logic as the main approvals page (provider name / entityName)
  const providerIds = changes
    .map((c: PendingChange) => {
      try {
        const data = JSON.parse(c.payload);
        return data.created?.providerId || data.updated?.providerId || data.original?.providerId;
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  const providers = await prisma.loanProvider.findMany({
    where: { id: { in: providerIds as string[] } },
    select: { id: true, name: true },
  });
  const providerMap = new Map(providers.map((p) => [p.id, p.name]));

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
          out[k] = removeFileContent(obj[k]);
        }
        return out;
      };
      ['created', 'updated', 'original'].forEach((p) => {
        if (parsed[p]) parsed[p] = removeFileContent(parsed[p]);
      });
      return JSON.stringify(parsed);
    } catch {
      return payloadStr;
    }
  };

  return changes.map((change) => {
    change.payload = sanitizePayloadForDisplay(change.entityType, change.payload);

    let entityName = change.entityId || 'N/A';
    let providerName: string | undefined = undefined;

    try {
      const data = JSON.parse(change.payload);
      const target = data.created || data.updated || data.original;

      if (target) {
        entityName = target.name || change.entityId || 'Unnamed';

        const pId = target.providerId;
        if (pId && providerMap.has(pId)) {
          providerName = providerMap.get(pId);
        } else if (change.entityType === 'LoanProvider') {
          providerName = target.name;
        }
      } else if (change.entityType === 'DataProvisioningUpload') {
        entityName = data.created.fileName;
      }
    } catch {
      // keep defaults
    }

    return {
      ...(change as any),
      entityName,
      providerName,
    } as PendingChangeWithDetails;
  });
}

export default async function MerchantsApprovalsPage() {
  const user = await getUserFromSession();
  if (!user) {
    return <div>Not authenticated</div>;
  }

  const pendingChanges = await getPendingChanges();

  return (
    <ApprovalsClient
      pendingChanges={pendingChanges}
      currentUser={user as User}
      title="Merchant Pending Approvals"
      description="Review and approve or reject pending changes from the Merchants module."
    />
  );
}
