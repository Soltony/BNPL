import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { requireBranchOrAdminFromRequest } from '@/lib/auth';

export async function GET() {
  try {
    await requireBranchOrAdminFromRequest();

    let role = await prisma.role.findUnique({ where: { name: 'merchant' } });
    if (!role) {
      role = await prisma.role.create({ data: { name: 'merchant', permissions: JSON.stringify({}) } });
    }

    const users = await prisma.user.findMany({
      where: { roleId: role.id },
      orderBy: { createdAt: 'desc' },
      select: { id: true, fullName: true, email: true, phoneNumber: true, merchant: { select: { id: true, name: true } } },
    });

    return NextResponse.json({ data: users });
  } catch (err: any) {
    console.error('GET /api/admin/merchant-users error:', err);
    return NextResponse.json({ error: err?.message || 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireBranchOrAdminFromRequest();

    const body = await req.json();
    const { fullName, email, phone, password, merchantId } = body || {};

    if (!fullName || typeof fullName !== 'string') {
      return NextResponse.json({ error: 'fullName is required' }, { status: 400 });
    }

    // Find merchant role by exact name (ensure a role named 'merchant' exists)
    let role = await prisma.role.findUnique({ where: { name: 'merchant' } });
    if (!role) {
      role = await prisma.role.create({ data: { name: 'merchant', permissions: JSON.stringify({}) } });
    }

    const nowSuffix = Date.now().toString().slice(-6);
    const safeEmail = email || `merchant+${nowSuffix}@example.com`;
    const safePhone = phone || `000${nowSuffix}`;

    const rawPassword = password || Math.random().toString(36).slice(2, 10);
    const hashed = await bcrypt.hash(rawPassword, 10);

    const dataToCreate: any = {
      fullName,
      email: safeEmail,
      phoneNumber: safePhone,
      password: hashed,
      passwordChangeRequired: true,
      status: 'Active',
      roleId: role.id,
    };

    if (merchantId && typeof merchantId === 'string') {
      // validate merchant exists
      const merchant = await prisma.merchant.findUnique({ where: { id: merchantId } });
      if (!merchant) return NextResponse.json({ error: 'Invalid merchant selected' }, { status: 400 });
      dataToCreate.merchantId = merchantId;
    }

    const created = await prisma.user.create({
      data: dataToCreate,
      select: { id: true, fullName: true, email: true, phoneNumber: true, merchantId: true },
    });

    return NextResponse.json({ data: created }, { status: 201 });
  } catch (err: any) {
    console.error('POST /api/admin/merchant-users error:', err);
    return NextResponse.json({ error: err?.message || 'Internal Server Error' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    await requireBranchOrAdminFromRequest();

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

    await prisma.user.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('DELETE /api/admin/merchant-users error:', err);
    return NextResponse.json({ error: err?.message || 'Internal Server Error' }, { status: 500 });
  }
}
