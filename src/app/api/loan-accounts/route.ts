
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { phoneNumber } = body;
    if (!phoneNumber) {
      return NextResponse.json({ error: 'phoneNumber is required' }, { status: 400 });
    }

    const apiUrl = process.env.EXTERNAL_API_URL ?? 'http://192.168.100.56:8280/nibtera-loan/get-accounts';
    const user = process.env.EXTERNAL_API_USERNAME ?? 'nibLoan';
    const pass = process.env.EXTERNAL_API_PASSWORD ?? '123456';
    console.info(`[loan-accounts] proxy request phone=${phoneNumber} -> ${apiUrl}`);
    
    const auth = 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');

    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: auth,
      },
      body: JSON.stringify({ phoneNumber }),
    });

    const data = await res.json().catch(() => null);
    try {
      const detailsCount = Array.isArray(data?.details) ? data.details.length : 0;
      console.info(`[loan-accounts] upstream status=${res.status} details=${detailsCount}`);
    } catch (e) {
      // ignore
    }
    return NextResponse.json(data ?? { status: 'Error', status_code: res.status }, { status: res.status });
  } catch (err: any) {
    console.error('[loan-accounts] error', err);
    return NextResponse.json({ error: String(err?.message ?? err) }, { status: 500 });
  }
}
