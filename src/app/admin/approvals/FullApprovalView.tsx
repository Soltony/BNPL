"use client";

import React, { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import ExcelJS from 'exceljs';
import { format, formatDistanceToNow } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import { diff as showDiff } from 'json-diff';
import type { PendingChange } from '@prisma/client';
import type { User } from '@/lib/types';

const renderFieldValue = (value: any) => {
  if (value === null || value === undefined) return 'N/A';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return `${value.length} item(s)`;
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
};

function formatFieldName(path: string) {
  return path
    .replace(/__/g, ' -> ')
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (s) => s.toUpperCase());
}

  const labelMap: Record<string, string> = {
    configId: 'Config Id',
    providerId: 'Provider',
    providerName: 'Provider',
    productId: 'Product',
    productName: 'Product',
    fileName: 'File Name',
    fileContent: 'Uploaded File',
    id: 'Id',
  };

  function formatLabel(key: string) {
    if (!key) return key;
    const normalized = key.replace(/[^a-zA-Z0-9]/g, '');
    const lower = normalized.charAt(0).toLowerCase() + normalized.slice(1);
    if (labelMap[lower]) return labelMap[lower];
    return formatFieldName(key);
  }

export default function FullApprovalView({ initialChange, currentUser }: { initialChange: PendingChange & any; currentUser: User }) {
  const router = useRouter();
  const { toast } = useToast();
  const [processing, setProcessing] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');
  const [showRejectError, setShowRejectError] = useState(false);
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewRows, setPreviewRows] = useState<any[] | null>(null);
  const [previewHeaders, setPreviewHeaders] = useState<string[] | null>(null);
  const [previewSheetIndex, setPreviewSheetIndex] = useState(0);
  const [previewSheetNames, setPreviewSheetNames] = useState<string[] | null>(null);
  const [previewSheets, setPreviewSheets] = useState<any[] | null>(null);

  const payload = useMemo(() => {
    try { return JSON.parse(initialChange.payload || '{}'); } catch { return {}; }
  }, [initialChange.payload]);

  const diffResult = useMemo(() => {
    try {
      if (initialChange.changeType === 'UPDATE') {
        const before = payload.original || payload.previous || payload.before || {};
        const after = payload.updated || payload.created || payload.after || {};
        const rows: any[] = [];

        const compare = (b: any, a: any, path = '') => {
          const keys = new Set<string>([...Object.keys(b || {}), ...Object.keys(a || {})]);
          for (const k of Array.from(keys)) {
            const newPath = path ? `${path}__${k}` : k;
            const vb = b ? b[k] : undefined;
            const va = a ? a[k] : undefined;

            // both objects (non-array) -> dive
            if (vb && va && typeof vb === 'object' && typeof va === 'object' && !Array.isArray(vb) && !Array.isArray(va)) {
              compare(vb, va, newPath);
              continue;
            }

            // arrays: compare by index
            if (Array.isArray(vb) || Array.isArray(va)) {
              const len = Math.max(Array.isArray(vb) ? vb.length : 0, Array.isArray(va) ? va.length : 0);
              for (let i = 0; i < len; i++) {
                const ib = Array.isArray(vb) ? vb[i] : undefined;
                const ia = Array.isArray(va) ? va[i] : undefined;
                const idxPath = `${newPath}__${i}`;
                if (ib && ia && typeof ib === 'object' && typeof ia === 'object') {
                  compare(ib, ia, idxPath);
                } else {
                  const bothUndefined = ib === undefined && ia === undefined;
                  if (bothUndefined) continue;
                  const same = JSON.stringify(ib) === JSON.stringify(ia);
                  if (!same) rows.push({ field: formatFieldName(idxPath), rawField: idxPath, before: ib, after: ia });
                }
              }
              continue;
            }

            // primitive comparison or added/removed
            const bothUndefined = vb === undefined && va === undefined;
            if (bothUndefined) continue;
            const equal = JSON.stringify(vb) === JSON.stringify(va);
            if (!equal) {
              rows.push({ field: formatFieldName(newPath), rawField: newPath, before: vb, after: va });
            }
          }
        };

        compare(before, after);
        return rows;
      }
    } catch (e) { }
    return [] as any[];
  }, [initialChange.changeType, payload]);

  const summarySentence = useMemo(() => {
    const type = initialChange.changeType;
    const entity = initialChange.entityType;
    const name = initialChange.entityName || (payload.created?.name || payload.updated?.name || payload.original?.name) || 'Unnamed';
    if (type === 'CREATE') return `This request will add a new ${entity} named “${name}”.`;
    if (type === 'DELETE') return `This request will remove the ${entity} named “${name}” from the system.`;
    return `This request will update the ${entity} named “${name}”.`;
  }, [initialChange, payload]);

  const impactSummary = useMemo(() => {
    if (initialChange.changeType === 'CREATE') return 'Impact: Adds a new item to the system.';
    if (initialChange.changeType === 'DELETE') return 'Impact: Removes an item; related references may be affected.';
    if (initialChange.changeType === 'UPDATE') {
      if (diffResult.length === 0) return 'Impact: Small or no visible changes.';
      return `Impact: Updates ${diffResult.length} field(s).`;
    }
    return '';
  }, [initialChange.changeType, diffResult]);

  const handleAction = async (approved: boolean) => {
    setProcessing(true);
    try {
      const res = await fetch('/api/approvals', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ changeId: initialChange.id, approved, rejectionReason: approved ? undefined : rejectionReason })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to process request');
      }
      toast({ title: 'Success', description: `Change ${approved ? 'approved' : 'rejected'}.` });
      router.push('/admin/approvals');
    } catch (e: any) {
      toast({ title: 'Error', description: e?.message || 'Something went wrong', variant: 'destructive' });
    } finally { setProcessing(false); }
  };

  const getFileContentFromPayload = () => {
    try {
      if (!initialChange) return null;
      const parsed = payload || {};
      const candidate = parsed.created || parsed.updated || parsed.original || {};
      const searchForFileContent = (obj: any): string | null => {
        if (!obj || typeof obj !== 'object') return null;
        for (const k of Object.keys(obj)) {
          const v = obj[k];
          if (k === 'fileContent' && typeof v === 'string') return v;
          if (typeof v === 'object') {
            const nested = searchForFileContent(v);
            if (nested) return nested;
          }
        }
        return null;
      };
      return searchForFileContent(candidate);
    } catch {
      return null;
    }
  };

  const openPreviewFromPayload = async () => {
    const fileContent = getFileContentFromPayload();
    if (!fileContent) return;
    try {
      const base64ToArrayBuffer = (base64: string) => {
        const binaryString = atob(base64);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes.buffer;
      };

      const arrayBuffer = base64ToArrayBuffer(fileContent);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(arrayBuffer as any);
      const sheets: any[] = [];
      for (const ws of workbook.worksheets) {
        const columnCount = ws.columnCount || 0;
        const headers: string[] = [];
        const headerRow = ws.getRow(1);
        for (let i = 1; i <= columnCount; i++) {
          const cell = headerRow.getCell(i);
          const text = (cell.text ?? cell.value) as any;
          headers.push(text?.toString?.() || `Column${i}`);
        }
        const rows: any[] = [];
        for (let r = 2; r <= ws.rowCount; r++) {
          const row = ws.getRow(r);
          const obj: any = {};
          let empty = true;
          for (let c = 1; c <= columnCount; c++) {
            const val = row.getCell(c).value;
            if (val !== null && val !== undefined && String(val).trim() !== '') empty = false;
            obj[headers[c - 1]] = val;
          }
          if (!empty) rows.push(obj);
        }
        sheets.push({ name: ws.name, headers, rows });
      }

      setPreviewSheets(sheets);
      setPreviewSheetNames(sheets.map(s => s.name));
      setPreviewSheetIndex(0);
      setPreviewHeaders(sheets[0]?.headers ?? null);
      setPreviewRows(sheets[0]?.rows ?? null);
      setPreviewOpen(true);
    } catch (err) {
      console.error('Failed to parse file content preview:', err);
    }
  };

  const downloadPayloadFile = () => {
    const fileContent = getFileContentFromPayload();
    if (!fileContent) return;
    const byteCharacters = atob(fileContent);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray]);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const filename = (payload.created?.fileName || payload.original?.fileName || 'file.bin');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const isDataProvisioning = initialChange.entityType === 'DataProvisioningConfig';

  // Helper: build friendly change rows for CREATE/DELETE or fall back to diffResult for UPDATE
  const prettifyRawPath = (rawPath: string) => {
    if (!rawPath) return '';
    const parts = rawPath.split('__');
    const beforeRoot = payload.original || payload.previous || payload.before || {};
    const afterRoot = payload.updated || payload.created || payload.after || {};
    let curBefore: any = beforeRoot;
    let curAfter: any = afterRoot;
    const display: string[] = [];
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      const isIndex = /^\d+$/.test(p);
      if (isIndex) {
        const idx = Number(p);
        // If this index is the first part and next part exists, treat next part as the array name (e.g. 1__rules -> rules[1])
        if (i === 0 && parts.length > 1) {
          const next = parts[i + 1];
          const arrBefore = beforeRoot && next ? (beforeRoot[next] ?? null) : null;
          const arrAfter = afterRoot && next ? (afterRoot[next] ?? null) : null;
          const elem = Array.isArray(arrAfter) ? arrAfter[idx] : Array.isArray(arrBefore) ? arrBefore[idx] : null;
          const label = elem && (elem.name || elem.label || elem.id || elem.title);
          if (label) display.push(`${formatLabel(next)}[${idx} • ${String(label)}]`);
          else display.push(`${formatLabel(next)}[${idx}]`);
          // advance past the next segment since we've consumed it as the array name
          i = i + 1;
          curBefore = Array.isArray(arrBefore) && arrBefore[idx] ? arrBefore[idx] : null;
          curAfter = Array.isArray(arrAfter) && arrAfter[idx] ? arrAfter[idx] : null;
          continue;
        }

        const parentKey = parts[i - 1];
        const arrBefore = curBefore && parentKey ? (curBefore[parentKey] ?? null) : null;
        const arrAfter = curAfter && parentKey ? (curAfter[parentKey] ?? null) : null;
        const elem = Array.isArray(arrAfter) ? arrAfter[idx] : Array.isArray(arrBefore) ? arrBefore[idx] : null;
        const label = elem && (elem.name || elem.label || elem.id || elem.title);
        if (parentKey) {
          if (label) display.push(`${formatLabel(parentKey)}[${idx} • ${String(label)}]`);
          else display.push(`${formatLabel(parentKey)}[${idx}]`);
        } else {
          if (label) display.push(`#${idx} (${String(label)})`);
          else display.push(`#${idx}`);
        }
        curBefore = Array.isArray(arrBefore) && arrBefore[idx] ? arrBefore[idx] : null;
        curAfter = Array.isArray(arrAfter) && arrAfter[idx] ? arrAfter[idx] : null;
      } else {
        display.push(formatLabel(p));
        curBefore = curBefore && curBefore[p] !== undefined ? curBefore[p] : null;
        curAfter = curAfter && curAfter[p] !== undefined ? curAfter[p] : null;
      }
    }
    return display.join(' → ');
  };

  const safeParseMaybeJSON = (v: any) => {
    if (v === null || v === undefined) return v;
    if (typeof v === 'string') {
      const s = v.trim();
      if ((s.startsWith('{') && s.endsWith('}')) || (s.startsWith('[') && s.endsWith(']'))) {
        try { return JSON.parse(s); } catch { return v; }
      }
    }
    return v;
  };
  const findNumericAmount = (obj: any, depth = 0): {amount: number | null, currency?: string | null} => {
    if (obj === null || obj === undefined) return { amount: null };
    const preferKeys = ['amount','price','value','fee','rate','amountETB','amountLocal','principal','installment','amountValue'];
    for (const k of preferKeys) {
      if (obj[k] !== undefined && obj[k] !== null) {
        const v = obj[k];
        if (typeof v === 'number') return { amount: v, currency: obj.currency ?? null };
        if (typeof v === 'string' && !isNaN(Number(v))) return { amount: Number(v), currency: obj.currency ?? null };
        if (typeof v === 'object' && v !== null) {
          if (typeof v.amount === 'number') return { amount: v.amount, currency: v.currency ?? obj.currency ?? null };
          if (typeof v.amount === 'string' && !isNaN(Number(v.amount))) return { amount: Number(v.amount), currency: v.currency ?? obj.currency ?? null };
        }
      }
    }
    if (depth < 6 && typeof obj === 'object') {
      for (const k of Object.keys(obj)) {
        if (['from','to','min','max','fromScore','toScore','productId','id','name','label'].includes(k)) continue;
        const v = obj[k];
        if (typeof v === 'number') return { amount: v, currency: obj.currency ?? null };
        if (typeof v === 'string' && !isNaN(Number(v))) return { amount: Number(v), currency: obj.currency ?? null };
        if (typeof v === 'object') {
          const found = findNumericAmount(v, depth + 1);
          if (found.amount !== null) return found;
        }
      }
    }
    // Last-resort: look for numeric-looking strings inside the object values
    try {
      const text = JSON.stringify(obj);
      const m = text.match(/(-?\d+(?:\.\d+)?)/);
      if (m) return { amount: Number(m[1]), currency: null };
    } catch (e) { }
    return { amount: null };
  };
  const changeRows = useMemo(() => {
    if (initialChange.changeType === 'CREATE' && isDataProvisioning) {
      const created = payload.created || payload.updated || {};
      let cols: any[] = [];
      try {
        if (typeof created.columns === 'string') cols = JSON.parse(created.columns || '[]');
        else if (Array.isArray(created.columns)) cols = created.columns;
      } catch { cols = []; }
      return [
        { field: 'name', before: '—', after: created.name ?? 'N/A' },
        { field: 'columns', before: '—', after: `${cols.length} column${cols.length === 1 ? '' : 's'}` },
        { field: 'providerId', before: '—', after: initialChange.providerName ?? created.providerId ?? 'N/A' },
      ];
    }

    if (initialChange.changeType === 'DELETE' && isDataProvisioning) {
      const original = payload.original || {};
      let cols: any[] = [];
      try {
        if (typeof original.columns === 'string') cols = JSON.parse(original.columns || '[]');
        else if (Array.isArray(original.columns)) cols = original.columns;
      } catch { cols = []; }
      return [
        { field: 'name', before: original.name ?? 'N/A', after: 'Removed' },
        { field: 'columns', before: `${cols.length} column${cols.length === 1 ? '' : 's'}`, after: 'Removed' },
        { field: 'providerId', before: initialChange.providerName ?? original.providerId ?? 'N/A', after: 'Removed' },
      ];
    }

    if (initialChange.changeType === 'UPDATE') {
      return diffResult.map(d => ({ field: d.rawField ?? d.field, display: prettifyRawPath(d.rawField ?? d.field), before: d.before, after: d.after }));
    }

    // fallback: dump created/original
    if (initialChange.changeType === 'CREATE') {
      const created = payload.created || payload.updated || {};
      return Object.entries(created).map(([k, v]) => ({ field: k, before: '—', after: v }));
    }
    if (initialChange.changeType === 'DELETE') {
      const original = payload.original || {};
      return Object.entries(original).map(([k, v]) => ({ field: k, before: v, after: 'Removed' }));
    }
    return [] as any[];
  }, [initialChange.changeType, payload, diffResult, initialChange.providerName, isDataProvisioning]);

  // Helper: render details for DataProvisioningConfig
  const renderDataProvisioningDetails = () => {
    const obj = initialChange.changeType === 'DELETE' ? (payload.original || {}) : (payload.created || payload.updated || {});
    let cols: any[] = [];
    try {
      if (typeof obj.columns === 'string') cols = JSON.parse(obj.columns || '[]');
      else if (Array.isArray(obj.columns)) cols = obj.columns;
    } catch { cols = []; }

    return (
      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div className="text-muted-foreground">Name</div>
            <div className="col-span-2 font-medium">{obj.name ?? 'N/A'}</div>

            <div className="text-muted-foreground">Columns</div>
            <div className="col-span-2">
              <div className="space-y-2">
                {cols.length === 0 ? <div className="text-sm text-muted-foreground">No columns</div> : (
                  cols.map((c: any, i: number) => (
                    <div key={i} className="flex items-start gap-6">
                      <div className="w-48 font-medium">{c?.name ?? c?.id ?? String(c)}</div>
                      <div className="text-sm text-muted-foreground">{c?.type ?? String(c?.type ?? '')}</div>
                      <div className="ml-auto text-sm font-medium text-foreground">{c?.isIdentifier ? '• Identifier' : ''}</div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="text-muted-foreground">ProviderId</div>
            <div className="col-span-2 font-medium">{initialChange.providerName ?? obj.providerId ?? 'N/A'}</div>
          </div>
        </CardContent>
      </Card>
    );
  };

  // Remove sensitive file content before rendering any JSON on the page
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

  const renderFriendlyValue = (value: any, keyName?: string): React.ReactNode => {
    if (value === null || value === undefined) return <span className="text-muted-foreground">N/A</span>;
    if (typeof value === 'boolean') return <span>{value ? 'Yes' : 'No'}</span>;
    if (typeof value === 'number') {
      // If the key name suggests a monetary/amount field, format as currency with two decimals
      if (keyName && /amount|price|fee|rate|loanamount|penalty/i.test(String(keyName))) {
        try {
          return <span>{new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}</span>;
        } catch { /* fallthrough */ }
      }
      return <span>{String(value)}</span>;
    }
    if (typeof value === 'string') {
      const s = value as string;
      // Friendly enum mapping for common penalty/tier values
      if (keyName && /type$/i.test(String(keyName))) {
        if (/fixed/i.test(s)) return <span>Fixed amount</span>;
        if (/percentage|percent|principal/i.test(s)) return <span>Percentage of principal</span>;
      }
      if (keyName && /frequency$/i.test(String(keyName))) {
        if (/daily/i.test(s)) return <span>Daily</span>;
        if (/one-?time/i.test(s)) return <span>One-time</span>;
      }
      // provider id: show friendly provider name when available
      if (keyName && /provider/i.test(String(keyName)) && typeof s === 'string') {
        const providerName = (initialChange && (initialChange.providerName || initialChange.providerId)) || null;
        if (providerName && providerName !== s) {
          return (
            <div className="flex items-center gap-2">
              <div className="font-medium">{initialChange.providerName ?? providerName}</div>
              <div className="text-xs text-muted-foreground">({s})</div>
            </div>
          );
        }
      }
      // product id: show friendly product name when available
      if (keyName && /product/i.test(String(keyName)) && typeof s === 'string') {
        const initialProductName = initialChange && (initialChange.productName || initialChange.productId || null);
        const mapped = idNameMap[String(s)];
        const productName = initialProductName && initialProductName !== s ? initialProductName : (mapped && mapped !== s ? mapped : null);
        if (productName) {
          return (
            <div className="flex items-center gap-2">
              <div className="font-medium">{productName}</div>
              <div className="text-xs text-muted-foreground">({s})</div>
            </div>
          );
        }
      }
      // image data URL preview
      if (/^data:image\/[a-zA-Z]+;base64,/.test(s)) {
        return <img src={s} alt={keyName ?? 'uploaded image'} className="h-12 w-12 object-contain rounded" />;
      }
      // detect color hex
      const looksLikeColorValue = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(s);
      const looksLikeColorKey = keyName ? /color|colour|hex/i.test(keyName) : false;
      if (looksLikeColorValue || looksLikeColorKey) {
        return (
          <div className="flex items-center gap-3">
            <div className="h-6 w-10 rounded border" style={{ background: s }} />
            <div className="text-sm">{s}</div>
          </div>
        );
      }
      const looksLikeLongTerms = keyName && /content|terms|agreement|policy/i.test(String(keyName));
      // For Terms/Content fields, render full text but constrain height and make it scrollable
      if (looksLikeLongTerms || initialChange?.entityType === 'TermsAndConditions') {
        return (
          <div className="max-h-[60vh] overflow-auto p-3 border rounded text-sm whitespace-pre-wrap">
            {s}
          </div>
        );
      }
      if (s.length > 120) return <div className="text-sm break-words max-w-xl"><code className="text-xs">{s.slice(0, 120)}…</code></div>;
      return <span>{s}</span>;
    }
    if (Array.isArray(value)) {
      if (value.length === 0) return <span className="text-muted-foreground">N/A</span>;
      const count = value.length;
      // Render up to 5 items as plain text; for objects, make a short summary
      const sample = value.slice(0, 5).map((v, i) => {
        if (v === null || v === undefined) return `item ${i + 1}: N/A`;
        if (typeof v === 'object') {
          const keys = Object.keys(v).slice(0, 3);
          const parts = keys.map(k => `${k}: ${String(v[k])}`);
          return `${i + 1}: ${parts.join('; ')}`;
        }
        return `${i + 1}: ${String(v)}`;
      });
      // If caller provided a keyName, allow specialized renderers for known array types
      if (keyName && /fee/i.test(String(keyName))) {
        return (
          <div>
            <div className="text-sm text-muted-foreground">{count} item{count > 1 ? 's' : ''}</div>
            <div className="mt-1">{renderFeeRules(value)}</div>
          </div>
        );
      }
      if (keyName && /penalty/i.test(String(keyName))) {
        return (
          <div>
            <div className="text-sm text-muted-foreground">{count} item{count > 1 ? 's' : ''}</div>
            <div className="mt-1">{renderPenaltyRules(value)}</div>
          </div>
        );
      }
      if (keyName && (/tier/i.test(String(keyName)) || /amounttier/i.test(String(keyName)) || /loanamount/i.test(String(keyName)))) {
        return (
          <div>
            <div className="text-sm text-muted-foreground">{count} item{count > 1 ? 's' : ''}</div>
            <div className="mt-1">{renderTiers(value)}</div>
          </div>
        );
      }
      if (keyName && /cycle|graderange|grades|cyclerange|cycleRanges/i.test(String(keyName))) {
        // if grades array, try to find ranges nearby in payload
        const ranges = (payload && payload.created && payload.created.cycleRanges) || (payload && payload.updated && payload.updated.cycleRanges) || (payload && payload.original && payload.original.cycleRanges) || null;
        return (
          <div>
            <div className="text-sm text-muted-foreground">{count} item{count > 1 ? 's' : ''}</div>
            <div className="mt-1">{/grade/i.test(String(keyName)) ? renderGrades(value, ranges) : renderCycleRanges(value)}</div>
          </div>
        );
      }

      // special-case arrays that represent penaltyRules or tiers when no keyName provided: best-effort detection
      try {
        const first = value[0];
        if (first && typeof first === 'object') {
          const kStr = Object.keys(first).join(' ');
          if (/penalty|fromDay|toDay|rate|amount|frequency/i.test(kStr)) {
            return (
              <div>
                <div className="text-sm text-muted-foreground">{count} item{count > 1 ? 's' : ''}</div>
                <div className="mt-1">{renderPenaltyRules(value)}</div>
              </div>
            );
          }
          if (/tier|loanAmount|min|max|productId/i.test(kStr)) {
            return (
              <div>
                <div className="text-sm text-muted-foreground">{count} item{count > 1 ? 's' : ''}</div>
                <div className="mt-1">{renderTiers(value)}</div>
              </div>
            );
          }
        }
      } catch (e) { /* ignore */ }

      // fallback: show short sample
      return (
        <div>
          <div className="text-sm text-muted-foreground">{count} item{count > 1 ? 's' : ''}</div>
          <div className="mt-1 text-sm text-muted-foreground">{sample.join(' — ')}</div>
        </div>
      );
    }
    if (typeof value === 'object') {
      // If this looks like a rule/score set, render as a friendly card
      const looksLikeRuleSet = (() => {
        if (!value) return false;
        if (Array.isArray(value)) {
          return value.length > 0 && typeof value[0] === 'object' && (value[0].weight !== undefined || value[0].score !== undefined || value[0].value !== undefined || value[0].label || value[0].name);
        }
        const keys = Object.keys(value);
        if (keys.includes('rules') || keys.includes('ranges') || keys.includes('values') || keys.includes('options') || keys.includes('choices')) return true;
        // also if the object itself has label/name and an array child
        for (const k of keys) {
          if (Array.isArray(value[k]) && value[k].length > 0 && typeof value[k][0] === 'object') return true;
        }
        return false;
      })();
      if (looksLikeRuleSet) {
        return renderRuleCard(value);
      }
      const entries = Object.entries(value);
      if (entries.length === 0) return <span className="text-muted-foreground">N/A</span>;
      return (
        <div className="space-y-1">
          {entries.map(([k, v]) => (
            <div key={k} className="flex items-start gap-4">
              <div className="w-36 text-muted-foreground text-xs">{formatLabel(k)}</div>
              <div className="text-sm">
                {Array.isArray(v) ? (
                  // specialized renderers for known array types
                  (/penalty/i.test(k) || /penalty/i.test(String(k))) ? renderPenaltyRules(v) : (/tier/i.test(k) || /amounttier/i.test(k) || /loanamount/i.test(k)) ? renderTiers(v) : <div>{v.length} item{v.length>1?'s':''}</div>
                ) : (
                  renderFriendlyValue(v, k)
                )}
              </div>
            </div>
          ))}
        </div>
      );
    }
    return <span>{String(value)}</span>;
  };

  const renderRuleCard = (value: any): React.ReactNode => {
    // Normalize: if value is an array, wrap
    let title = value.name || value.label || value.title || '';
    let metaWeight = value.weight ?? value.maxPoints ?? value.points ?? value.totalPoints ?? null;
    let list: any[] = [];
    if (Array.isArray(value)) {
      list = value;
    } else if (Array.isArray(value.rules)) list = value.rules;
    else if (Array.isArray(value.ranges)) list = value.ranges;
    else if (Array.isArray(value.values)) list = value.values;
    else if (Array.isArray(value.options)) list = value.options;
    else {
      // find first array child
      for (const k of Object.keys(value)) {
        if (Array.isArray(value[k])) {
          list = value[k];
          if (!title) title = value.name || value.label || k;
          break;
        }
      }
    }

    // If title still empty, try to pick a label from first item
    if (!title && list.length > 0) title = list[0].name || list[0].label || '';

    return (
      <div className="border rounded-md p-4">
        <div className="flex items-start justify-between">
          <div className="font-semibold">{title || 'Item'}</div>
          {metaWeight !== null && <div className="text-sm text-muted-foreground">Weight (max points): {metaWeight}</div>}
        </div>
        <div className="mt-3 space-y-2">
          {list.map((it: any, idx: number) => {
            // compute left (condition) and right (points) text more robustly
            const label = it.label || it.name || it.title || '';
            const desc = it.description || it.note || '';

            // detect operator/condition keys
            const operator = it.condition || it.operator || it.op || it.comparator || it.comparitor || it.cond || '';
            const threshold = (it.value ?? it.threshold ?? it.thresholdValue ?? it.limit ?? it.scoreValue ?? it.to ?? it.from ?? null);

            // ranges
            const from = it.from ?? it.min ?? it.gte ?? it.gt ?? null;
            const to = it.to ?? it.max ?? it.lte ?? it.lt ?? null;

            let left = '';
            if (label) left = label;
            // prefer explicit operator+threshold
            if (!left && operator && (threshold !== null && threshold !== undefined)) {
              left = `${operator} ${String(threshold)}`;
            }
            // range handling
            if (!left && (from !== null || to !== null)) {
              if (from !== null && to !== null) left = `Between ${String(from)} and ${String(to)}`;
              else if (from !== null) left = `> ${String(from)}`;
              else left = `<= ${String(to)}`;
            }
            // fallbacks: try common keys, or render key/value pairs
            if (!left) {
              if (desc) left = desc;
              else {
                const pairs = Object.entries(it).filter(([k]) => !['weight','points','score','value','threshold','from','to','operator','op','condition'].includes(k)).slice(0,4).map(([k,v]) => `${formatLabel(k)}: ${String(v)}`);
                left = pairs.join('; ') || JSON.stringify(it);
              }
            }

            const rightPoints = it.weight ?? it.points ?? it.score ?? it.value ?? it.pointsValue ?? null;
            return (
              <div key={idx} className="flex items-start justify-between">
                <div className="text-sm">{left}</div>
                <div className="text-sm text-muted-foreground">{rightPoints !== null && rightPoints !== undefined ? <span>⇒ {String(rightPoints)}</span> : null}</div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };
  // Resolve a product/lookup id to a friendly name by searching payload
  const idNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    const visit = (obj: any) => {
      if (!obj || typeof obj !== 'object') return;
      if (Array.isArray(obj)) {
        for (const it of obj) visit(it);
        return;
      }
      if (obj.id && (obj.name || obj.title || obj.label)) {
        map[String(obj.id)] = obj.name || obj.title || obj.label;
      }
      for (const k of Object.keys(obj)) visit(obj[k]);
    };
    try {
      visit(payload);
      visit(payload.created);
      visit(payload.updated);
      visit(payload.original);
    } catch (e) { }
    return map;
  }, [payload]);

  const resolveProductName = (id: string) => {
    if (!id) return id;
    const found = idNameMap[String(id)];
    return found || id;
  };

  const renderPenaltyRules = (arr: any[]): React.ReactNode => {
    if (!Array.isArray(arr) || arr.length === 0) return <div className="text-sm text-muted-foreground">0 items</div>;
    return (
      <div className="overflow-hidden border rounded">
        <table className="w-full text-sm">
          <thead className="bg-muted/20">
            <tr>
              <th className="p-2 text-left">Id</th>
              <th className="p-2 text-left">Rule</th>
            </tr>
          </thead>
          <tbody>
            {arr.map((it: any, idx: number) => {
              const id = it.id ?? it.key ?? it.code ?? `item-${idx}`;
              const parts: string[] = [];
              // Prefer numeric extraction for amount-like fields
              const amountInfo = findNumericAmount(it);
              if (amountInfo && amountInfo.amount !== null) {
                try {
                  const fmt = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amountInfo.amount);
                  parts.push(`${fmt}${amountInfo.currency ? ` ${amountInfo.currency}` : ''}`);
                } catch {
                  parts.push(String(amountInfo.amount));
                }
              } else if (it.amount !== undefined) {
                parts.push(`${String(it.amount)} ${it.currency ?? ''}`.trim());
              }
              if (it.rate !== undefined) parts.push(`${String(it.rate)}%`);
              if (it.fromDay !== undefined || it.toDay !== undefined) {
                if (it.fromDay !== undefined && it.toDay !== undefined) parts.push(`from day ${it.fromDay} to day ${it.toDay} after due date`);
                else if (it.fromDay !== undefined) parts.push(`from day ${it.fromDay} after due date`);
                else parts.push(`until day ${it.toDay} after due date`);
              }
              if (it.description) parts.push(String(it.description));
              const desc = parts.join(' — ');
              return (
                <tr key={id} className="border-t">
                  <td className="p-2 align-top text-xs text-muted-foreground">{String(id)}</td>
                  <td className="p-2 align-top text-sm">{desc}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  const renderFeeRules = (arr: any[]): React.ReactNode => {
    if (!Array.isArray(arr) || arr.length === 0) return <div className="text-sm text-muted-foreground">0 items</div>;
    return (
      <div className="overflow-hidden border rounded">
        <table className="w-full text-sm">
          <thead className="bg-muted/20">
            <tr>
              <th className="p-2 text-left">Id</th>
              <th className="p-2 text-left">Type</th>
              <th className="p-2 text-left">Value</th>
              <th className="p-2 text-left">When</th>
            </tr>
          </thead>
          <tbody>
            {arr.map((it: any, idx: number) => {
              const id = it.id ?? it.key ?? it.code ?? `fee-${idx}`;
              const type = it.type ?? it.feeType ?? 'unknown';
              // value: prefer numeric extraction
              const amountInfo = findNumericAmount(it);
              const valueLabel = amountInfo && amountInfo.amount !== null ? `${Number(amountInfo.amount).toFixed(2)}${amountInfo.currency ? ` ${amountInfo.currency}` : ''}` : (it.value !== undefined ? String(it.value) : '—');
              const when = it.when ?? it.timing ?? it.frequency ?? '';
              return (
                <tr key={id} className="border-t">
                  <td className="p-2 align-top text-xs text-muted-foreground">{String(id)}</td>
                  <td className="p-2 align-top text-sm">{(String(type)).replace(/_/g,' ')}</td>
                  <td className="p-2 align-top text-sm">{valueLabel}</td>
                  <td className="p-2 align-top text-sm text-muted-foreground">{String(when)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  const renderCycleRanges = (arr: any[]): React.ReactNode => {
    if (!Array.isArray(arr) || arr.length === 0) return <div className="text-sm text-muted-foreground">0 items</div>;
    return (
      <div className="overflow-hidden border rounded">
        <table className="w-full text-sm">
          <thead className="bg-muted/20">
            <tr>
              <th className="p-2 text-left">Label</th>
              <th className="p-2 text-left">Range</th>
            </tr>
          </thead>
          <tbody>
            {arr.map((r: any, i: number) => {
              const label = r.label ?? `Range ${i + 1}`;
              const min = r.min ?? r.from ?? r.start ?? null;
              const max = r.max ?? r.to ?? r.end ?? null;
              const rangeLabel = (min !== null && max !== null) ? `${min}–${max}` : (min !== null ? `≥ ${min}` : (max !== null ? `≤ ${max}` : '—'));
              return (
                <tr key={i} className="border-t">
                  <td className="p-2 align-top text-sm">{label}</td>
                  <td className="p-2 align-top text-sm text-muted-foreground">{rangeLabel}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  const renderGrades = (arr: any[], ranges?: any[]): React.ReactNode => {
    if (!Array.isArray(arr) || arr.length === 0) return <div className="text-sm text-muted-foreground">0 items</div>;
    const rangeLabels = Array.isArray(ranges) ? ranges.map((r: any, i: number) => (r.label ?? (r.min ?? r.from ?? `Range ${i + 1}`))) : [];
    return (
      <div className="overflow-hidden border rounded">
        <table className="w-full text-sm">
          <thead className="bg-muted/20">
            <tr>
              <th className="p-2 text-left">Grade</th>
              {rangeLabels.length === 0 ? <th className="p-2 text-left">Value</th> : rangeLabels.map((rl: any, idx: number) => (
                <th key={idx} className="p-2 text-left">{rl}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {arr.map((g: any, i: number) => {
              const label = g.label ?? `Grade ${i + 1}`;
              const vals: any[] = g.percentages ?? g.values ?? g.amounts ?? [];
              const parsedVals = Array.isArray(vals) ? vals : [];
              return (
                <tr key={i} className="border-t">
                  <td className="p-2 align-top text-sm font-medium">{label}</td>
                  {rangeLabels.length === 0 ? (
                    <td className="p-2 align-top text-sm">{parsedVals.join(', ') || '—'}</td>
                  ) : (
                    parsedVals.length > 0 ? parsedVals.map((v: any, idx: number) => (
                      <td key={idx} className="p-2 align-top text-sm text-right">{(typeof v === 'number') ? new Intl.NumberFormat('en-US', {minimumFractionDigits:2, maximumFractionDigits:2}).format(v) : String(v)}</td>
                    )) : rangeLabels.map((_, idx) => <td key={idx} className="p-2 align-top text-sm">—</td>)
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  const renderTiers = (arr: any[]): React.ReactNode => {
    if (!Array.isArray(arr) || arr.length === 0) return <div className="text-sm text-muted-foreground">0 items</div>;
    return (
      <div className="overflow-hidden border rounded">
        <table className="w-full text-sm">
          <thead className="bg-muted/20">
            <tr>
              <th className="p-2 text-left">Range</th>
              <th className="p-2 text-left">Product</th>
              <th className="p-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {arr.map((t: any, i: number) => {
              const from = t.from ?? t.min ?? t.start ?? t.fromScore ?? null;
              const to = t.to ?? t.max ?? t.end ?? t.toScore ?? null;
              const amountInfo = findNumericAmount(t);
              const amount = amountInfo.amount;
              const currency = amountInfo.currency ?? t.currency ?? 'ETB';
              const label = from !== null && to !== null ? `${String(from)}–${String(to)}` : from !== null ? `≥ ${String(from)}` : to !== null ? `≤ ${String(to)}` : t.label ?? `Tier ${i + 1}`;
              let productId = t.productId || t.product || t.productIdRef || null;
              let productName = '—';
              if (productId) {
                if (typeof productId === 'object') {
                  productName = productId.name || productId.title || productId.label || String(productId.id || productId._id || '—');
                } else {
                  productName = resolveProductName(productId) || String(productId);
                }
              } else {
                productName = t.productName || t.name || '—';
              }
              return (
                <tr key={i} className="border-t">
                  <td className="p-2 align-top text-sm text-muted-foreground">{label}</td>
                  <td className="p-2 align-top text-sm">{productName}</td>
                  <td className="p-2 align-top text-right font-semibold">{amount !== null ? `${Number(amount).toFixed(2)} ${currency}` : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  const renderParameters = (obj: any) => {
    if (!obj || typeof obj !== 'object') return <div className="text-sm">{renderFriendlyValue(obj)}</div>;
    const entries = Object.entries(obj);
    if (entries.length === 0) return <div className="text-sm text-muted-foreground">No details available.</div>;
    return (
      <div className="grid grid-cols-1 gap-3">
        {entries.map(([k, v]) => {
          const parsed = safeParseMaybeJSON(v);
          return (
            <div key={k} className="grid grid-cols-3 gap-4 items-start p-2 border rounded">
              <div className="col-span-1 text-xs text-muted-foreground">{formatLabel(k)}</div>
              <div className="col-span-2 text-sm">
                {Array.isArray(parsed) ? (
                  // specialized renderers for known array types with clearer tables
                  (/fee/i.test(k)) ? (
                    <div>
                      <div className="text-sm text-muted-foreground mb-2">{parsed.length} item{parsed.length>1?'s':''}</div>
                      {renderFeeRules(parsed)}
                    </div>
                  ) : (/penalty/i.test(k)) ? (
                    <div>
                      <div className="text-sm text-muted-foreground mb-2">{parsed.length} item{parsed.length>1?'s':''}</div>
                      {renderPenaltyRules(parsed)}
                    </div>
                  ) : (/tier/i.test(k) || /loanamount/i.test(k) || /amounttier/i.test(k)) ? (
                    <div>
                      <div className="text-sm text-muted-foreground mb-2">{parsed.length} item{parsed.length>1?'s':''}</div>
                      {renderTiers(parsed)}
                    </div>
                  ) : (/cycle|grade|cyclerange|cycleranges|grades|graderange/i.test(k)) ? (
                    <div>
                      <div className="text-sm text-muted-foreground mb-2">{parsed.length} item{parsed.length>1?'s':''}</div>
                      {/* If this is grades, try to locate ranges in payload for column headers */}
                      {(/grade/i.test(k)) ? renderGrades(parsed, (payload?.created?.cycleRanges || payload?.updated?.cycleRanges || payload?.original?.cycleRanges)) : renderCycleRanges(parsed)}
                    </div>
                  ) : (
                    <div>
                      <div className="text-sm text-muted-foreground">{parsed.length} item{parsed.length>1?'s':''}</div>
                      <div className="mt-1 text-sm text-muted-foreground">{String(parsed.slice(0,5).map((x:any)=> (typeof x==='object' ? JSON.stringify(x) : String(x))).join(' — '))}</div>
                    </div>
                  )
                ) : (
                  renderFriendlyValue(v, k)
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="max-w-7xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <Link href="/admin/approvals" className="inline-flex items-center gap-2 px-3 py-1 rounded bg-yellow-400 text-black hover:bg-yellow-450 text-sm">← Back</Link>
          <h1 className="text-xl font-semibold">{initialChange.createdBy?.fullName} requested to {initialChange.changeType.toLowerCase()} {initialChange.entityType} "{initialChange.entityName}"</h1>
        </div>
        <div className="text-sm text-muted-foreground">Requested {format(new Date(initialChange.createdAt), 'PPP, p')}</div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-sm text-muted-foreground">{initialChange.entityType} • {initialChange.changeType}</div>
              <div className="mt-4">
                <p className="font-medium">{initialChange.createdBy?.fullName} requested to {initialChange.changeType === 'CREATE' ? 'create' : initialChange.changeType === 'DELETE' ? 'remove' : 'update'} {initialChange.entityType} "{initialChange.entityName}"</p>
                <p className="text-sm text-muted-foreground mt-3">{initialChange.changeType === 'CREATE' ? 'This will add a new item which may affect related workflows.' : initialChange.changeType === 'DELETE' ? 'This will remove the item from the system.' : impactSummary}</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Changes</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-sm text-muted-foreground mb-4">Field / Before / After</div>
              <div className="overflow-hidden border rounded">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40">
                    <tr>
                      <th className="p-3 text-left">Field</th>
                      <th className="p-3 text-left">Before</th>
                      <th className="p-3 text-left">After</th>
                    </tr>
                  </thead>
                  <tbody>
                    {changeRows.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="p-6 text-sm text-muted-foreground">No field-level changes detected. See the Details section for full payload.</td>
                      </tr>
                    ) : (
                      changeRows.map((r: any, i: number) => (
                        <tr key={i} className="border-t">
                          <td className="p-3 font-medium">{(r as any).display ? (r as any).display : formatLabel(String(r.field))}</td>
                          <td className="p-3 text-muted-foreground">{renderFriendlyValue(r.before, (r as any).rawField ?? (r as any).field)}</td>
                          <td className="p-3">{renderFriendlyValue(r.after, (r as any).rawField ?? (r as any).field)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              {getFileContentFromPayload() && (
                <div className="mt-3 text-right">
                  <Button variant="outline" onClick={openPreviewFromPayload} className="mr-2">View file contents</Button>
                  <Button onClick={downloadPayloadFile}>Download file</Button>
                </div>
              )}
            </CardContent>
          </Card>

          {isDataProvisioning ? renderDataProvisioningDetails() : (
            <Card>
              <CardHeader>
                <CardTitle>Details</CardTitle>
              </CardHeader>
              <CardContent>
                {renderParameters(removeFileContent(payload.created || payload.updated || payload.original || {}))}
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Decision</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-3">Approve or reject this request</p>
              {!showRejectInput ? (
                <div className="flex items-center gap-3">
                  <Button variant="outline" onClick={() => router.push('/admin/approvals')}>Cancel</Button>
                  <Button onClick={() => handleAction(true)} className="bg-yellow-400 text-black hover:bg-yellow-450">{processing ? 'Processing…' : 'Approve'}</Button>
                  <Button onClick={() => { setShowRejectInput(true); }} className="bg-red-500 text-white hover:bg-red-600" disabled={processing}>{processing ? 'Processing…' : 'Reject'}</Button>
                </div>
              ) : (
                <div>
                  <label className="block text-sm font-medium mb-2">Rejection Reason (required)</label>
                  <textarea aria-required rows={4} className="w-full border rounded p-2 text-sm mb-2" value={rejectionReason} onChange={e => { setRejectionReason(e.target.value); if (showRejectError) setShowRejectError(false); }} placeholder="Explain why this request should be rejected (required)" />
                  {showRejectError && rejectionReason.trim() === '' && (
                    <div className="text-xs text-red-600 mb-2">A reason is required to reject this request.</div>
                  )}
                  <div className="flex items-center gap-3">
                    <Button variant="outline" onClick={() => { setShowRejectInput(false); setRejectionReason(''); setShowRejectError(false); }}>Cancel</Button>
                    <Button onClick={() => handleAction(true)} className="bg-yellow-400 text-black hover:bg-yellow-450">{processing ? 'Processing…' : 'Approve'}</Button>
                    <Button onClick={() => {
                        if (rejectionReason.trim() === '') {
                          setShowRejectError(true);
                          return;
                        }
                        handleAction(false);
                      }}
                      className="bg-red-500 text-white hover:bg-red-600" disabled={processing}
                    >{processing ? 'Processing…' : 'Confirm Reject'}</Button>
                  </div>
                </div>
              )}
              <p className="text-xs text-muted-foreground mt-3">Decision will be recorded and submitter will be notified.</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Meta</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-sm space-y-3">
                <div>
                  <div className="text-muted-foreground">Requested by</div>
              {previewOpen && previewRows && (
                <Dialog open={previewOpen} onOpenChange={() => setPreviewOpen(false)}>
                  <DialogContent className="max-w-4xl h-[80vh] flex flex-col">
                    <DialogHeader>
                      <DialogTitle>Preview of uploaded file</DialogTitle>
                      <DialogDescription>Parsed rows from the uploaded file attached to this change</DialogDescription>
                    </DialogHeader>
                    <div className="flex-grow overflow-auto border rounded-md">
                      <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-background">
                          <tr>
                            {(previewHeaders || []).map(h => <th key={h} className="p-2 text-left">{h}</th>)}
                          </tr>
                        </thead>
                        <tbody>
                          {previewRows.map((row, idx) => (
                            <tr key={idx} className="border-t">
                              {(previewHeaders || []).map(h => <td key={`${idx}-${h}`} className="p-2 align-top">{String((row as any)[h] ?? '')}</td>)}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setPreviewOpen(false)}>Close</Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              )}
                  <div className="font-medium">{initialChange.createdBy?.fullName}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Entity</div>
                  <div className="font-medium">{initialChange.entityType} {initialChange.providerName ? `• ${initialChange.providerName}` : ''}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Type</div>
                  <div className="mt-1"><Badge>{initialChange.changeType}</Badge></div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
