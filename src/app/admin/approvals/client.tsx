
'use client';

import React, { useState, useMemo } from 'react';
import { useRequirePermission } from '@/hooks/use-require-permission';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, Check, X, Eye, ArrowRight, ChevronDown } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { format, formatDistanceToNow } from 'date-fns';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import type { PendingChangeWithDetails } from './page';
import type { User, LoanProvider } from '@/lib/types';
import { diff as showDiff } from 'json-diff';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import ExcelJS from 'exceljs';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';


const renderFieldValue = (value: any): React.ReactNode => {
  if (value === null || value === undefined) return 'N/A';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-muted-foreground">[Empty]</span>;
    // show inline summary and full JSON on hover/expand
    return (
      <div>
        <div className="text-sm text-muted-foreground">[{value.length} items]</div>
        <pre className="mt-1 max-h-48 overflow-auto bg-muted p-2 rounded text-xs whitespace-pre-wrap">{JSON.stringify(value, null, 2)}</pre>
      </div>
    );
  }
  if (typeof value === 'object') {
     // For simple objects like fees, format them
    // If it's a common fee-like object render nicely
    if (value && value.type && value.value !== undefined) {
      return `${value.value}${value.type === 'percentage' ? '%' : ' ETB'}`;
    }
    // Otherwise return a pretty JSON block for clarity
    return <pre className="max-h-48 overflow-auto bg-muted p-2 rounded text-xs whitespace-pre-wrap">{JSON.stringify(value, null, 2)}</pre>;
  }
  return String(value);
};


const ChangeDetailsDialog = ({
  change,
  isOpen,
  onClose,
}: {
  change: PendingChangeWithDetails | null;
  isOpen: boolean;
  onClose: () => void;
}) => {

  const diffResult = useMemo(() => {
    try {
        if (!change) return null;
        const { original, updated, created } = JSON.parse(change.payload || '{}');

        // Helper to unwrap Branch-style payloads which have shape: { type: string, data: {...} }
        const unwrapBranchPayload = (obj: any) => {
          if (!obj || typeof obj !== 'object') return obj;
          // If the object looks like a branch wrapper, return the inner data merged with type
          if (obj.type && obj.data && typeof obj.data === 'object') {
            return { __type: obj.type, ...obj.data };
          }
          return obj;
        };

        // For Branch entities, the created/updated/original objects are wrappers; unwrap them
        let parsedOriginal = original;
        let parsedUpdated = updated;
        let parsedCreated = created;
        if (change.entityType === 'Branch') {
          parsedOriginal = unwrapBranchPayload(original);
          parsedUpdated = unwrapBranchPayload(updated);
          parsedCreated = unwrapBranchPayload(created);
        }

        const formatFieldName = (path: string) => {
            return path
                .replace(/__/g, ' -> ')
                .replace(/([A-Z])/g, ' $1')
                .replace(/^./, (str) => str.toUpperCase());
        };

        if (change.changeType === 'UPDATE') {
          const before = change.entityType === 'Branch' ? (parsedOriginal || {}) : (original || {});
          const after = change.entityType === 'Branch' ? (parsedUpdated || {}) : (updated || {});
          // Special-case DataProvisioningConfig updates to give reviewers a
          // concise column-level summary instead of a raw JSON diff.
          if (change.entityType === 'DataProvisioningConfig') {
            // keep DataProvisioningConfig logic using raw original/updated
            const before = original || {};
            const after = updated || {};
            const details: any[] = [];
            let added = 0, removed = 0, updatedCount = 0;

            // Name change
            if ((before.name || '') !== (after.name || '')) {
              updatedCount++;
              details.push({ field: 'Name', before: before.name ?? 'N/A', after: after.name ?? 'N/A', type: 'updated' });
            }

            // Provider change (unlikely, but include)
            if ((before.providerId || '') !== (after.providerId || '')) {
              updatedCount++;
              details.push({ field: 'Provider Id', before: before.providerId ?? 'N/A', after: after.providerId ?? 'N/A', type: 'updated' });
            }

            // Columns: parse into structured objects { name, type, isIdentifier }
            const parseCols = (c: any): { name: string; type?: string; isIdentifier?: boolean }[] => {
              if (!c) return [];
              try {
                const raw = typeof c === 'string' ? JSON.parse(c || '[]') : Array.isArray(c) ? c : [];
                return (raw || []).map((x: any) => ({ name: String(x?.name ?? x?.id ?? ''), type: x?.type ?? String(x?.type ?? ''), isIdentifier: !!x?.isIdentifier }));
              } catch (e) {
                return [];
              }
            };

            const beforeColsObj = parseCols(before.columns);
            const afterColsObj = parseCols(after.columns);
            const beforeCols = beforeColsObj.map(c => c.name);
            const afterCols = afterColsObj.map(c => c.name);

                // Calculate added/removed column names
            const beforeSet = new Set(beforeColsObj.map(c => c.name));
            const afterSet = new Set(afterColsObj.map(c => c.name));
              const addedCols = afterColsObj.filter((n: any) => !beforeSet.has(n.name));
              const removedCols = beforeColsObj.filter((n: any) => !afterSet.has(n.name));

            if (addedCols.length > 0) {
              added += addedCols.length;
                    details.push({ field: 'Columns added', after: addedCols.map((c: any) => `${c.name} (${c.type || 'unknown'})${c.isIdentifier ? ' [ID]' : ''}`), type: 'added' });
            }
            if (removedCols.length > 0) {
              removed += removedCols.length;
                    details.push({ field: 'Columns removed', before: removedCols.map((c: any) => `${c.name} (${c.type || 'unknown'})${c.isIdentifier ? ' [ID]' : ''}`), type: 'removed' });
            }

                // Also provide a compact before/after snapshot for Columns
            if (beforeCols.length || afterCols.length) {
              // Only include as updated if the arrays differ
                    const arraysEqual = beforeCols.length === afterCols.length && beforeCols.every((v: string, i: number) => v === afterCols[i]);
              if (!arraysEqual) updatedCount++;
                    details.push({ field: 'Columns', before: beforeColsObj.map(c => `${c.name} (${c.type || 'unknown'})${c.isIdentifier ? ' [ID]' : ''}`), after: afterColsObj.map(c => `${c.name} (${c.type || 'unknown'})${c.isIdentifier ? ' [ID]' : ''}`), type: arraysEqual ? 'unchanged' : 'updated' });
            }

            // Uploads summary
            const beforeUploads = Array.isArray(before.uploads) ? before.uploads.map((u: any) => u.fileName || u.id) : [];
            const afterUploads = Array.isArray(after.uploads) ? after.uploads.map((u: any) => u.fileName || u.id) : [];
            if (JSON.stringify(beforeUploads) !== JSON.stringify(afterUploads)) {
              updatedCount++;
              details.push({ field: 'Uploads', before: beforeUploads, after: afterUploads, type: 'updated' });
            }

            // Identifier columns: detect changes and show explicit identifier info
            const beforeIds = beforeColsObj.filter((c: { isIdentifier?: boolean }) => !!c.isIdentifier).map((c: any) => c.name);
            const afterIds = afterColsObj.filter((c: { isIdentifier?: boolean }) => !!c.isIdentifier).map((c: any) => c.name);
            if (JSON.stringify(beforeIds) !== JSON.stringify(afterIds)) {
                updatedCount++;
                details.push({ field: 'Identifier', before: beforeIds.length ? beforeIds : 'N/A', after: afterIds.length ? afterIds : 'N/A', type: 'updated' });
            }

            return { added, removed, updated: updatedCount, details };
          }

            const diff = showDiff(before, after, { full: true, keepUnchangedValues: false });
            const fields = { added: 0, removed: 0, updated: 0, details: [] as any[] };

            const flattenDiff = (obj: any, path: string = ''): any[] => {
                if (!obj || typeof obj !== 'object') return [];
                
                return Object.keys(obj).reduce((acc: any[], key) => {
                    const newPath = path ? `${path}__${key}` : key;
                    const value = obj[key];

                    if (key.endsWith('__added') || key.endsWith('__deleted')) {
                        acc.push({ path: newPath, value });
                    } else if (value && typeof value === 'object' && value.__old !== undefined && value.__new !== undefined) {
                        acc.push({ path: newPath, ...value });
                    } else if (value && typeof value === 'object' && value._t === 'a') {
                      // Handle array diffs
                      acc.push({path: newPath, __old: before[key], __new: after[key]});
                    }
                    else if (typeof value === 'object' && value !== null) {
                        acc.push(...flattenDiff(value, newPath));
                    }
                    return acc;
                }, []);
            };
            
            const flatDiff = flattenDiff(diff);
            
            flatDiff.forEach(item => {
                 if (item.path.endsWith('__added')) {
                    fields.added++;
                    fields.details.push({ field: formatFieldName(item.path.replace('__added', '')), after: item.value, type: 'added' });
                } else if (item.path.endsWith('__deleted')) {
                    fields.removed++;
                    fields.details.push({ field: formatFieldName(item.path.replace('__deleted', '')), before: item.value, type: 'removed' });
                } else if (item.__old !== undefined || item.__new !== undefined) {
                    fields.updated++;
                    fields.details.push({ field: formatFieldName(item.path), before: item.__old, after: item.__new, type: 'updated' });
                }

                
            });
            
            return fields;

        } else if (change.changeType === 'CREATE') {
          // For DataProvisioningConfig creates, present a short, readable summary
          // showing provider, name and a friendly column name list instead of
          // raw nested JSON so approvers can quickly understand the change.
          if (change.entityType === 'DataProvisioningConfig') {
            const createdObj = created || {};
            let cols: any[] = [];
            try {
              if (typeof createdObj.columns === 'string') cols = JSON.parse(createdObj.columns as string) || [];
              else if (Array.isArray(createdObj.columns)) cols = createdObj.columns;
            } catch (e) { cols = []; }

            const columnLabels = cols.map((c: any) => `${c?.name ?? c?.id ?? String(c)} (${c?.type ?? 'unknown'})${c?.isIdentifier ? ' [ID]' : ''}`).slice(0, 200);
            const identifierCols = cols.filter((c: any) => !!c?.isIdentifier).map((c: any) => c?.name ?? c?.id ?? String(c));
                const details = [
              { field: 'Id', after: createdObj.id ?? 'N/A', type: 'added' },
                  { field: 'Identifier', after: identifierCols.length ? identifierCols : 'N/A', type: 'added' },
              { field: 'Provider Id', after: createdObj.providerId ?? (createdObj.providerName ?? 'N/A'), type: 'added' },
              { field: 'Name', after: createdObj.name ?? 'N/A', type: 'added' },
                    { field: 'Columns', after: columnLabels, type: 'added' },
            ];

            if (Array.isArray(createdObj.uploads) && createdObj.uploads.length) {
              details.push({ field: 'Uploads', after: createdObj.uploads.map((u: any) => u.fileName || u.id), type: 'added' });
            }

            return { added: details.length, removed: 0, updated: 0, details };
          }

          // If this is a Branch create that we unwrapped above, prefer showing the inner fields
          if (change.entityType === 'Branch' && parsedCreated && typeof parsedCreated === 'object') {
            return {
              added: Object.keys(parsedCreated).length, removed: 0, updated: 0,
              details: Object.entries(parsedCreated).map(([key, value]) => ({ field: formatFieldName(key), after: value, type: 'added' }))
            };
          }

          return {
            added: Object.keys(created).length, removed: 0, updated: 0,
            details: Object.entries(created).map(([key, value]) => ({ field: formatFieldName(key), after: value, type: 'added' }))
          };
        } else if (change.changeType === 'DELETE') {
          // For DataProvisioningConfig removals, present a concise, human-friendly
          // summary rather than dumping the whole object. This shows only core
          // fields and a simple list of column names for easier review.
          if (change.entityType === 'DataProvisioningConfig') {
            const before = original || {};
            // columns may be stored as a JSON string or an array
            let cols: any[] = [];
            try {
              if (typeof before.columns === 'string') cols = JSON.parse(before.columns as string) || [];
              else if (Array.isArray(before.columns)) cols = before.columns;
            } catch (e) {
              cols = [];
            }

            const columnNames = cols.map((c: any) => `${c?.name ?? c?.id ?? String(c)} (${c?.type ?? 'unknown'})${c?.isIdentifier ? ' [ID]' : ''}`).slice(0, 200);
            const identifierCols = cols.filter((c: any) => !!c?.isIdentifier).map((c: any) => c?.name ?? c?.id ?? String(c));
            const uploads = Array.isArray(before.uploads) ? before.uploads : [];

                const details = [
              { field: 'Id', before: before.id, type: 'removed' },
                  { field: 'Identifier', before: identifierCols.length ? identifierCols : 'N/A', type: 'removed' },
              { field: 'Provider Id', before: before.providerId || change.providerName || 'N/A', type: 'removed' },
              { field: 'Name', before: before.name, type: 'removed' },
              { field: 'Columns', before: columnNames, type: 'removed' },
            ];

            if (uploads.length > 0) {
              details.push({ field: 'Uploads', before: uploads.map((u: any) => u.fileName || u.id), type: 'removed' });
            }

            return { added: 0, removed: details.length, updated: 0, details };
          }

          // If Branch deletion, show inner object fields instead of a raw "data" object
          if (change.entityType === 'Branch' && parsedOriginal && typeof parsedOriginal === 'object') {
            return {
              added: 0, removed: Object.keys(parsedOriginal).length, updated: 0,
              details: Object.entries(parsedOriginal).map(([key, value]) => ({ field: formatFieldName(key), before: value, type: 'removed' }))
            };
          }

          return {
            added: 0, removed: Object.keys(original).length, updated: 0,
            details: Object.entries(original).map(([key, value]) => ({ field: formatFieldName(key), before: value, type: 'removed' }))
          };
        }

    } catch (e) {
        console.error("Failed to parse or diff payload:", e);
        return null;
    }
    return null;
      }, [change]);

  const termsContent = useMemo(() => {
    if (!change) return null;
    if (change.entityType !== 'TermsAndConditions') return null;
    try {
      const parsed = JSON.parse(change.payload || '{}');
      return {
        original: parsed.original?.content ?? '',
        updated: parsed.updated?.content ?? '',
      };
    } catch {
      return null;
    }
  }, [change]);

  const loanProductExtras = useMemo(() => {
    if (!change) return null;
    if (change.entityType !== 'LoanProduct') return null;
    try {
      const parsed = JSON.parse(change.payload);
      const before = parsed.original || parsed.previous || {};
      const after = parsed.updated || parsed.created || {};
      return {
        previousPenaltyRules: before.penaltyRules || [],
        currentPenaltyRules: after.penaltyRules || [],
        previousLoanAmountTiers: before.loanAmountTiers || [],
        currentLoanAmountTiers: after.loanAmountTiers || [],
      };
    } catch {
      return null;
    }
  }, [change]);

  const loanCycleExtras = useMemo(() => {
    if (!change) return null;
    if (change.entityType !== 'LoanCycleConfig') return null;
    try {
      const parsed = JSON.parse(change.payload);
      const before = parsed.original || parsed.previous || {};
      const after = parsed.updated || parsed.created || {};
      return {
        previousConfig: before,
        currentConfig: after,
        previousRanges: before.cycleRanges || [],
        currentRanges: after.cycleRanges || [],
        previousGrades: before.grades || [],
        currentGrades: after.grades || [],
      };
    } catch {
      return null;
    }
  }, [change]);


  // Helper: find a file content in payload (created/updated)
  const getFileContentFromPayload = () => {
    try {
      // Only allow file preview for explicit upload-type changes
      if (!change) return null;
      if (!(change.entityType === 'EligibilityList' || change.entityType === 'DataProvisioningUpload')) return null;
      const parsed = JSON.parse(change.payload || '{}');
      // created or updated or original may contain fileContent fields
      const candidate = parsed.created || parsed.updated || parsed.original || {};
      // search nested objects for a field named fileContent (base64)
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
    } catch (e) { return null; }
  };

  const isTermsChange = !!change && change.entityType === 'TermsAndConditions';

  const [previewOpen, setPreviewOpen] = React.useState(false);
  const [previewRows, setPreviewRows] = React.useState<any[] | null>(null);
  const [previewHeaders, setPreviewHeaders] = React.useState<string[] | null>(null);
  const [subEntityDetails, setSubEntityDetails] = React.useState<any[] | null>(null);

  const openPreviewFromPayload = async () => {
    const fileContent = getFileContentFromPayload();
    if (!fileContent) return;
    try {
      // parse base64 content using ExcelJS
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
      const worksheet = workbook.worksheets[0];
      const columnCount = worksheet.columnCount || 0;
      const headers: string[] = [];
      const headerRow = worksheet.getRow(1);
      for (let i = 1; i <= columnCount; i++) {
        const cell = headerRow.getCell(i);
        const text = (cell.text ?? cell.value) as any;
        headers.push(text?.toString?.() || `Column${i}`);
      }

      const rows: any[] = [];
      for (let r = 2; r <= worksheet.rowCount; r++) {
        const row = worksheet.getRow(r);
        const obj: any = {};
        let empty = true;
        for (let c = 1; c <= columnCount; c++) {
          const val = row.getCell(c).value;
          if (val !== null && val !== undefined && String(val).trim() !== '') empty = false;
          obj[headers[c - 1]] = val;
        }
        if (!empty) rows.push(obj);
      }

      setPreviewRows(rows);
      setPreviewHeaders(headers);
      setPreviewOpen(true);
    } catch (err) {
      console.error('Failed to parse file content preview:', err);
    }
  };

  // Fetch human-friendly details for Branch-wrapped sub-entities when deletes
  React.useEffect(() => {
    let mounted = true;
    setSubEntityDetails(null);
    if (!change) return () => { mounted = false; };

    (async () => {
      try {
        if (change.changeType !== 'DELETE') return;
        const parsed = JSON.parse(change.payload || '{}');
        const original = parsed.original || {};

        // Branch wrapper may contain { type: 'MerchantUser', id } or { type: 'ProductCategory', id }
        const wrapperType = original.type || original.__type || (original.__typename);
        const wrapperData = original.data || original;
        const id = wrapperData?.id || original.id;
        if (!wrapperType || !id) return;

        // Normalize type
        const t = String(wrapperType).replace(/^\s+|\s+$/g, '');

        // If the original wrapper already contains full data, prefer using it
        const looksLikeFullData = wrapperData && typeof wrapperData === 'object' && Object.keys(wrapperData).length > 1;
        if (looksLikeFullData) {
          const fields = Object.entries(wrapperData).map(([k, v]) => {
            // Normalize display label
            const label = k === 'fullName' ? 'Full Name' : (k === 'name' ? 'Name' : k.charAt(0).toUpperCase() + k.slice(1));
            // If merchant is an object, prefer its name for concise display
            let beforeVal = v;
            if (k.toLowerCase() === 'merchant' && v && typeof v === 'object') {
              beforeVal = v.name ?? v.id ?? JSON.stringify(v);
            }
            return { field: label, before: beforeVal, type: 'removed' };
          });
          if (mounted) setSubEntityDetails(fields);
          return;
        }

        if (t === 'Merchant') {
          const res = await fetch('/api/admin/merchants');
          if (!mounted) return;
          const list = await res.json();
          const item = Array.isArray(list) ? list.find((x: any) => x.id === id) : undefined;
          if (!item) return;
          setSubEntityDetails([
            { field: 'Name', before: item.name, type: 'removed' },
            { field: 'Status', before: item.status ?? 'N/A', type: 'removed' },
            { field: 'Id', before: item.id, type: 'removed' },
          ]);
          return;
        }

        if (t === 'MerchantUser' || t === 'User') {
          const res = await fetch('/api/admin/merchant-users');
          if (!mounted) return;
          const body = await res.json();
          const list = body?.data ?? body ?? [];
          const user = Array.isArray(list) ? list.find((x: any) => x.id === id) : undefined;
          if (!user) return;
          setSubEntityDetails([
            { field: 'Full Name', before: user.fullName ?? 'N/A', type: 'removed' },
            { field: 'Email', before: user.email ?? 'N/A', type: 'removed' },
            { field: 'Phone', before: user.phoneNumber ?? 'N/A', type: 'removed' },
            { field: 'Merchant', before: user.merchant?.name ?? user.merchantId ?? 'N/A', type: 'removed' },
            { field: 'Id', before: user.id, type: 'removed' },
          ]);
          return;
        }

        if (t === 'ProductCategory' || t === 'Category') {
          const res = await fetch('/api/admin/product-categories');
          if (!mounted) return;
          const list = await res.json();
          const item = Array.isArray(list) ? list.find((x: any) => x.id === id) : undefined;
          if (!item) return;
          setSubEntityDetails([
            { field: 'Name', before: item.name, type: 'removed' },
            { field: 'Status', before: item.status ?? 'N/A', type: 'removed' },
            { field: 'Id', before: item.id, type: 'removed' },
          ]);
          return;
        }

      } catch (e) {
        // ignore fetch/parse errors and leave subEntityDetails null
        console.warn('Failed to fetch sub-entity details for approval view', e);
      }
    })();

    return () => { mounted = false; };
  }, [change]);

  if (!change) return null;

  const renderPenaltyRulesTable = (rules: any[]) => {
    if (!rules || rules.length === 0) {
      return <p className="text-sm text-muted-foreground">No penalty rules defined.</p>;
    }
    return (
      <div className="border rounded-md overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>From Day</TableHead>
              <TableHead>To Day</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Value</TableHead>
              <TableHead>Frequency</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rules.map((rule, idx) => (
              <TableRow key={rule.id || idx}>
                <TableCell>{rule.fromDay ?? '-'}</TableCell>
                <TableCell>{rule.toDay ?? '-'}</TableCell>
                <TableCell className="capitalize">{rule.type ?? '-'}</TableCell>
                <TableCell>{rule.value ?? '-'}</TableCell>
                <TableCell className="capitalize">{rule.frequency ?? '-'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  };

  const renderLoanTierTable = (tiers: any[]) => {
    if (!tiers || tiers.length === 0) {
      return <p className="text-sm text-muted-foreground">No loan amount tiers defined.</p>;
    }
    return (
      <div className="border rounded-md overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>From Score</TableHead>
              <TableHead>To Score</TableHead>
              <TableHead>Loan Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tiers.map((tier, idx) => (
              <TableRow key={tier.id || idx}>
                <TableCell>{tier.fromScore ?? '-'}</TableCell>
                <TableCell>{tier.toScore ?? '-'}</TableCell>
                <TableCell>{tier.loanAmount ?? '-'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  };

  const renderCycleRangesTable = (ranges: any[]) => {
    if (!ranges || ranges.length === 0) {
      return <p className="text-sm text-muted-foreground">No cycle ranges defined.</p>;
    }
    return (
      <div className="border rounded-md overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Label</TableHead>
              <TableHead>Min</TableHead>
              <TableHead>Max</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ranges.map((range, idx) => (
              <TableRow key={range.label || idx}>
                <TableCell>{range.label ?? '-'}</TableCell>
                <TableCell>{range.min ?? '-'}</TableCell>
                <TableCell>{range.max ?? '-'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  };

  const renderCycleGradesTable = (grades: any[]) => {
    if (!grades || grades.length === 0) {
      return <p className="text-sm text-muted-foreground">No grades defined.</p>;
    }
    return (
      <div className="border rounded-md overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Grade</TableHead>
              <TableHead>Min Score</TableHead>
              <TableHead>Percentages</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {grades.map((grade, idx) => (
              <TableRow key={grade.label || idx}>
                <TableCell>{grade.label ?? '-'}</TableCell>
                <TableCell>{grade.minScore ?? '-'}</TableCell>
                <TableCell>
                  {Array.isArray(grade.percentages) && grade.percentages.length > 0
                    ? grade.percentages.join(', ')
                    : '—'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Change Request Details</DialogTitle>
           <DialogDescription>
            Review the changes submitted for approval.
          </DialogDescription>
        </DialogHeader>
        
        <div className="py-4 space-y-4 max-h-[70vh] overflow-y-auto">
            <Card>
                <CardContent className="pt-6 text-sm space-y-2">
                    <div className="flex justify-between">
                        <span className="text-muted-foreground">Requested By:</span>
                        <span className="font-medium">{change.createdBy.fullName}</span>
                    </div>
                     <div className="flex justify-between">
                        <span className="text-muted-foreground">Date:</span>
                        <span className="font-medium">{format(new Date(change.createdAt), 'MMM dd, yyyy')}</span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-muted-foreground">Entity:</span>
                        <span className="font-medium">{change.entityType} ({change.entityName})</span>
                    </div>
                </CardContent>
            </Card>

            {diffResult && !isTermsChange && (
                 <Card>
                    <CardHeader>
                        <CardTitle className="text-base">Summary of Changes</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p className="text-sm text-muted-foreground">
                            {diffResult.updated > 0 && `${diffResult.updated} fields updated`}
                            {diffResult.updated > 0 && (diffResult.removed > 0 || diffResult.added > 0) && ' • '}
                            {diffResult.removed > 0 && `${diffResult.removed} fields removed`}
                            {diffResult.removed > 0 && diffResult.added > 0 && ' • '}
                            {diffResult.added > 0 && `${diffResult.added} fields added`}
                        </p>
                    </CardContent>
                </Card>
            )}

            <Collapsible defaultOpen>
                 <CollapsibleTrigger asChild>
                    <Card className="rounded-b-none cursor-pointer group">
                         <CardHeader className="flex-row items-center justify-between">
                            <CardTitle className="text-base">Details</CardTitle>
                            <ChevronDown className="h-4 w-4 transition-transform duration-200 group-data-[state=open]:rotate-180" />
                        </CardHeader>
                    </Card>
                </CollapsibleTrigger>
                <CollapsibleContent>
                    <div className="border border-t-0 rounded-b-lg p-4 text-sm">
                        {isTermsChange && termsContent ? (
                          <div className="space-y-6">
                            <div>
                              <p className="text-xs font-medium text-muted-foreground uppercase mb-2">Previous Content</p>
                              <div className="border rounded-md p-4 text-sm max-h-64 overflow-auto whitespace-pre-wrap bg-muted/40">
                                {termsContent.original || <span className="text-muted-foreground">No prior terms.</span>}
                              </div>
                            </div>
                            <div>
                              <p className="text-xs font-medium text-muted-foreground uppercase mb-2">New Content</p>
                              <div className="border rounded-md p-4 text-sm max-h-64 overflow-auto whitespace-pre-wrap bg-muted/20">
                                {termsContent.updated || <span className="text-muted-foreground">No new content provided.</span>}
                              </div>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="grid grid-cols-3 gap-x-4 mb-2 font-semibold">
                                <div className="col-span-1">Field</div>
                                <div className="col-span-1">Before</div>
                                <div className="col-span-1">After</div>
                            </div>
                            <Separator />
                            {change.changeType === 'DELETE' && change.entityType === 'Branch' && subEntityDetails && (
                              <>
                                {(() => {
                                  const tsRe = /^(created\s*at|updated\s*at|createdat|updatedat)$/i;
                                  const normalize = (s: any) => String(s || '').replace(/[^a-z0-9]/gi, '').toLowerCase();

                                  // Find a Type row either in subEntityDetails or in diff details, and remove it from its source so it doesn't duplicate
                                  let typeItem: any = null;

                                  // search subEntityDetails first
                                  const subFiltered = (subEntityDetails || []).filter((it) => {
                                    if (normalize(it.field) === 'type') {
                                      typeItem = it;
                                      return false;
                                    }
                                    return true;
                                  }).filter((item) => !tsRe.test(String(item.field || '')));

                                  // If not found in subEntityDetails, try diffResult.details
                                  let remainingFromDiff: any[] = diffResult?.details ? [...diffResult.details] : [];
                                  if (!typeItem && remainingFromDiff.length > 0) {
                                    const idx = remainingFromDiff.findIndex(d => normalize(d.field) === 'type');
                                    if (idx !== -1) {
                                      typeItem = remainingFromDiff.splice(idx, 1)[0];
                                    }
                                  }

                                  // render Type first if present
                                  const rows: React.ReactNode[] = [];
                                  if (typeItem) {
                                    rows.push(
                                      <div key="type-top" className="grid grid-cols-3 gap-x-4 py-2 border-b last:border-none">
                                        <div className="col-span-1 font-medium">{typeItem.field}</div>
                                        <div className="col-span-1 text-red-600">{renderFieldValue(typeItem.before)}</div>
                                        <div className="col-span-1 text-green-600">{typeItem.type === 'removed' ? <span className="text-muted-foreground">Removed</span> : renderFieldValue(typeItem.after)}</div>
                                      </div>
                                    );
                                  }

                                  // then render the rest of sub-entity details
                                  rows.push(...subFiltered.map((item, si) => (
                                    <div key={`sub-${si}`} className="grid grid-cols-3 gap-x-4 py-2 border-b last:border-none">
                                      <div className="col-span-1 font-medium">{item.field}</div>
                                      <div className="col-span-1 text-red-600">{renderFieldValue(item.before)}</div>
                                      <div className="col-span-1 text-green-600">{item.type === 'removed' ? <span className="text-muted-foreground">Removed</span> : renderFieldValue(item.after)}</div>
                                    </div>
                                  )));

                                  // store back the possibly-modified remaining diff details for later rendering
                                  // We set a temporary prop on diffResult for the remainder to use below
                                  (diffResult as any).__remaining = remainingFromDiff.filter((d: any) => !tsRe.test(String(d.field || '')));

                                  return rows;
                                })()}
                                <Separator />
                              </>
                            )}

                            {(() => {
                              const normalize = (s: any) => String(s || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
                              const existing = new Set<string>((subEntityDetails || []).map(s => normalize(s.field)));
                              const tsRe = /^(created\s*at|updated\s*at|createdat|updatedat)$/i;
                              // Prefer any precomputed remaining list from earlier (we may have removed Type)
                              const precomputed = (diffResult as any)?.__remaining as any[] | undefined;
                              const remaining = (precomputed || (diffResult?.details || [])).filter((d: any) => !existing.has(normalize(d.field)) && !tsRe.test(String(d.field || '')));
                              return remaining.map((item: any, index: number) => (
                               <div key={index} className="grid grid-cols-3 gap-x-4 py-2 border-b last:border-none">
                                <div className="col-span-1 font-medium capitalize">{item.field}</div>
                                <div className="col-span-1 text-red-600">
                                  {item.type !== 'added' ? renderFieldValue(item.before) : ''}
                                </div>
                                <div className="col-span-1 text-green-600">
                                  {item.type === 'removed' ? <span className="text-muted-foreground">Removed</span> : renderFieldValue(item.after)}
                                </div>
                              </div>
                              ));
                            })()}
                            {getFileContentFromPayload() && (
                              <div className="grid grid-cols-3 gap-x-4 py-2">
                                <div className="col-span-1 font-medium">Uploaded File</div>
                                <div className="col-span-2 text-right">
                                  <Button variant="link" onClick={openPreviewFromPayload} size="sm">View file contents</Button>
                                </div>
                              </div>
                            )}
                             {(!diffResult || diffResult.details.length === 0) && (
                                <p className="text-muted-foreground text-center py-4">No changes to display.</p>
                            )}
                          </>
                        )}

                        {loanProductExtras && (
                          <div className="mt-8 space-y-6">
                            {(loanProductExtras.previousPenaltyRules.length > 0 ||
                              loanProductExtras.currentPenaltyRules.length > 0) && (
                              <div className="space-y-4">
                                <p className="text-sm font-semibold">Penalty Rules</p>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                  <div>
                                    <p className="text-xs font-medium text-muted-foreground uppercase mb-2">Before</p>
                                    {renderPenaltyRulesTable(loanProductExtras.previousPenaltyRules)}
                                  </div>
                                  <div>
                                    <p className="text-xs font-medium text-muted-foreground uppercase mb-2">After</p>
                                    {renderPenaltyRulesTable(loanProductExtras.currentPenaltyRules)}
                                  </div>
                                </div>
                              </div>
                            )}

                            {(loanProductExtras.previousLoanAmountTiers.length > 0 ||
                              loanProductExtras.currentLoanAmountTiers.length > 0) && (
                              <div className="space-y-4">
                                <p className="text-sm font-semibold">Loan Amount Tiers</p>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                  <div>
                                    <p className="text-xs font-medium text-muted-foreground uppercase mb-2">Before</p>
                                    {renderLoanTierTable(loanProductExtras.previousLoanAmountTiers)}
                                  </div>
                                  <div>
                                    <p className="text-xs font-medium text-muted-foreground uppercase mb-2">After</p>
                                    {renderLoanTierTable(loanProductExtras.currentLoanAmountTiers)}
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                        {loanCycleExtras && (
                          <div className="mt-8 space-y-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <Card>
                                <CardHeader className="py-3">
                                  <CardTitle className="text-sm font-semibold">Previous Config</CardTitle>
                                </CardHeader>
                                <CardContent className="space-y-2 text-sm text-muted-foreground">
                                  <div className="flex justify-between">
                                    <span>Metric</span>
                                    <span className="font-medium text-foreground">{loanCycleExtras.previousConfig?.metric || '—'}</span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span>Enabled</span>
                                    <span className="font-medium text-foreground">{loanCycleExtras.previousConfig?.enabled === false ? 'No' : 'Yes'}</span>
                                  </div>
                                </CardContent>
                              </Card>
                              <Card>
                                <CardHeader className="py-3">
                                  <CardTitle className="text-sm font-semibold">New Config</CardTitle>
                                </CardHeader>
                                <CardContent className="space-y-2 text-sm text-muted-foreground">
                                  <div className="flex justify-between">
                                    <span>Metric</span>
                                    <span className="font-medium text-foreground">{loanCycleExtras.currentConfig?.metric || '—'}</span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span>Enabled</span>
                                    <span className="font-medium text-foreground">{loanCycleExtras.currentConfig?.enabled === false ? 'No' : 'Yes'}</span>
                                  </div>
                                </CardContent>
                              </Card>
                            </div>

                            {(loanCycleExtras.previousRanges.length > 0 || loanCycleExtras.currentRanges.length > 0) && (
                              <div className="space-y-4">
                                <p className="text-sm font-semibold">Cycle Ranges</p>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                  <div>
                                    <p className="text-xs font-medium text-muted-foreground uppercase mb-2">Before</p>
                                    {renderCycleRangesTable(loanCycleExtras.previousRanges)}
                                  </div>
                                  <div>
                                    <p className="text-xs font-medium text-muted-foreground uppercase mb-2">After</p>
                                    {renderCycleRangesTable(loanCycleExtras.currentRanges)}
                                  </div>
                                </div>
                              </div>
                            )}

                            {(loanCycleExtras.previousGrades.length > 0 || loanCycleExtras.currentGrades.length > 0) && (
                              <div className="space-y-4">
                                <p className="text-sm font-semibold">Grades</p>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                  <div>
                                    <p className="text-xs font-medium text-muted-foreground uppercase mb-2">Before</p>
                                    {renderCycleGradesTable(loanCycleExtras.previousGrades)}
                                  </div>
                                  <div>
                                    <p className="text-xs font-medium text-muted-foreground uppercase mb-2">After</p>
                                    {renderCycleGradesTable(loanCycleExtras.currentGrades)}
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                    </div>
                </CollapsibleContent>
            </Collapsible>
        </div>
        
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
        {previewOpen && previewRows && (
          <Dialog open={previewOpen} onOpenChange={() => setPreviewOpen(false)}>
            <DialogContent className="max-w-4xl h-[80vh] flex flex-col">
              <DialogHeader>
                <DialogTitle>Preview of uploaded file</DialogTitle>
                <DialogDescription>Parsed rows from the uploaded file attached to this change</DialogDescription>
              </DialogHeader>
              <div className="flex-grow overflow-auto border rounded-md">
                <Table>
                  <TableHeader className="sticky top-0 bg-background">
                    <TableRow>
                      {(previewHeaders || []).map(h => <TableHead key={h}>{h}</TableHead>)}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {previewRows.map((row, idx) => (
                      <TableRow key={idx}>
                        {(previewHeaders || []).map(h => <TableCell key={`${idx}-${h}`}>{String((row as any)[h])}</TableCell>)}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setPreviewOpen(false)}>Close</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </DialogContent>
    </Dialog>
  );
};


export function ApprovalsClient({
  pendingChanges: initialChanges,
  currentUser,
}: {
  pendingChanges: PendingChangeWithDetails[];
  currentUser: User;
}) {
  useRequirePermission('approvals');
  const [changes, setChanges] = useState(initialChanges);
  const [isLoading, setIsLoading] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [changeToReject, setChangeToReject] = useState<PendingChangeWithDetails | null>(null);
  const [changeToView, setChangeToView] = useState<PendingChangeWithDetails | null>(null);
  const { toast } = useToast();
  const router = useRouter();


  const handleProcessChange = async (changeId: string, approved: boolean, reason?: string) => {
    setProcessingId(changeId);
    try {
      const response = await fetch('/api/approvals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ changeId, approved, rejectionReason: reason }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Failed to ${approved ? 'approve' : 'reject'} change.`);
      }

      setChanges(prev => prev.filter(c => c.id !== changeId));
      toast({
        title: 'Success',
        description: `Change has been successfully ${approved ? 'approved' : 'rejected'}.`,
      });

      if (approved) {
          router.refresh();
      }

    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } finally {
      setProcessingId(null);
      setChangeToReject(null);
      setRejectionReason('');
    }
  };

  return (
    <>
      <div className="flex-1 space-y-4 p-8 pt-6">
        <h2 className="text-3xl font-bold tracking-tight">Pending Approvals</h2>
        <Card>
          <CardHeader>
            <CardTitle>Change Requests</CardTitle>
            <CardDescription>Review and approve or reject pending changes made by other users.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Entity</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Requested By</TableHead>
                  <TableHead>Requested At</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={5} className="h-24 text-center">
                      <Loader2 className="h-6 w-6 animate-spin mx-auto" />
                    </TableCell>
                  </TableRow>
                ) : changes.length > 0 ? (
                  changes.map(change => (
                    <TableRow key={change.id}>
                      <TableCell className="font-medium">
                        <div>{change.entityType}</div>
                        <div className="text-sm text-muted-foreground">{change.entityName}</div>
                         {change.providerName && <div className="text-xs text-muted-foreground">({change.providerName})</div>}
                      </TableCell>
                      <TableCell>
                        <Badge variant={change.changeType === 'DELETE' ? 'destructive' : 'secondary'}>{change.changeType}</Badge>
                      </TableCell>
                      <TableCell>{change.createdBy?.fullName || 'Unknown User'}</TableCell>
                      <TableCell>{formatDistanceToNow(new Date(change.createdAt), { addSuffix: true })}</TableCell>
                      <TableCell className="text-right space-x-2">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setChangeToView(change)}>
                            <Eye className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleProcessChange(change.id, true)}
                          disabled={processingId === change.id || change.createdById === currentUser.id}
                          className="text-green-600 border-green-600 hover:bg-green-50 hover:text-green-700"
                        >
                          {processingId === change.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setChangeToReject(change)}
                          disabled={processingId === change.id || change.createdById === currentUser.id}
                           className="text-red-600 border-red-600 hover:bg-red-50 hover:text-red-700"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={5} className="h-24 text-center">
                      No pending approvals for you to review.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
      <Dialog open={!!changeToReject} onOpenChange={() => setChangeToReject(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Change</DialogTitle>
            <DialogDescription>Please provide a reason for rejecting this change.</DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Textarea
              value={rejectionReason}
              onChange={e => setRejectionReason(e.target.value)}
              placeholder="e.g., Incorrect configuration..."
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setChangeToReject(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => handleProcessChange(changeToReject!.id, false, rejectionReason)}
              disabled={!rejectionReason.trim()}
            >
              Confirm Rejection
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ChangeDetailsDialog
        change={changeToView}
        isOpen={!!changeToView}
        onClose={() => setChangeToView(null)}
      />
    </>
  );
}
