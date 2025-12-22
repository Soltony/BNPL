import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getUserFromSession } from '@/lib/user';

export async function POST(req: NextRequest) {
  const user = await getUserFromSession();
  if (!user || !user.permissions?.['access-control']?.create) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { districtId, name } = body;
    if (!districtId || !name) return NextResponse.json({ error: 'districtId and name required' }, { status: 400 });
    const created = await prisma.branch.create({ data: { name: String(name).trim(), districtId } });
    return NextResponse.json(created, { status: 201 });
  } catch (err: any) {
    console.error('Create branch error', err);
    return NextResponse.json({ error: err?.message || 'Internal Server Error' }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const user = await getUserFromSession();
  if (!user || !user.permissions?.['access-control']?.read) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  try {
    const districtId = req.nextUrl.searchParams.get('districtId');
    const where = districtId ? { where: { districtId } } : {};
    const branches = await prisma.branch.findMany({ ...(where as any), orderBy: { name: 'asc' } });
    return NextResponse.json(branches);
  } catch (err: any) {
    console.error('Get branches error', err);
    return NextResponse.json({ error: err?.message || 'Internal Server Error' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const user = await getUserFromSession();
  if (!user || !user.permissions?.['access-control']?.delete) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  try {
    const id = req.nextUrl.searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'ID required' }, { status: 400 });
    await prisma.branch.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('Delete branch error', err);
    return NextResponse.json({ error: err?.message || 'Internal Server Error' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const user = await getUserFromSession();
  if (!user || !user.permissions?.['access-control']?.update) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { id, name } = body;
    if (!id || !name) return NextResponse.json({ error: 'id and name required' }, { status: 400 });
    const updated = await prisma.branch.update({ where: { id }, data: { name: String(name).trim() } });
    return NextResponse.json(updated);
  } catch (err: any) {
    console.error('Update branch error', err);
    return NextResponse.json({ error: err?.message || 'Internal Server Error' }, { status: 500 });
  }
}
