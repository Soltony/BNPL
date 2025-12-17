
import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { getUserFromSession } from '@/lib/user';
import { hasPermissionForEntity } from '@/lib/require-permission';
import { z } from 'zod';
import { createAuditLog } from '@/lib/audit-log';

const changeSchema = z.object({
  entityType: z.string(),
  entityId: z.string().optional(),
  changeType: z.enum(['CREATE', 'UPDATE', 'DELETE']),
  payload: z.string(), // JSON string
});

// sanitize payload before storing - remove large fileContent fields for product/provider changes
function removeFileContent(obj: any) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(removeFileContent);

  const out: any = {};
  for (const k of Object.keys(obj)) {
    if (k === 'fileContent') {
      // drop raw file content
      continue;
    }
    const v = obj[k];
    if (typeof v === 'object' && v !== null) {
      // For nested objects, recurse
      out[k] = removeFileContent(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function sanitizePendingChangePayload(entityType: string, payloadStr: string) {
  try {
    // Keep EligibilityList and DataProvisioningUpload intact so their fileContent can be approved
    if (entityType === 'EligibilityList' || entityType === 'DataProvisioningUpload') {
      return payloadStr;
    }

    const parsed = JSON.parse(payloadStr);
    // Traverse created/updated/original and remove any fileContent fields
    ['created', 'updated', 'original'].forEach((p) => {
      if (parsed[p]) {
        parsed[p] = removeFileContent(parsed[p]);
      }
    });

    return JSON.stringify(parsed);
  } catch (e) {
    // If parsing fails, just return original payload
    return payloadStr;
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.userId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { entityType, entityId, changeType, payload } = changeSchema.parse(body);

      // Enforce RBAC: ensure the requesting user has permission to request this change
      const user = await getUserFromSession();
      if (!user) {
        return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
      }

      const actionMap: Record<string, 'create' | 'update' | 'delete'> = {
        CREATE: 'create',
        UPDATE: 'update',
        DELETE: 'delete',
      };

      const requiredAction = actionMap[changeType];
      if (!requiredAction) {
        return NextResponse.json({ error: 'Invalid change type' }, { status: 400 });
      }

      const allowed = hasPermissionForEntity(user, entityType, requiredAction);
      if (!allowed) {
        return NextResponse.json({ error: 'Not authorized to perform this action' }, { status: 403 });
      }

    // For update/delete requests we change the original entity state to prevent
    // it from being used while the change is pending. For products we disable
    // them immediately so they cannot be selected; providers remain PENDING_APPROVAL.
    if (entityId && (changeType === 'UPDATE' || changeType === 'DELETE')) {
      if (entityType === 'LoanProvider') {
        await prisma.loanProvider.update({ where: { id: entityId }, data: { status: 'PENDING_APPROVAL' }});
      } else if (entityType === 'LoanProduct') {
        await prisma.loanProduct.update({ where: { id: entityId }, data: { status: 'Disabled' }});
      } else if (entityType === 'Tax') {
        await prisma.tax.update({ where: { id: entityId }, data: { status: 'PENDING_APPROVAL' }});
      }
      // Scoring rules don't have a status on a single entity, it's a collection.
    }


    const sanitizedPayload = sanitizePendingChangePayload(entityType, payload);

    const newChange = await prisma.pendingChange.create({
      data: {
        entityType,
        entityId,
        changeType,
        payload: sanitizedPayload,
        status: 'PENDING', // Explicitly set the status
        createdById: session.userId,
      },
    });
    
    await createAuditLog({
        actorId: session.userId,
        action: 'CHANGE_REQUEST_CREATED',
        entity: entityType,
        entityId: entityId,
        details: { changeRequestId: newChange.id, changeType }
    });

    return NextResponse.json(newChange, { status: 201 });

  } catch (error: any) {
    console.error('Failed to create pending change:', error);
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors }, { status: 400 });
    }
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

