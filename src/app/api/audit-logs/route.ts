

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getUserFromSession } from '@/lib/user';

export async function GET(req: NextRequest) {
    const user = await getUserFromSession();
    if (!user) {
        return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    // Only allow users with audit-logs.read permission or Super Admin/Auditor role
    const canReadAuditLogs = user.permissions?.['audit-logs']?.read || user.role === 'Super Admin' || user.role === 'Auditor';
    if (!canReadAuditLogs) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const skip = (page - 1) * limit;

    try {
        const [logs, totalCount] = await prisma.$transaction([
            prisma.auditLog.findMany({
                orderBy: {
                    createdAt: 'desc',
                },
                take: limit,
                skip: skip,
            }),
            prisma.auditLog.count(),
        ]);

        // For non-super-admin/auditor, filter sensitive fields
        let filteredLogs = logs;
        if (user.role !== 'Super Admin' && user.role !== 'Auditor') {
            filteredLogs = logs.map(({ id, actorId, action, entity, entityId, createdAt }) => ({ id, actorId, action, entity, entityId, createdAt }));
        }

        return NextResponse.json({
            logs: filteredLogs,
            totalPages: Math.ceil(totalCount / limit),
            currentPage: page,
        });
    } catch (error) {
        console.error('Failed to fetch audit logs:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

