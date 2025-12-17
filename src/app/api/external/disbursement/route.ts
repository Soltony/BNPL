import { NextResponse } from 'next/server';
import prisma from '../../../../lib/prisma';
import sendSms from '@/lib/sms';

type Body = {
  creditAccount: string;
  providerId: string;
  amount: string | number;
}

export async function POST(req: Request) {
  try {
    const body: Body = await req.json();
    const { creditAccount, providerId, amount } = body;
    // For testing: force the provider id to PRO0001 unless overridden by env
    const forcedProviderId = process.env.FORCE_PROVIDER_ID ?? 'PRO0001';
    const sendProviderId = forcedProviderId;
    if (!creditAccount || !providerId || !amount) return NextResponse.json({ error: 'creditAccount, providerId and amount are required' }, { status: 400 });

    const apiUrl = process.env.EXTERNAL_DISBURSEMENT_URL;
    const user = process.env.EXTERNAL_API_USERNAME;
    const pass = process.env.EXTERNAL_API_PASSWORD;

    const auth = user && pass ? 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64') : undefined;

    // Log outgoing request details (mask password)
    try {
      const maskedAuth = auth ? auth.replace(/:(.*)@/, ':*****@') : undefined;
      console.info('[external][disbursement] forwarding request', {
        apiUrl,
        providerId: sendProviderId,
        originalProviderId: providerId,
        creditAccount,
        amount,
        auth: user ? `${user}:*****` : undefined,
      });
    } catch (e) {
      // ignore logging errors
    }

    let res;
    try {
      res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: auth } : {}) },
        body: JSON.stringify({ creditAccount, providerId: sendProviderId, amount }),
      });
    } catch (fetchErr: any) {
      console.error('[external][disbursement] fetch failed', { apiUrl, error: String(fetchErr?.message ?? fetchErr) });
      return NextResponse.json({ error: 'Upstream fetch failed', details: String(fetchErr?.message ?? fetchErr) }, { status: 502 });
    }

    const txt = await res.text().catch(() => null);
    // Try to parse JSON, fallback to text
    let payload: any = null;
    try { payload = txt ? JSON.parse(txt) : null; } catch (e) { payload = txt; }

    // Log upstream response for debugging
    try {
      const headersObj: Record<string, string> = {};
      try {
        // Response headers may be iterable
        for (const [k, v] of (res.headers as any).entries()) {
          headersObj[k] = v;
        }
      } catch (e) {
        // ignore
      }
      console.info('[external][disbursement] upstream response', {
        status: res.status,
        statusText: (res as any).statusText,
        headers: headersObj,
        body: payload,
        rawText: txt,
      });
    } catch (e) {
      // ignore logging errors
    }

    // Persist disbursement transaction to DB for audit/reconciliation
    try {
      // extract transactionId if present
      let upstreamTransactionId: string | null = null;
      if (payload && typeof payload === 'object') {
        upstreamTransactionId = payload.transactionId ?? payload.transactionid ?? payload.transaction_id ?? null;
      } else if (typeof txt === 'string') {
        const m = txt.match(/transactionId['"]?\s*[:=]\s*['"]?([A-Za-z0-9_-]+)['"]?/i) || txt.match(/'transactionId'\s*:\s*'([^']+)'/i);
        if (m) upstreamTransactionId = m[1];
      }

      await prisma.disbursementTransaction.create({ data: {
        transactionId: upstreamTransactionId ?? undefined,
        providerId: sendProviderId,
        originalProviderId: providerId ?? undefined,
        creditAccount: String(creditAccount),
        amount: typeof amount === 'number' ? amount : (Number(String(amount)) || undefined),
        requestPayload: JSON.stringify({ creditAccount, providerId: sendProviderId, amount }),
        responsePayload: typeof payload === 'string' ? payload : (payload ? JSON.stringify(payload) : undefined),
        rawResponse: txt ?? undefined,
        statusCode: typeof res.status === 'number' ? res.status : undefined,
      }}).catch((e) => {
        console.error('[external][disbursement] failed to save disbursement transaction', e);
      });
    } catch (e) {
      console.error('[external][disbursement] saving transaction failed', e);
    }

    // Attempt to send SMS notification to the phone tied to the credited account (fire-and-forget)
    (async () => {
      try {
        // Find phone by account mapping
        const phoneMap = await prisma.phoneAccount.findFirst({ where: { accountNumber: String(creditAccount) } });
        const phoneNumber = phoneMap?.phoneNumber ?? null;
        if (!phoneNumber) {
          // No mapping found; nothing to notify
          return;
        }

        // Compose message based on upstream result
        let message = '';
        if (res.ok) {
          const amt = amount ?? '';
          message = `Your account ${creditAccount} has received a disbursement of ${amt}.`;
        } else {
          const reason = (payload && typeof payload === 'object' && (payload.message || payload.Message)) ? (payload.message || payload.Message) : (typeof payload === 'string' ? payload : (txt ?? 'Unknown error'));
          message = `Disbursement to account ${creditAccount} failed: ${reason}`;
        }

        console.info('[external][disbursement] sms notify', { phoneNumber, message });
        const smsRes = await sendSms(phoneNumber, message);
        console.info('[external][disbursement] sms send result', smsRes);
        if (!smsRes.ok) console.warn('[external][disbursement] sms send failed', smsRes);
      } catch (e) {
        console.error('[external][disbursement] sms notify failed', e);
      }
    })();

    if (!res.ok) {
      return NextResponse.json({ error: 'Upstream error', status: res.status, body: payload }, { status: 502 });
    }

    return NextResponse.json(payload ?? { status: 'OK', status_code: res.status }, { status: res.status });
  } catch (err: any) {
    console.error('[external][disbursement] error', err);
    return NextResponse.json({ error: String(err?.message ?? err) }, { status: 500 });
  }
}
