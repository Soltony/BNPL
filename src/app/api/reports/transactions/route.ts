
import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { calculateTotalRepayable } from '@/lib/loan-calculator';
import { subDays, isValid } from 'date-fns';
import { getUserFromSession } from '@/lib/user';

export async function GET(request: NextRequest) {
  try {
    const user = await getUserFromSession();
    if (!user || !user.permissions?.['reports']?.read) {
        return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }

    const url = new URL(request.url);
    let providerId = url.searchParams.get('providerId'); // optional, 'all' for all
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');

    const isSuperAdminOrRecon = user.role === 'Super Admin' || user.role === 'Reconciliation';
    if (!isSuperAdminOrRecon) {
        providerId = user.loanProviderId || 'none';
    }

    const taxConfig = await prisma.tax.findMany();

    // Fetch journal entries that relate to loans
    const whereAny: any = { loanId: { not: null } };
    if (providerId && providerId !== 'all' && providerId !== 'none') {
      whereAny.providerId = providerId;
    }
    if (providerId === 'none') {
        return NextResponse.json([]);
    }

    if (from || to) {
      whereAny.date = {};
      if (from) whereAny.date.gte = new Date(from);
      if (to) whereAny.date.lte = new Date(to);
    }

    const type = url.searchParams.get('type'); // 'disbursement' | 'repayment' or null

    // apply type filter: repayments have a linked payment, disbursements typically don't
    if (type === 'repayment') {
      // relation filter: payment exists
      whereAny.payment = { isNot: null };
    } else if (type === 'disbursement') {
      // relation filter: no linked payment
      whereAny.payment = { is: null };
    }

    const journalEntries = await prisma.journalEntry.findMany({
      where: whereAny,
      include: {
        loan: { include: { product: { include: { provider: { include: { ledgerAccounts: true } } } }, borrower: { include: { provisionedData: { orderBy: { createdAt: 'desc' }, take: 1 } } } } },
        entries: { include: { ledgerAccount: true } },
        payment: true,
      },
      orderBy: { date: 'desc' },
      take: 2000,
    });

    // Preload phone account mappings for borrowers found in the journal entries
    const borrowerIds = Array.from(new Set(journalEntries.map(j => (j.loan as any)?.borrowerId).filter(Boolean)));
    const phoneAccounts = borrowerIds.length > 0 ? await prisma.phoneAccount.findMany({ where: { phoneNumber: { in: borrowerIds } } }) : [];
    const phoneAccountMap = new Map(phoneAccounts.map(p => [p.phoneNumber, p]));

    // Preload DisbursementTransaction rows for providers/date range to enrich disbursement rows
    const providerIds = Array.from(new Set(journalEntries.map(j => j.providerId).filter(Boolean)));
    const disbursementWhere: any = {};
    // If we have provider ids from journal entries, attempt to match rows where
    // either the stored `providerId` or the `originalProviderId` (preserved by ingestion)
    // matches. This handles cases where ingestion forces a different provider id.
    if (providerIds.length > 0) {
      disbursementWhere.OR = [
        { providerId: { in: providerIds } },
        { originalProviderId: { in: providerIds } },
      ];
    }
    // Use from/to to limit range when provided; otherwise fetch recent 90 days
    if (from || to) {
      disbursementWhere.createdAt = {};
      if (from) disbursementWhere.createdAt.gte = new Date(from);
      if (to) disbursementWhere.createdAt.lte = new Date(to);
    } else {
      disbursementWhere.createdAt = { gte: subDays(new Date(), 90) };
    }
    const disbursementTxs = await prisma.disbursementTransaction.findMany({ where: disbursementWhere });
    const disbMap = new Map<string, any[]>();
    for (const d of disbursementTxs) {
      // Prefer normalized credit account when available (populated by ingestion),
      // fallback to raw creditAccount string.
      const key = String((d.creditAccountNormalized || d.creditAccount) || '').trim();
      if (!disbMap.has(key)) disbMap.set(key, []);
      disbMap.get(key)!.push(d);
    }

    // Debug: log disbursement transaction diagnostics to help identify why
    // `cbsReference` may be null. These logs appear in the server console.
    try {
      
      // Also sample stored provider ids from recent disbursement rows to help
      // diagnose format mismatches.
      try {
        const sampleProviders = await prisma.disbursementTransaction.findMany({ where: { createdAt: { gte: subDays(new Date(), 90) } }, select: { providerId: true, originalProviderId: true }, take: 50 });
        const provSet = new Set(sampleProviders.map(p => String(p.providerId || '')));
        const origSet = new Set(sampleProviders.map(p => String(p.originalProviderId || '')));
       
      } catch (e) {
        /* ignore sample query errors */
      }
    } catch (e) { /* no-op */ }

    const rows = await Promise.all(journalEntries.map(async (je) => {
      const loan = je.loan as any;
      const provider = loan?.product?.provider;

      // compute totals as of transaction date
      const totals = loan ? calculateTotalRepayable(loan as any, loan.product as any, taxConfig, je.date) : { total: 0, principal: 0, interest: 0, serviceFee: 0, penalty: 0, tax: 0 };

      // sum collected (Received) amounts up to this transaction date for the loan
      let collected: Record<string, number> = { Principal: 0, Interest: 0, ServiceFee: 0, Penalty: 0, Tax: 0 };
      if (loan) {
        const agg = await prisma.ledgerEntry.groupBy({
          by: ['ledgerAccountId'],
          where: {
            journalEntry: { loanId: loan.id, date: { lte: je.date } },
            ledgerAccount: { type: 'Received' },
          },
          _sum: { amount: true },
        });
        // map ledgerAccountId to category
        for (const g of agg) {
          try {
            const la = await prisma.ledgerAccount.findUnique({ where: { id: g.ledgerAccountId } });
            if (!la) continue;
            const cat = la.category as string;
            collected[cat] = (collected[cat] || 0) + (g._sum.amount || 0);
          } catch (e) { /* ignore */ }
        }
      }

      const principalDisbursed = loan?.loanAmount || 0;
      const principalOutstanding = Math.max(0, (totals.principal || 0) - (collected['Principal'] || 0));
      const interestOutstanding = Math.max(0, (totals.interest || 0) - (collected['Interest'] || 0));
      const serviceFeeOutstanding = Math.max(0, (totals.serviceFee || 0) - (collected['ServiceFee'] || 0));
      const penaltyOutstanding = Math.max(0, (totals.penalty || 0) - (collected['Penalty'] || 0));
      const totalOutstanding = principalOutstanding + interestOutstanding + serviceFeeOutstanding + penaltyOutstanding;

      // debit and credit account names from entries
      // Use configured debit account from environment if provided, otherwise use journal debit entries
      const configuredDebit = process.env.ACCOUNT_NO || null;
      let debitAccounts = [] as string[];
      if (configuredDebit) {
        debitAccounts = [configuredDebit];
      } else {
        debitAccounts = je.entries.filter(e => e.type === 'Debit').map(e => e.ledgerAccount?.name).filter(Boolean) as string[];
      }
      let creditAccounts = je.entries.filter(e => e.type === 'Credit').map(e => e.ledgerAccount?.name).filter(Boolean);

      // Determine provider's disbursement/fund account (deterministic selection)
      const providerLedgerAccounts = (je.loan as any)?.product?.provider?.ledgerAccounts || [];
      const disbursementAccount = providerLedgerAccounts.find((a: any) => a.category === 'Principal' && a.type !== 'Receivable')
                                  || providerLedgerAccounts.find((a: any) => /fund|cash|disburse/i.test(a.name))
                                  || providerLedgerAccounts.find((a: any) => a.type === 'Received')
                                  || providerLedgerAccounts.find((a: any) => a.type === 'Income')
                                  || null;

      // If this is a disbursement, always use the provider's disbursement account as the credit account
      const isDisbursement = type === 'disbursement' || (!je.payment && !type);
      if (isDisbursement && disbursementAccount) {
        creditAccounts = [disbursementAccount.name];
      }

      // customer name attempt: prefer PhoneAccount.name, fall back to provisionedData
      let customerName: string | null = null;
      try {
        const pa = loan && loan.borrowerId ? phoneAccountMap.get(loan.borrowerId) : null;
        if (pa) {
          customerName = pa.name || pa.customerName || pa.accountName || null;
        }
        if (!customerName) {
          const pd = loan?.borrower?.provisionedData?.[0]?.data;
          if (pd) {
            const parsed = JSON.parse(pd);
            customerName = parsed.fullName || parsed.name || parsed.customerName || null;
          }
        }
      } catch (e) { }

      const transactionStatus = je.payment ? 'COMPLETED' : 'POSTED';
      const reference = je.id;

      // try to find a matching disbursement transaction by borrower account and amount
      let cbsReference: string | null = null;
      let cbsCreditAmount: number | null = null;
      let disbursementCreatedAt: Date | null = null;
      let disbursementStatusCode: number | null = null;
      let disbursementRawResponse: string | null = null;
      let disbursementStatusText: string | null = null;
      let disbursementOutcome: string | null = null;
      // derive borrower account (from phoneAccount mapping or provisioned data fallback)
      let borrowerAccount: string | null = null;
      if (loan && loan.borrowerId) {
        const pa = phoneAccountMap.get(loan.borrowerId) || null;
        borrowerAccount = pa?.accountNumber || null;
        if (!borrowerAccount) {
          try {
            const pd = loan?.borrower?.provisionedData?.[0]?.data;
            if (pd) {
              const parsed = JSON.parse(pd);
              borrowerAccount = parsed.accountNumber || parsed.account || parsed.customerAccount || parsed.account_no || borrowerAccount;
            }
          } catch (e) { /* ignore */ }
        }

        let foundMatch: any = null;

        // DEBUG: per-entry context before matching
        try {
          const sample = { journalEntryId: je.id, loanId: loan?.id, borrowerId: loan?.borrowerId, providerId: je.providerId, principalDisbursed };
        } catch (e) { }

        // 1) If the disbursement row already has a loanId that matches this loan, prefer it.
        try {
          if (loan?.id) {
            foundMatch = disbursementTxs.find((d: any) => String(d.loanId) === String(loan.id)) || null;
            if (foundMatch) {
            }
          }
        } catch (e) { /* ignore */ }

        // 2) If no loanId match, try matching by borrower account (using normalized key where available)
        if (!foundMatch && borrowerAccount) {
          const normalizedBorrowerAcc = String(borrowerAccount || '').replace(/\D/g, '').replace(/^0+/, '');
          const candidates = disbMap.get(String(normalizedBorrowerAcc)) || disbMap.get(String(borrowerAccount)) || [];
          if (candidates.length > 0) {
            // try to match by amount (principalDisbursed)
            foundMatch = candidates.find((c: any) => Math.abs((c.amount || 0) - principalDisbursed) < 0.01) || candidates[0];
            
          } else {
            try {
              // No candidates were found for this account; log sample provider candidates (if any)
              const providerCandidates = disbursementTxs.filter(d => String(d.providerId) === String(provider?.id) || String(d.originalProviderId) === String(provider?.id));
            } catch (e) { }
          }
        }

        // fallback: try to find a matching disbursement by provider and amount (closest date)
        if (!foundMatch && provider?.id) {
          const providerCandidates = disbursementTxs.filter(d => String(d.providerId) === String(provider.id) || String(d.originalProviderId) === String(provider.id));
          if (providerCandidates.length > 0) {
            const closeByAmount = providerCandidates.filter((c: any) => Math.abs((c.amount || 0) - principalDisbursed) < 0.01);
            const searchPool = closeByAmount.length > 0 ? closeByAmount : providerCandidates;
            // choose the candidate with the smallest time difference to the journal entry date
            let best: any = null;
            let bestDiff = Number.MAX_SAFE_INTEGER;
            for (const c of searchPool) {
              if (!c.createdAt) continue;
              const diff = Math.abs(new Date(c.createdAt).getTime() - new Date(je.date).getTime());
              if (diff < bestDiff) {
                bestDiff = diff;
                best = c;
              }
            }
            if (best) foundMatch = best;
          }
        }

        if (foundMatch) {
          const match = foundMatch;
          // Only assign CBS reference and credit amount if not a failed transaction
          cbsReference = null;
          cbsCreditAmount = null;
          disbursementCreatedAt = match.createdAt ?? null;
          disbursementStatusCode = match.statusCode ?? null;
          disbursementRawResponse = match.rawResponse ?? match.responsePayload ?? null;

          // Try to extract a human-friendly status from the raw response or response payload
          let isFailure = false;
          try {
            const raw = match.rawResponse ?? match.responsePayload ?? null;
            if (raw) {
              let parsed: any = raw;
              if (typeof raw === 'string') {
                const normalized = raw.trim().replace(/\r|\n/g, ' ');
                try {
                  parsed = JSON.parse(normalized);
                } catch (e) {
                  try {
                    parsed = JSON.parse(normalized.replace(/'/g, '"'));
                  } catch (e2) {
                    parsed = null;
                  }
                }
              }
              if (parsed) {
                disbursementStatusText = parsed.status || parsed.Status || parsed.status_message || parsed.message || (parsed.status_code ? String(parsed.status_code) : null) || null;
              } else {
                const s = String(raw);
                const m2 = s.match(/status[_ ]?code\W*:?\W*(\d{3})/i) || s.match(/status\W*:?\W*([A-Za-z]+)/i);
                if (m2) disbursementStatusText = m2[1];
                else disbursementStatusText = s.slice(0, 200);
              }
            }
          } catch (e) {
            if (!disbursementStatusText && disbursementRawResponse) disbursementStatusText = String(disbursementRawResponse).slice(0, 200);
          }
          // Derive a simplified outcome: Success or Failure
          try {
            if (disbursementStatusCode && Number(disbursementStatusCode) === 200) {
              disbursementOutcome = 'Success';
            } else if (disbursementStatusText) {
              const s = String(disbursementStatusText).toLowerCase();
              if (/success|completed|ok|200/.test(s)) disbursementOutcome = 'Success';
              else if (/fail|failed|error|decline|500|400|insufficient|minimum/.test(s)) disbursementOutcome = 'Failure';
            }
          } catch (e) { /* ignore */ }
          // If we determined the disbursement outcome is a failure, do not expose CBS reference or credited amount
          if (disbursementOutcome === 'Success') {
            cbsReference = match.transactionId ?? null;
            cbsCreditAmount = match.amount ?? null;
          } else {
            cbsReference = null;
            cbsCreditAmount = 0;
          }

          // Try to extract a human-friendly status from the raw response or response payload
          try {
            const raw = match.rawResponse ?? match.responsePayload ?? null;
            if (raw) {
              let parsed: any = raw;
              if (typeof raw === 'string') {
                // Some integrations return single-quoted JSON; normalize quotes before parsing
                const normalized = raw.trim().replace(/\r|\n/g, ' ');
                try {
                  parsed = JSON.parse(normalized);
                } catch (e) {
                  // try replacing single quotes with double quotes then parse
                  try {
                    parsed = JSON.parse(normalized.replace(/'/g, '"'));
                  } catch (e2) {
                    parsed = null;
                  }
                }
              }

              if (parsed) {
                disbursementStatusText = parsed.status || parsed.Status || parsed.status_message || parsed.message || (parsed.status_code ? String(parsed.status_code) : null) || null;
              } else {
                // fallback: try to extract status_code or status text via regex
                const s = String(raw);
                const m = s.match(/transactionId\W*:?\W*([A-Za-z0-9]+)/i);
                if (m) {
                  // nothing - prefer explicit status
                }
                const m2 = s.match(/status[_ ]?code\W*:?\W*(\d{3})/i) || s.match(/status\W*:?\W*([A-Za-z]+)/i);
                if (m2) disbursementStatusText = m2[1];
                else disbursementStatusText = s.slice(0, 200);
              }
            }
          } catch (e) {
            // ignore parsing errors, keep raw string if any
            if (!disbursementStatusText && disbursementRawResponse) disbursementStatusText = String(disbursementRawResponse).slice(0, 200);
          }
        }

        // Derive a simplified outcome: Success or Failure
        try {
          if (disbursementStatusCode && Number(disbursementStatusCode) === 200) {
            disbursementOutcome = 'Success';
          } else if (disbursementStatusText) {
            const s = String(disbursementStatusText).toLowerCase();
            if (/success|completed|ok|200/.test(s)) disbursementOutcome = 'Success';
            else if (/fail|failed|error|decline|500|400|insufficient|minimum/.test(s)) disbursementOutcome = 'Failure';
          }
        } catch (e) { /* ignore */ }
        // If we determined the disbursement outcome is a failure, do not expose
        // the CBS reference or credited amount (these are not meaningful for
        // failed disbursements and should be null in the UI).
        try {
          if (disbursementOutcome === 'Failure') {
            cbsReference = null;
            cbsCreditAmount = 0;
          }
        } catch (e) { /* ignore */ }
      }

      return {
        provider: provider?.name || null,
        providerId: provider?.id || null,
        loanId: loan?.id || null,
        customerName,
        transactionDate: je.date,
        dueDate: loan?.dueDate || null,
        debitAccount: debitAccounts.join(', '),
        creditAccount: creditAccounts.join(', '),
        transactionStatus,
        reference,
        productType: loan?.product?.name || null,
        borrowerId: loan?.borrowerId || null,
        borrowerAccount,
        principalDisbursed,
        // Net disbursed should be the principal disbursed (no client-side deductions)
        netDisbursed: principalDisbursed,
        principalOutstanding,
        interestOutstanding,
        serviceFeeOutstanding,
        penaltyOutstanding,
        totalOutstanding,
        status: loan?.repaymentStatus || null,
        // DisbursementTransaction enrichment
        cbsReference,
        cbsCreditAmount,
        disbursementCreatedAt,
        disbursementStatusCode,
        disbursementRawResponse,
        disbursementStatusText,
        disbursementOutcome,
      };
    }));

    return NextResponse.json(rows);
  } catch (error: any) {
    console.error('Transactions report error', error);
    return NextResponse.json({ message: error.message || 'Internal server error' }, { status: 500 });
  }
}
