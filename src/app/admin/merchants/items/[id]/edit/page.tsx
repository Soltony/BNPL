'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRequirePermission } from '@/hooks/use-require-permission';
import { useAuth } from '@/hooks/use-auth';
import { useToast } from '@/hooks/use-toast';
import { useRouter, useParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2 } from 'lucide-react';
import { postPendingChange } from '@/lib/fetch-utils';

type Merchant = { id: string; name: string; status: 'ACTIVE' | 'INACTIVE' };
type Category = { id: string; name: string; status: 'ACTIVE' | 'INACTIVE' };

type StockLocation = {
  id: string;
  name: string;
  isActive: boolean;
};

type InventoryDraftRow = {
  optionValueIds: string[];
  locationId: string;
  quantityAvailable: string;
};

type VariantDraft = {
  id?: string;
  size: string;
  color: string;
  material: string;
  price: string;
  status: 'ACTIVE' | 'INACTIVE';
};

type OptionValueDraft = {
  id?: string;
  label: string;
  priceDelta: string;
  status: 'ACTIVE' | 'INACTIVE';
};

type OptionGroupDraft = {
  id?: string;
  name: string;
  status: 'ACTIVE' | 'INACTIVE';
  isRequired: boolean;
  values: OptionValueDraft[];
};

export default function EditItemPageClient() {
  useRequirePermission('merchants');
  const { currentUser } = useAuth();
  const { toast } = useToast();
  const router = useRouter();
  const params = useParams() as { id?: string };
  const id = params?.id;

  const [loading, setLoading] = useState(true);
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [locations, setLocations] = useState<StockLocation[]>([]);

  const [itemName, setItemName] = useState('');
  const [itemDescription, setItemDescription] = useState('');
  const [itemPrice, setItemPrice] = useState('');
  const [itemStatus, setItemStatus] = useState<'ACTIVE' | 'INACTIVE'>('ACTIVE');
  const [itemMerchantId, setItemMerchantId] = useState<string>('');
  const [itemCategoryId, setItemCategoryId] = useState<string>('');
  const [itemImageFile, setItemImageFile] = useState<File | null>(null);
  const [itemImagePreview, setItemImagePreview] = useState<string | null>(null);
  const [itemVideoUrl, setItemVideoUrl] = useState('');

  const [originalItem, setOriginalItem] = useState<any>(null);

  const [optionGroups, setOptionGroups] = useState<OptionGroupDraft[]>([]);
  const [inventoryRows, setInventoryRows] = useState<InventoryDraftRow[]>([]);

  const optionValueOptions = useMemo(() => {
    const opts: Array<{ id: string; label: string }> = [];
    for (const g of optionGroups) {
      const groupName = (g.name || '').trim();
      if (!groupName) continue;
      for (const v of g.values || []) {
        if (!v.id) continue;
        const valueLabel = (v.label || '').trim();
        if (!valueLabel) continue;
        opts.push({ id: v.id, label: `${groupName}: ${valueLabel}` });
      }
    }
    return opts;
  }, [optionGroups]);

  const optionValueLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const o of optionValueOptions) map.set(o.id, o.label);
    return map;
  }, [optionValueOptions]);

  const groupIdByOptionValueId = useMemo(() => {
    const map = new Map<string, string>();
    for (const g of optionGroups) {
      for (const v of g.values || []) {
        if (v.id) map.set(v.id, g.id || g.name);
      }
    }
    return map;
  }, [optionGroups]);

  const themeColor = useMemo(() => {
    return currentUser?.role === 'Super Admin' ? 'hsl(var(--primary))' : 'hsl(var(--primary))';
  }, [currentUser]);

  const isMerchantUser = useMemo(() => String(currentUser?.role || '').toLowerCase() === 'merchant', [currentUser]);

  const load = async () => {
    if (!id) return;
    try {
      setLoading(true);
      const [mRes, cRes, locRes, itemRes] = await Promise.all([
        fetch('/api/admin/merchants'),
        fetch('/api/admin/product-categories'),
        fetch('/api/admin/stock-locations'),
        fetch(`/api/admin/items?id=${encodeURIComponent(id)}`),
      ]);
      if (!mRes.ok) throw new Error('Failed to load merchants');
      if (!cRes.ok) throw new Error('Failed to load categories');
      if (!locRes.ok) throw new Error('Failed to load locations');
      if (!itemRes.ok) throw new Error('Failed to load item');

      const merchantsJson = await mRes.json();
      const categoriesJson = await cRes.json();
      const locationsJson = await locRes.json();
      const itemJson = await itemRes.json();

      setOriginalItem(itemJson);

      setMerchants(merchantsJson);
      setCategories(categoriesJson);
      setLocations(locationsJson);

      setItemName(itemJson.name || '');
      setItemDescription(itemJson.description || '');
      setItemPrice(String(itemJson.price || ''));
      setItemStatus(itemJson.status || 'ACTIVE');
      setItemMerchantId(itemJson.merchantId || (isMerchantUser ? currentUser?.merchantId || '' : merchantsJson[0]?.id || ''));
      setItemCategoryId(itemJson.categoryId || categoriesJson[0]?.id || '');
      setItemImagePreview(itemJson.imageUrl || null);
      setItemVideoUrl(itemJson.videoUrl || '');

      setOptionGroups(
        (itemJson.optionGroups || []).map((g: any) => ({
          id: g.id,
          name: g.name || '',
          status: (g.status || 'ACTIVE') as 'ACTIVE' | 'INACTIVE',
          isRequired: g.isRequired !== false,
          values: (g.values || []).map((v: any) => ({
            id: v.id,
            label: v.label || '',
            priceDelta: String(v.priceDelta ?? 0),
            status: (v.status || 'ACTIVE') as 'ACTIVE' | 'INACTIVE',
          })),
        }))
      );

      const invRows: InventoryDraftRow[] = (itemJson.combinationInventoryLevels || []).map((lvl: any) => {
        let ids: string[] = [];
        try {
          const parsed = JSON.parse(lvl.optionValueIds || '[]');
          ids = Array.isArray(parsed) ? parsed : [];
        } catch {
          ids = [];
        }
        return {
          optionValueIds: ids,
          locationId: lvl.locationId,
          quantityAvailable: String(lvl.quantityAvailable ?? 0),
        };
      });
      setInventoryRows(invRows);
    } catch (err: any) {
      toast({ title: 'Error', description: err?.message || 'Failed to load data', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-line */ }, [id]);

  const saveItem = async () => {
    try {
      if (!id) throw new Error('Missing item id');
      const price = Number(itemPrice);
      if (!Number.isFinite(price) || price < 0) throw new Error('Invalid price');

      // Convert to combination rows for API
      const combinationRows = inventoryRows
        .map((r) => ({
          optionValueIds: (r.optionValueIds || []).filter(Boolean),
          locationId: r.locationId,
          quantityAvailable: Number(r.quantityAvailable),
        }))
        .filter((r) => r.locationId && r.optionValueIds.length);

      const seen = new Set<string>();
      for (const row of combinationRows) {
        const comboKey = [...new Set(row.optionValueIds)].sort().join('|');
        const key = `${comboKey}|${row.locationId}`;
        if (seen.has(key)) throw new Error('Duplicate combination + location selected in inventory');
        seen.add(key);

        const groupSeen = new Set<string>();
        for (const ovId of row.optionValueIds) {
          const gid = groupIdByOptionValueId.get(ovId) || ovId;
          if (groupSeen.has(gid)) throw new Error('Only one value per attribute is allowed in a combination.');
          groupSeen.add(gid);
        }

        if (!Number.isInteger(row.quantityAvailable) || row.quantityAvailable < 0) throw new Error('Invalid quantity available');
      }

      const parsedOptionGroups = optionGroups
        .map((g) => ({
          ...g,
          nameTrim: g.name.trim(),
          valuesParsed: (g.values || []).map((v) => ({
            ...v,
            labelTrim: v.label.trim(),
            priceDeltaNumber: Number(v.priceDelta),
          })),
        }))
        .filter((g) => g.nameTrim);

      for (const g of parsedOptionGroups) {
        for (const v of g.valuesParsed) {
          if (!v.labelTrim) throw new Error(`Option value label is required for ${g.nameTrim}`);
          if (!Number.isFinite(v.priceDeltaNumber)) throw new Error(`Invalid price adjustment for ${g.nameTrim} / ${v.labelTrim}`);
        }
      }

      const body: any = {
        id,
        merchantId: isMerchantUser ? currentUser?.merchantId : itemMerchantId,
        categoryId: itemCategoryId,
        name: itemName,
        description: itemDescription || null,
        price,
        videoUrl: itemVideoUrl || null,
        status: itemStatus,
        combinationInventoryLevels: combinationRows,
        optionGroups: parsedOptionGroups.map((g) => ({
          id: g.id,
          name: g.nameTrim,
          status: g.status,
          isRequired: g.isRequired,
          values: g.valuesParsed.map((v) => ({
            id: v.id,
            label: v.labelTrim,
            priceDelta: v.priceDeltaNumber,
            status: v.status,
          })),
        })),
      };

      if (itemImageFile) {
        const form = new FormData();
        form.append('file', itemImageFile);
        const upRes = await fetch('/api/admin/uploads', { method: 'POST', body: form });
        const upData = await upRes.json().catch(() => null);
        if (!upRes.ok) throw new Error(upData?.error || 'Failed to upload image');
        body.imageUrl = upData.url;
      } else if (itemImagePreview) {
        body.imageUrl = itemImagePreview;
      }

      await postPendingChange(
        {
          entityType: 'Merchants',
          entityId: id,
          changeType: 'UPDATE',
          payload: JSON.stringify({
            original: { type: 'Item', data: originalItem || { id } },
            updated: { type: 'Item', data: body },
          }),
        },
        'Failed to submit item update for approval.'
      );

      toast({ title: 'Submitted', description: 'Item update submitted for approval.' });
      router.push('/admin/merchants/items');
    } catch (err: any) {
      toast({ title: 'Error', description: err?.message || 'Failed to save', variant: 'destructive' });
    }
  };

  if (loading) return (<div className="flex justify-center items-center h-48"><Loader2 className="h-8 w-8 animate-spin" /></div>);

  return (
    <div className="container py-8">
      <Card>
        <CardHeader>
          <CardTitle>Edit Item</CardTitle>
          <CardDescription>Update item details used by borrowers in the shop.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-sm font-medium">Merchant</div>
              <Select value={itemMerchantId} onValueChange={setItemMerchantId} disabled={isMerchantUser}>
                <SelectTrigger><SelectValue placeholder="Select merchant" /></SelectTrigger>
                <SelectContent>
                  {merchants.map((m) => (<SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <div className="text-sm font-medium">Category</div>
              <Select value={itemCategoryId} onValueChange={setItemCategoryId}>
                <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (<SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <div className="text-sm font-medium">Name</div>
              <Input value={itemName} onChange={(e) => setItemName(e.target.value)} />
            </div>

            <div>
              <div className="text-sm font-medium">Description</div>
              <Input value={itemDescription} onChange={(e) => setItemDescription(e.target.value)} />
            </div>

            <div>
              <div className="text-sm font-medium">Price (ETB)</div>
              <Input value={itemPrice} onChange={(e) => setItemPrice(e.target.value)} inputMode="decimal" />
            </div>

            <div>
              <div className="text-sm font-medium">Status</div>
              <Select value={itemStatus} onValueChange={(v) => setItemStatus(v as any)}>
                <SelectTrigger><SelectValue placeholder="Select status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ACTIVE">ACTIVE</SelectItem>
                  <SelectItem value="INACTIVE">INACTIVE</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <div className="text-sm font-medium">Image</div>
              <div className="flex items-center gap-4">
                <input type="file" accept="image/*" onChange={(e) => { const f = e.target.files?.[0] || null; setItemImageFile(f); if (f) setItemImagePreview(URL.createObjectURL(f)); }} />
                {itemImagePreview && (<img src={itemImagePreview} alt="preview" className="w-16 h-16 object-cover rounded" />)}
              </div>
            </div>

            <div>
              <div className="text-sm font-medium">Product video URL (YouTube, TikTok, etc.)</div>
              <Input value={itemVideoUrl} onChange={(e) => setItemVideoUrl(e.target.value)} placeholder="https://youtube.com/..." />
            </div>

            <div className="col-span-2">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-medium">Attributes (e.g. Color, Size) with price adjustments</div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    setOptionGroups((prev) => [
                      ...prev,
                      { name: '', status: 'ACTIVE', isRequired: true, values: [{ label: '', priceDelta: '0', status: 'ACTIVE' }] },
                    ])
                  }
                >
                  Add Attribute
                </Button>
              </div>

              {optionGroups.length === 0 ? (
                <div className="text-sm text-muted-foreground">No attributes added.</div>
              ) : (
                <div className="space-y-4 mt-2">
                  {optionGroups.map((g, gIdx) => (
                    <div key={g.id || gIdx} className="border rounded p-3 space-y-3">
                      <div className="flex items-center gap-2">
                        <div className="flex-1">
                          <div className="text-sm font-medium">Attribute name</div>
                          <Input
                            placeholder="Color"
                            value={g.name}
                            onChange={(e) =>
                              setOptionGroups((prev) => prev.map((p, i) => (i === gIdx ? { ...p, name: e.target.value } : p)))
                            }
                          />
                        </div>
                        <Button
                          type="button"
                          variant="destructive"
                          onClick={() => setOptionGroups((prev) => prev.filter((_, i) => i !== gIdx))}
                        >
                          Remove
                        </Button>
                      </div>

                      <div className="flex items-center justify-between">
                        <div className="text-sm font-medium">Values</div>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() =>
                            setOptionGroups((prev) =>
                              prev.map((p, i) =>
                                i === gIdx
                                  ? { ...p, values: [...p.values, { label: '', priceDelta: '0', status: 'ACTIVE' }] }
                                  : p
                              )
                            )
                          }
                        >
                          Add Value
                        </Button>
                      </div>

                      {g.values.length === 0 ? (
                        <div className="text-sm text-muted-foreground">No values.</div>
                      ) : (
                        <div className="space-y-2">
                          {g.values.map((v, vIdx) => (
                            <div key={v.id || vIdx} className="grid grid-cols-12 gap-2 items-center">
                              <Input
                                className="col-span-7"
                                placeholder="White"
                                value={v.label}
                                onChange={(e) =>
                                  setOptionGroups((prev) =>
                                    prev.map((p, i) =>
                                      i === gIdx
                                        ? {
                                            ...p,
                                            values: p.values.map((pv, j) => (j === vIdx ? { ...pv, label: e.target.value } : pv)),
                                          }
                                        : p
                                    )
                                  )
                                }
                              />
                              <Input
                                className="col-span-4"
                                placeholder="+10"
                                inputMode="decimal"
                                value={v.priceDelta}
                                onChange={(e) =>
                                  setOptionGroups((prev) =>
                                    prev.map((p, i) =>
                                      i === gIdx
                                        ? {
                                            ...p,
                                            values: p.values.map((pv, j) => (j === vIdx ? { ...pv, priceDelta: e.target.value } : pv)),
                                          }
                                        : p
                                    )
                                  )
                                }
                              />
                              <Button
                                type="button"
                                variant="destructive"
                                className="col-span-1"
                                onClick={() =>
                                  setOptionGroups((prev) =>
                                    prev.map((p, i) =>
                                      i === gIdx ? { ...p, values: p.values.filter((_, j) => j !== vIdx) } : p
                                    )
                                  )
                                }
                              >
                                X
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="col-span-2">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-medium">Inventory by attribute value + location (available quantity)</div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    setInventoryRows((prev) => [
                      ...prev,
                      { optionValueIds: [], locationId: locations[0]?.id || '', quantityAvailable: '0' },
                    ])
                  }
                  disabled={!locations.length || !optionValueOptions.length}
                >
                  Add Location
                </Button>
              </div>

              {!locations.length ? (
                <div className="text-sm text-muted-foreground">Create a location first to assign quantities.</div>
              ) : !optionValueOptions.length ? (
                <div className="text-sm text-muted-foreground">Add attribute values first to assign inventory.</div>
              ) : inventoryRows.length === 0 ? (
                <div className="text-sm text-muted-foreground">No location quantities set.</div>
              ) : (
                <div className="space-y-2 mt-2">
                  {inventoryRows.map((row, idx) => (
                    <div key={`${row.locationId || 'loc'}-${idx}`} className="grid grid-cols-12 gap-2 items-center">
                      <div className="col-span-5">
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button variant="outline" className="w-full justify-start">
                              <span className="truncate">
                                {row.optionValueIds?.length
                                  ? row.optionValueIds
                                      .map((id) => optionValueLabelById.get(id) || id)
                                      .slice(0, 2)
                                      .join(', ') + (row.optionValueIds.length > 2 ? ` (+${row.optionValueIds.length - 2})` : '')
                                  : 'Select attribute value(s)'}
                              </span>
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent align="start" className="w-80 p-3">
                            <div className="text-sm font-medium mb-2">Attribute values</div>
                            <div className="max-h-56 overflow-auto space-y-2">
                              {optionValueOptions.map((o) => {
                                const checked = row.optionValueIds?.includes(o.id);
                                return (
                                  <label key={o.id} className="flex items-center gap-2 text-sm cursor-pointer">
                                    <Checkbox
                                      checked={checked}
                                      onCheckedChange={(v) => {
                                        const isChecked = Boolean(v);
                                        setInventoryRows((prev) =>
                                          prev.map((p, i) => {
                                            if (i !== idx) return p;
                                            const cur = p.optionValueIds || [];
                                            const next = isChecked
                                              ? [...new Set([...cur, o.id])]
                                              : cur.filter((x) => x !== o.id);

                                            // enforce one value per group (replace existing selection from same group)
                                            const groupId = groupIdByOptionValueId.get(o.id);
                                            const filtered = groupId
                                              ? next.filter((id) => {
                                                  const gid = groupIdByOptionValueId.get(id);
                                                  return gid !== groupId || id === o.id;
                                                })
                                              : next;

                                            return { ...p, optionValueIds: filtered };
                                          })
                                        );
                                      }}
                                    />
                                    <span>{o.label}</span>
                                  </label>
                                );
                              })}
                            </div>
                          </PopoverContent>
                        </Popover>
                      </div>
                      <div className="col-span-4">
                        <Select
                          value={row.locationId}
                          onValueChange={(v) =>
                            setInventoryRows((prev) => prev.map((p, i) => (i === idx ? { ...p, locationId: v } : p)))
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select location" />
                          </SelectTrigger>
                          <SelectContent>
                            {locations.map((l) => (
                              <SelectItem key={l.id} value={l.id}>
                                {l.name}{l.isActive ? '' : ' (INACTIVE)'}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <Input
                        className="col-span-2"
                        inputMode="numeric"
                        placeholder="0"
                        value={row.quantityAvailable}
                        onChange={(e) =>
                          setInventoryRows((prev) => prev.map((p, i) => (i === idx ? { ...p, quantityAvailable: e.target.value } : p)))
                        }
                      />
                      <Button
                        type="button"
                        variant="destructive"
                        className="col-span-1"
                        onClick={() => setInventoryRows((prev) => prev.filter((_, i) => i !== idx))}
                      >
                        X
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => router.push('/admin/merchants/items')}>Cancel</Button>
            <Button onClick={saveItem} style={{ backgroundColor: themeColor }} className="text-white" disabled={!itemName.trim() || !itemMerchantId || !itemCategoryId}>Save</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
