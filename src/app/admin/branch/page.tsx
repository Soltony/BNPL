'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRequirePermission } from '@/hooks/use-require-permission';
import { useAuth } from '@/hooks/use-auth';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Loader2, PlusCircle } from 'lucide-react';

type Merchant = { id: string; name: string; status: 'ACTIVE' | 'INACTIVE' };
type Category = { id: string; name: string; status: 'ACTIVE' | 'INACTIVE' };

function StatusBadge({ status }: { status: string }) {
  const variant = status === 'ACTIVE' ? 'secondary' : 'destructive';
  return <Badge variant={variant}>{status}</Badge>;
}

export default function BranchPage() {
  useRequirePermission('branch');
  const { currentUser } = useAuth();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);

  const [merchantDialogOpen, setMerchantDialogOpen] = useState(false);
  const [editingMerchant, setEditingMerchant] = useState<Merchant | null>(null);
  const [merchantName, setMerchantName] = useState('');
  const [merchantStatus, setMerchantStatus] = useState<'ACTIVE' | 'INACTIVE'>('ACTIVE');

  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [categoryName, setCategoryName] = useState('');
  const [categoryStatus, setCategoryStatus] = useState<'ACTIVE' | 'INACTIVE'>('ACTIVE');

  // Merchant users (accounts with merchant role) management
  const [merchantUsers, setMerchantUsers] = useState<Array<{ id: string; fullName: string; email?: string | null; phoneNumber?: string | null; merchant?: { id: string; name: string } }>>([]);
  const [newUserName, setNewUserName] = useState('');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserPhone, setNewUserPhone] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [newUserMerchantId, setNewUserMerchantId] = useState<string>('');
  const [loadingUsers, setLoadingUsers] = useState(false);

  const fetchMerchantUsers = async () => {
    try {
      setLoadingUsers(true);
      const res = await fetch('/api/admin/merchant-users');
      if (!res.ok) throw new Error('Failed to load merchant users');
      const data = await res.json();
      setMerchantUsers(data.data || []);
    } catch (err: any) {
      toast({ title: 'Error', description: err?.message || 'Failed to load merchant users', variant: 'destructive' });
    } finally {
      setLoadingUsers(false);
    }
  };

  const createMerchantUser = async () => {
    try {
      const payload = { fullName: newUserName, email: newUserEmail || null, phone: newUserPhone || null, password: newUserPassword || undefined, merchantId: newUserMerchantId || undefined };
      const res = await fetch('/api/admin/merchant-users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Failed to create merchant user');
      toast({ title: 'Saved', description: 'Merchant user created.' });
      setNewUserName(''); setNewUserEmail(''); setNewUserPhone(''); setNewUserPassword(''); setNewUserMerchantId('');
      await fetchMerchantUsers();
    } catch (err: any) {
      toast({ title: 'Error', description: err?.message || 'Failed to create', variant: 'destructive' });
    }
  };

  const deleteMerchantUser = async (id: string) => {
    try {
      const res = await fetch(`/api/admin/merchant-users?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Failed to delete');
      toast({ title: 'Deleted', description: 'Merchant user removed.' });
      await fetchMerchantUsers();
    } catch (err: any) {
      toast({ title: 'Error', description: err?.message || 'Failed to delete', variant: 'destructive' });
    }
  };

  const themeColor = useMemo(() => {
    // keep consistent with existing admin pages; default to current theme primary
    return currentUser?.role === 'Super Admin' ? 'hsl(var(--primary))' : 'hsl(var(--primary))';
  }, [currentUser]);

  const load = async () => {
    try {
      setLoading(true);
      const [mRes, cRes] = await Promise.all([
        fetch('/api/admin/merchants'),
        fetch('/api/admin/product-categories'),
      ]);
      if (!mRes.ok) throw new Error('Failed to load merchants');
      if (!cRes.ok) throw new Error('Failed to load categories');
      setMerchants(await mRes.json());
      setCategories(await cRes.json());
      // Also load merchant users for the Merchant Users tab
      await fetchMerchantUsers();
    } catch (err: any) {
      toast({ title: 'Error', description: err?.message || 'Failed to load data', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openAddMerchant = () => {
    setEditingMerchant(null);
    setMerchantName('');
    setMerchantStatus('ACTIVE');
    setMerchantDialogOpen(true);
  };

  const openEditMerchant = (m: Merchant) => {
    setEditingMerchant(m);
    setMerchantName(m.name);
    setMerchantStatus(m.status);
    setMerchantDialogOpen(true);
  };

  const saveMerchant = async () => {
    try {
      const method = editingMerchant ? 'PUT' : 'POST';
      const body = editingMerchant
        ? { id: editingMerchant.id, name: merchantName, status: merchantStatus }
        : { name: merchantName, status: merchantStatus };

      const res = await fetch('/api/admin/merchants', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Failed to save merchant');

      toast({ title: 'Saved', description: 'Merchant saved successfully.' });
      setMerchantDialogOpen(false);
      await load();
    } catch (err: any) {
      toast({ title: 'Error', description: err?.message || 'Failed to save', variant: 'destructive' });
    }
  };

  const deleteMerchant = async (id: string) => {
    try {
      const res = await fetch(`/api/admin/merchants?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Failed to delete merchant');
      toast({ title: 'Deleted', description: 'Merchant deleted.' });
      await load();
    } catch (err: any) {
      toast({ title: 'Error', description: err?.message || 'Failed to delete', variant: 'destructive' });
    }
  };

  const openAddCategory = () => {
    setEditingCategory(null);
    setCategoryName('');
    setCategoryStatus('ACTIVE');
    setCategoryDialogOpen(true);
  };

  const openEditCategory = (c: Category) => {
    setEditingCategory(c);
    setCategoryName(c.name);
    setCategoryStatus(c.status);
    setCategoryDialogOpen(true);
  };

  const saveCategory = async () => {
    try {
      const method = editingCategory ? 'PUT' : 'POST';
      const body = editingCategory
        ? { id: editingCategory.id, name: categoryName, status: categoryStatus }
        : { name: categoryName, status: categoryStatus };

      const res = await fetch('/api/admin/product-categories', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Failed to save category');

      toast({ title: 'Saved', description: 'Category saved successfully.' });
      setCategoryDialogOpen(false);
      await load();
    } catch (err: any) {
      toast({ title: 'Error', description: err?.message || 'Failed to save', variant: 'destructive' });
    }
  };

  const deleteCategory = async (id: string) => {
    try {
      const res = await fetch(`/api/admin/product-categories?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Failed to delete category');
      toast({ title: 'Deleted', description: 'Category deleted.' });
      await load();
    } catch (err: any) {
      toast({ title: 'Error', description: err?.message || 'Failed to delete', variant: 'destructive' });
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-48">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Branch</CardTitle>
          <CardDescription>Create and manage merchants and product categories.</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="merchants">
            <TabsList>
              <TabsTrigger value="merchants">Merchants</TabsTrigger>
              <TabsTrigger value="merchant-users">Merchant Users</TabsTrigger>
              <TabsTrigger value="categories">Product Categories</TabsTrigger>
            </TabsList>

            <TabsContent value="merchants" className="space-y-4">
              <div className="flex justify-end">
                <Button onClick={openAddMerchant} style={{ backgroundColor: themeColor }} className="text-white">
                  <PlusCircle className="mr-2 h-4 w-4" /> Add Merchant
                </Button>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-[220px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {merchants.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="font-medium">{m.name}</TableCell>
                      <TableCell><StatusBadge status={m.status} /></TableCell>
                      <TableCell className="flex gap-2">
                        <Button variant="outline" onClick={() => openEditMerchant(m)}>Edit</Button>
                        <Button variant="destructive" onClick={() => deleteMerchant(m.id)}>Delete</Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TabsContent>

            <TabsContent value="merchant-users" className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle>Register Merchant User</CardTitle>
                    <CardDescription>Create platform users with the merchant role.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      <div className="space-y-1">
                        <div className="text-sm font-medium">Full name</div>
                        <Input value={newUserName} onChange={(e) => setNewUserName(e.target.value)} />
                      </div>
                      <div className="space-y-1">
                        <div className="text-sm font-medium">Email</div>
                        <Input value={newUserEmail} onChange={(e) => setNewUserEmail(e.target.value)} />
                      </div>
                      <div className="space-y-1">
                        <div className="text-sm font-medium">Phone</div>
                        <Input value={newUserPhone} onChange={(e) => setNewUserPhone(e.target.value)} />
                      </div>
                      <div className="space-y-1">
                        <div className="text-sm font-medium">Password (optional)</div>
                        <Input value={newUserPassword} onChange={(e) => setNewUserPassword(e.target.value)} />
                      </div>

                      <div className="space-y-1">
                        <div className="text-sm font-medium">Associate Merchant</div>
                        <Select value={newUserMerchantId} onValueChange={(v) => setNewUserMerchantId(v)}>
                          <SelectTrigger>
                            <SelectValue placeholder="Select merchant" />
                          </SelectTrigger>
                          <SelectContent>
                            {merchants.map(m => (
                              <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </CardContent>
                  <CardFooter>
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" onClick={() => { setNewUserName(''); setNewUserEmail(''); setNewUserPhone(''); setNewUserPassword(''); setNewUserMerchantId(''); }}>Cancel</Button>
                      <Button onClick={createMerchantUser} disabled={!newUserName.trim() || !newUserMerchantId}>Create Merchant User</Button>
                    </div>
                  </CardFooter>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Existing Merchant Users</CardTitle>
                    <CardDescription>Accounts with the merchant role.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {loadingUsers ? (
                      <div className="flex justify-center items-center h-36"><Loader2 className="h-6 w-6 animate-spin" /></div>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Name</TableHead>
                            <TableHead>Email</TableHead>
                            <TableHead>Phone</TableHead>
                                <TableHead>Merchant</TableHead>
                                <TableHead className="w-[160px]">Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {merchantUsers.map(u => (
                            <TableRow key={u.id}>
                              <TableCell className="font-medium">{u.fullName}</TableCell>
                              <TableCell>{u.email || '-'}</TableCell>
                                  <TableCell>{u.phoneNumber || '-'}</TableCell>
                                  <TableCell>{u.merchant?.name || '-'}</TableCell>
                              <TableCell className="flex gap-2">
                                <Button variant="destructive" onClick={() => deleteMerchantUser(u.id)}>Delete</Button>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="categories" className="space-y-4">
              <div className="flex justify-end">
                <Button onClick={openAddCategory} style={{ backgroundColor: themeColor }} className="text-white">
                  <PlusCircle className="mr-2 h-4 w-4" /> Add Category
                </Button>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-[220px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {categories.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">{c.name}</TableCell>
                      <TableCell><StatusBadge status={c.status} /></TableCell>
                      <TableCell className="flex gap-2">
                        <Button variant="outline" onClick={() => openEditCategory(c)}>Edit</Button>
                        <Button variant="destructive" onClick={() => deleteCategory(c.id)}>Delete</Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Dialog open={merchantDialogOpen} onOpenChange={setMerchantDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingMerchant ? 'Edit Merchant' : 'Add Merchant'}</DialogTitle>
            <DialogDescription>Merchant name and status.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="text-sm font-medium">Name</div>
              <Input value={merchantName} onChange={(e) => setMerchantName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <div className="text-sm font-medium">Status</div>
              <Select value={merchantStatus} onValueChange={(v) => setMerchantStatus(v as any)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ACTIVE">ACTIVE</SelectItem>
                  <SelectItem value="INACTIVE">INACTIVE</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMerchantDialogOpen(false)}>Cancel</Button>
            <Button onClick={saveMerchant} style={{ backgroundColor: themeColor }} className="text-white" disabled={!merchantName.trim()}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={categoryDialogOpen} onOpenChange={setCategoryDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingCategory ? 'Edit Category' : 'Add Category'}</DialogTitle>
            <DialogDescription>Category name and status.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="text-sm font-medium">Name</div>
              <Input value={categoryName} onChange={(e) => setCategoryName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <div className="text-sm font-medium">Status</div>
              <Select value={categoryStatus} onValueChange={(v) => setCategoryStatus(v as any)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ACTIVE">ACTIVE</SelectItem>
                  <SelectItem value="INACTIVE">INACTIVE</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCategoryDialogOpen(false)}>Cancel</Button>
            <Button onClick={saveCategory} style={{ backgroundColor: themeColor }} className="text-white" disabled={!categoryName.trim()}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
