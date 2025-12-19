import { NextRequest, NextResponse } from 'next/server';
import { getUserFromSession } from '@/lib/user';
import path from 'path';
import fs from 'fs/promises';

export async function POST(req: NextRequest) {
  try {
    const user = await getUserFromSession();
    if (!user?.id) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const form = await req.formData();
    const file = form.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'file is required' }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());
    const uploadsDir = path.join(process.cwd(), 'public', 'uploads', 'items');
    await fs.mkdir(uploadsDir, { recursive: true });

    const ext = (file.name && file.name.split('.').pop()) || 'bin';
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const filePath = path.join(uploadsDir, filename);
    await fs.writeFile(filePath, buffer);

    const publicUrl = `/uploads/items/${filename}`;
    return NextResponse.json({ url: publicUrl }, { status: 201 });
  } catch (err) {
    console.error('POST /api/admin/uploads error:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
