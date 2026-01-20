'use server';

import prisma from '@/lib/prisma';
import { getUserFromSession } from '@/lib/user';
import { ApprovalsClient } from '../approvals/client';
import type { PendingChangeWithDetails } from '../approvals/page';
import type { PendingChange } from '@prisma/client';
import type { User } from '@/lib/types';

// Show only Branch-wrapped change requests and direct branch-scoped entities
// Include all entity types that branch users can create so branch approvers see them
const BRANCH_ENTITY_TYPES = new Set([
  'Branch',
  'Merchant',
  'MerchantUser',
  'ProductCategory',
]);

async function getPendingChanges(userBranchId?: string): Promise<PendingChangeWithDetails[]> {
  const changes = await prisma.pendingChange.findMany({
    where: {
      status: 'PENDING',
      entityType: { in: Array.from(BRANCH_ENTITY_TYPES) },
    },
    include: {
      createdBy: true,
    },
    orderBy: {
      createdAt: 'desc',
    },
  });

  // Collect provider ids for user-friendly display
  const providerIds = changes
    .map((c: PendingChange) => {
      try {
        const data = JSON.parse(c.payload);
        const inner = data.created || data.updated || data.original || {};
        // Branch wrappers often include providerId on inner.data as well
        const candidate = inner.data || inner;
        return candidate.providerId || candidate.merchantId || null;
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

  // Collect merchant and branch ids so we can resolve ids -> friendly names
  const merchantIds = changes
    .map((c: PendingChange) => {
      try {
        const data = JSON.parse(c.payload);
        const inner = data.created || data.updated || data.original || {};
        const candidate = inner.data || inner;
        return candidate.merchantId || null;
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  const branchIds = changes
    .map((c: PendingChange) => {
      try {
        const data = JSON.parse(c.payload);
        const inner = data.created || data.updated || data.original || {};
        const candidate = inner.data || inner;
        return candidate.branchId || candidate.branch?.id || null;
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  const merchants =
    merchantIds.length > 0
      ? await prisma.merchant.findMany({ where: { id: { in: merchantIds as string[] } }, select: { id: true, name: true } })
      : [];
  const merchantMap = new Map(merchants.map((m) => [m.id, m.name]));

  const branches =
    branchIds.length > 0
      ? await prisma.branch.findMany({ where: { id: { in: branchIds as string[] } }, select: { id: true, name: true } })
      : [];
  const branchMap = new Map(branches.map((b) => [b.id, b.name]));

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

      const replaceIdsWithNames = (obj: any) => {
        if (!obj || typeof obj !== 'object') return;
        if (Array.isArray(obj)) return obj.forEach(replaceIdsWithNames);

        if (obj.merchantId && merchantMap.has(obj.merchantId)) {
          obj.merchantId = merchantMap.get(obj.merchantId);
        }
        if (obj.branchId && branchMap.has(obj.branchId)) {
          obj.branchId = branchMap.get(obj.branchId);
        }
        if (obj.branch && obj.branch.id && branchMap.has(obj.branch.id)) {
          obj.branch = { id: obj.branch.id, name: branchMap.get(obj.branch.id) };
        }

        for (const k of Object.keys(obj)) replaceIdsWithNames(obj[k]);
      };

      ['created', 'updated', 'original'].forEach((p) => {
        if (parsed[p]) {
          parsed[p] = removeFileContent(parsed[p]);
          replaceIdsWithNames(parsed[p]);
        }
      });

      return JSON.stringify(parsed);
    } catch {
      return payloadStr;
    }
  };

  let filtered = changes;
  if (typeof userBranchId === 'string' && userBranchId) {
    const out: typeof changes = [];
    for (const change of changes) {
      try {
        let included = false;
        let reason = '';
        // If change.entityType === 'Branch', prefer entityId but fall back to payload/merchant lookup
        if (change.entityType === 'Branch') {
          try {
            if (change.entityId) {
              if (String(change.entityId) === String(userBranchId)) {
                included = true;
                reason = 'entityId matches userBranchId';
              } else {
                reason = `entityId ${change.entityId} does not match ${userBranchId}`;
              }
            } else {
              // try payload
              const data = JSON.parse(change.payload || '{}');
              const target = data.created || data.updated || data.original || {};
              const candidate = target.data || target;
              const bid = candidate?.branchId || candidate?.branch?.id || null;
              if (bid) {
                if (String(bid) === String(userBranchId)) {
                  included = true;
                  reason = 'payload.branchId matches';
                } else {
                  reason = `payload.branchId ${bid} does not match ${userBranchId}`;
                }
              } else if (candidate?.merchantId) {
                // Merchant model does not store branch association; rely on payload.branchId instead
                reason = 'merchantId present but merchant->branch mapping not available; ensure payload.branchId is provided';
              } else {
                reason = 'missing entityId and no branchId or merchantId in payload';
              }
            }
          } catch (e) {
            reason = `branch-entity payload parse failed: ${String(e)}`;
          }
        } else {
          const data = JSON.parse(change.payload || '{}');
          const target = data.created || data.updated || data.original || {};
          const candidate = target.data || target;

          // direct branchId on payload
          const bid = candidate?.branchId || candidate?.branch?.id || null;
          if (bid) {
            if (String(bid) === String(userBranchId)) {
              included = true;
              reason = 'payload.branchId matches';
            } else {
              reason = `payload.branchId ${bid} does not match ${userBranchId}`;
            }
          }

          // merchantId -> cannot reliably map merchant->branch via DB (model lacks branch relation)
          if (!included) {
            const mid = candidate?.merchantId || null;
            if (mid) {
              reason = 'merchantId present but merchant->branch mapping not available; ensure payload.branchId is provided';
            } else if (!bid) {
              reason = 'no branchId or merchantId in payload';
            }
          }
        }

        // filter decision: included=%s reason=%s
        // (debug logging removed)
        if (included) out.push(change);
      } catch (e) {
        // skip on error
      }
    }
    filtered = out;
  }

  return filtered.map((change) => {
    change.payload = sanitizePayloadForDisplay(change.entityType, change.payload);

    let entityName = change.entityId || 'N/A';
    let providerName: string | undefined = undefined;

    try {
      const data = JSON.parse(change.payload);
      // unwrap branch payloads if necessary
      const target = data.created || data.updated || data.original || {};
      const candidate = target.data || target;

      if (candidate) {
        entityName = candidate.name || candidate.fullName || candidate.id || change.entityId || 'Unnamed';

        const pId = candidate.providerId || candidate.merchantId;
        if (pId && providerMap.has(pId)) {
          providerName = providerMap.get(pId);
        } else if (change.entityType === 'LoanProvider') {
          providerName = candidate.name;
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

export default async function BranchesApprovalsPage() {
  const user = await getUserFromSession();
  if (!user) return <div>Not authenticated</div>;

  const pendingChanges = await getPendingChanges(user.branchId as string | undefined);

  return (
    <ApprovalsClient
      pendingChanges={pendingChanges}
      currentUser={user as User}
      requiredPermission="branches-approvals"
      openDetailsInline={true}
      title="Branch Pending Approvals"
      description="Review and approve or reject pending changes from the Branch module."
    />
  );
}
