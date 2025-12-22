'use client';

import React, { useState, useEffect } from 'react';
import { useRequirePermission } from '@/hooks/use-require-permission';
import { PlusCircle, MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { AddUserDialog } from '@/components/user/add-user-dialog';
import { AddRoleDialog } from '@/components/user/add-role-dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { User, Role, LoanProvider, Permissions } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-auth';
import { Loader2 } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { allMenuItems } from '@/lib/menu-items';


const PERMISSION_MODULES = allMenuItems.map(item => item.label.toLowerCase().replace(/\s+/g, '-')).concat(['products']);


function UsersTab() {
    useRequirePermission('access-control');
    const [users, setUsers] = useState<User[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [roles, setRoles] = useState<Role[]>([]);
    const [providers, setProviders] = useState<LoanProvider[]>([]);
    const { currentUser } = useAuth();
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [editingUser, setEditingUser] = useState<User | null>(null);
    const { toast } = useToast();
    
    const themeColor = React.useMemo(() => {
        if (currentUser?.role === 'Admin' || currentUser?.role === 'Super Admin') {
            return providers.find(p => p.name === 'NIb Bank')?.colorHex || '#fdb913';
        }
        return providers.find(p => p.name === currentUser?.providerName)?.colorHex || '#fdb913';
    }, [currentUser, providers]);

    const fetchInitialData = async () => {
        try {
            setIsLoading(true);
            const [usersResponse, rolesResponse, providersResponse] = await Promise.all([
                fetch('/api/users'),
                fetch('/api/roles'),
                fetch('/api/providers')
            ]);
            if (!usersResponse.ok) throw new Error('Failed to fetch users');
            if (!rolesResponse.ok) throw new Error('Failed to fetch roles');
            if (!providersResponse.ok) throw new Error('Failed to fetch providers');
            
            const usersData = await usersResponse.json();
            const rolesData = await rolesResponse.json();
            const providersData = await providersResponse.json();

            setUsers(usersData);
            setRoles(rolesData);
            setProviders(providersData);
        } catch (error) {
            toast({
                title: 'Error',
                description: 'Could not load initial data.',
                variant: 'destructive',
            });
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchInitialData();
    }, []);

    const handleOpenDialog = (user: User | null = null) => {
        setEditingUser(user);
        setIsDialogOpen(true);
    };

    const handleCloseDialog = () => {
        setEditingUser(null);
        setIsDialogOpen(false);
    };

    const handleSaveUser = async (userData: Omit<User, 'id'> & { id?: string; password?: string }) => {
        const method = editingUser ? 'PUT' : 'POST';
        const endpoint = '/api/users';
        const body = JSON.stringify(editingUser ? { ...userData, id: editingUser.id } : userData);

        try {
            const response = await fetch(endpoint, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body,
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to save user.');
            }
            
            toast({
                title: `User ${editingUser ? 'Updated' : 'Added'}`,
                description: `${userData.fullName} has been successfully ${editingUser ? 'updated' : 'added'}.`,
            });
            fetchInitialData();
        } catch (error: any) {
            toast({
                title: 'Error',
                description: error.message,
                variant: 'destructive',
            });
        }
    };
    
    const handleToggleStatus = async (user: User) => {
        const newStatus = user.status === 'Active' ? 'Inactive' : 'Active';
        try {
            const response = await fetch('/api/users', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: user.id, status: newStatus }),
            });
            
             if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to update status.');
            }
            
            toast({
                title: `User ${newStatus === 'Active' ? 'Activated' : 'Deactivated'}`,
                description: `${user.fullName}'s status has been changed to ${newStatus}.`,
            });
            fetchInitialData();
        } catch (error: any) {
             toast({
                title: 'Error',
                description: error.message,
                variant: 'destructive',
            });
        }
    };

    if (isLoading) {
        return <div className="flex justify-center items-center h-48"><Loader2 className="h-8 w-8 animate-spin" /></div>
    }

    return (
        <>
            <div className="flex items-center justify-between space-y-2 mb-4">
                <div/>
                <Button onClick={() => handleOpenDialog()} style={{ backgroundColor: themeColor }} className="text-white">
                    <PlusCircle className="mr-2 h-4 w-4" /> Add User
                </Button>
            </div>
            <Card>
                <CardHeader>
                    <CardTitle>Users</CardTitle>
                    <CardDescription>Manage registered users and their roles.</CardDescription>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Full Name</TableHead>
                                <TableHead>Email</TableHead>
                                <TableHead>Role</TableHead>
                                <TableHead>Provider</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead>Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {users.map((user) => (
                                <TableRow key={user.id}>
                                    <TableCell className="font-medium">{user.fullName}</TableCell>
                                    <TableCell>{user.email}</TableCell>
                                    <TableCell>
                                        <Badge variant={user.role === 'Admin' || user.role === 'Super Admin' ? 'default' : 'secondary'} style={user.role === 'Admin' || user.role === 'Super Admin' ? { backgroundColor: themeColor, color: 'white' } : {}}>
                                            {user.role}
                                        </Badge>
                                    </TableCell>
                                    <TableCell>{user.providerName}</TableCell>
                                    <TableCell>
                                        <Badge variant={user.status === 'Active' ? 'secondary' : 'destructive'} style={user.status === 'Active' ? { backgroundColor: '#16a34a', color: 'white' } : {}}>
                                            {user.status}
                                        </Badge>
                                    </TableCell>
                                    <TableCell>
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <Button variant="ghost" className="h-8 w-8 p-0">
                                                    <span className="sr-only">Open menu</span>
                                                    <MoreHorizontal className="h-4 w-4" />
                                                </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="end">
                                                <DropdownMenuLabel>Actions</DropdownMenuLabel>
                                                <DropdownMenuItem onClick={() => handleOpenDialog(user)}>Edit</DropdownMenuItem>
                                                <DropdownMenuItem onClick={() => handleToggleStatus(user)}>
                                                    {user.status === 'Active' ? 'Deactivate' : 'Activate'}
                                                </DropdownMenuItem>
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
            <AddUserDialog
                isOpen={isDialogOpen}
                onClose={handleCloseDialog}
                onSave={handleSaveUser}
                user={editingUser}
                roles={roles}
                providers={providers}
                primaryColor={themeColor}
            />
        </>
    );
}

function DistrictsTab() {
    const [districts, setDistricts] = React.useState<Array<any>>([]);
    const [newDistrictName, setNewDistrictName] = React.useState('');
    const [editingDistrictId, setEditingDistrictId] = React.useState<string | null>(null);
    const [districtEditingId, setDistrictEditingId] = React.useState<string | null>(null);
    const [districtEditingName, setDistrictEditingName] = React.useState<string>('');
    const [newBranchName, setNewBranchName] = React.useState('');
    const [branchEditingId, setBranchEditingId] = React.useState<string | null>(null);
    const [branchEditingName, setBranchEditingName] = React.useState<string>('');
    const { toast } = useToast();

    useEffect(() => {
        const load = async () => {
            try {
                const res = await fetch('/api/districts');
                if (!res.ok) throw new Error('Failed to load districts');
                const data = await res.json();
                setDistricts(data || []);
            } catch (e) {
                console.error('Failed to load districts', e);
                toast({ title: 'Error', description: 'Could not load districts', variant: 'destructive' });
            }
        };
        load();
    }, []);

    const addDistrict = async () => {
        if (!newDistrictName.trim()) return toast({ title: 'Error', description: 'District name required', variant: 'destructive' });
        try {
            const res = await fetch('/api/districts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newDistrictName.trim() }) });
            if (!res.ok) throw new Error('Failed to create');
            setNewDistrictName('');
            const created = await res.json();
            setDistricts(prev => [...(prev||[]), { ...created, branches: [] }]);
            toast({ title: 'Saved', description: 'District added.' });
        } catch (e) {
            console.error(e);
            toast({ title: 'Error', description: 'Could not add district', variant: 'destructive' });
        }
    };

    const removeDistrict = async (id: string) => {
        try {
            const res = await fetch(`/api/districts?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
            if (!res.ok) throw new Error('Failed to delete');
            setDistricts(prev => (prev||[]).filter(d => d.id !== id));
            toast({ title: 'Removed', description: 'District removed.' });
        } catch (e) {
            console.error(e);
            toast({ title: 'Error', description: 'Could not remove district', variant: 'destructive' });
        }
    };

    const startEditDistrict = (d: any) => {
        setDistrictEditingId(d.id);
        setDistrictEditingName(d.name);
    };

    const cancelEditDistrict = () => {
        setDistrictEditingId(null);
        setDistrictEditingName('');
    };

    const saveEditDistrict = async () => {
        if (!districtEditingId || !districtEditingName.trim()) return toast({ title: 'Error', description: 'Name required', variant: 'destructive' });
        try {
            const res = await fetch('/api/districts', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: districtEditingId, name: districtEditingName.trim() }) });
            if (!res.ok) throw new Error('Failed to update district');
            const updated = await res.json();
            setDistricts(prev => (prev||[]).map(d => d.id === updated.id ? { ...d, name: updated.name } : d));
            cancelEditDistrict();
            toast({ title: 'Saved', description: 'District updated.' });
        } catch (e) {
            console.error(e);
            toast({ title: 'Error', description: 'Could not update district', variant: 'destructive' });
        }
    };

    const addBranch = async (districtId: string) => {
        if (!newBranchName.trim()) return toast({ title: 'Error', description: 'Branch name required', variant: 'destructive' });
        try {
            const res = await fetch('/api/districts/branches', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ districtId, name: newBranchName.trim() }) });
            if (!res.ok) throw new Error('Failed to create branch');
            const created = await res.json();
            setDistricts(prev => (prev||[]).map(d => d.id === districtId ? { ...d, branches: [...(d.branches||[]), created] } : d));
            setNewBranchName('');
            setEditingDistrictId(null);
            toast({ title: 'Saved', description: 'Branch added.' });
        } catch (e) {
            console.error(e);
            toast({ title: 'Error', description: 'Could not add branch', variant: 'destructive' });
        }
    };

    const removeBranch = async (districtId: string, branchId: string) => {
        try {
            const res = await fetch(`/api/districts/branches?id=${encodeURIComponent(branchId)}`, { method: 'DELETE' });
            if (!res.ok) throw new Error('Failed to delete branch');
            setDistricts(prev => (prev||[]).map(d => d.id === districtId ? { ...d, branches: (d.branches||[]).filter((b:any) => b.id !== branchId) } : d));
            toast({ title: 'Removed', description: 'Branch removed.' });
        } catch (e) {
            console.error(e);
            toast({ title: 'Error', description: 'Could not remove branch', variant: 'destructive' });
        }
    };

    const startEditBranch = (b: any) => {
        setBranchEditingId(b.id);
        setBranchEditingName(b.name);
    };

    const cancelEditBranch = () => {
        setBranchEditingId(null);
        setBranchEditingName('');
    };

    const saveEditBranch = async (districtId: string) => {
        if (!branchEditingId || !branchEditingName.trim()) return toast({ title: 'Error', description: 'Name required', variant: 'destructive' });
        try {
            const res = await fetch('/api/districts/branches', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: branchEditingId, name: branchEditingName.trim() }) });
            if (!res.ok) throw new Error('Failed to update branch');
            const updated = await res.json();
            setDistricts(prev => (prev||[]).map(d => d.id === districtId ? { ...d, branches: (d.branches||[]).map((br:any) => br.id === updated.id ? updated : br) } : d));
            cancelEditBranch();
            toast({ title: 'Saved', description: 'Branch updated.' });
        } catch (e) {
            console.error(e);
            toast({ title: 'Error', description: 'Could not update branch', variant: 'destructive' });
        }
    };

    return (
        <>
            <div className="flex items-center justify-between space-y-2 mb-4">
                <div className="flex items-center space-x-2">
                    <Input placeholder="New district name" value={newDistrictName} onChange={(e) => setNewDistrictName(e.target.value)} />
                    <Button onClick={addDistrict}>Add District</Button>
                </div>
            </div>
            <Card>
                <CardHeader>
                    <CardTitle>Districts & Branches</CardTitle>
                    <CardDescription>Manage hierarchical districts and their branches. Changes are persisted to the server database.</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="space-y-4">
                        {(districts || []).map((d: any) => (
                            <div key={d.id} className="border rounded p-3">
                                <div className="flex justify-between items-center">
                                    <div>
                                        {districtEditingId === d.id ? (
                                            <div className="flex items-center space-x-2">
                                                <Input value={districtEditingName} onChange={(e) => setDistrictEditingName(e.target.value)} />
                                                <Button size="sm" onClick={saveEditDistrict}>Save</Button>
                                                <Button size="sm" variant="outline" onClick={cancelEditDistrict}>Cancel</Button>
                                            </div>
                                        ) : (
                                            <div className="font-medium">{d.name}</div>
                                        )}
                                    </div>
                                    <div className="space-x-2">
                                        <Button size="sm" variant="ghost" onClick={() => setEditingDistrictId(d.id)}>Add Branch</Button>
                                        {districtEditingId === d.id ? null : <Button size="sm" variant="ghost" onClick={() => startEditDistrict(d)}>Edit</Button>}
                                        <Button size="sm" variant="destructive" onClick={() => removeDistrict(d.id)}>Delete</Button>
                                    </div>
                                </div>
                                <div className="mt-2">
                                    <div className="text-sm text-muted-foreground">Branches</div>
                                    <ul className="mt-1 space-y-1">
                                        {(d.branches||[]).map((b: any) => (
                                            <li key={b.id} className="flex justify-between items-center">
                                                <div>
                                                    {branchEditingId === b.id ? (
                                                        <div className="flex items-center space-x-2">
                                                            <Input value={branchEditingName} onChange={(e) => setBranchEditingName(e.target.value)} />
                                                            <Button size="sm" onClick={() => saveEditBranch(d.id)}>Save</Button>
                                                            <Button size="sm" variant="outline" onClick={cancelEditBranch}>Cancel</Button>
                                                        </div>
                                                    ) : (
                                                        <div>{b.name}</div>
                                                    )}
                                                </div>
                                                <div className="space-x-2">
                                                    {branchEditingId === b.id ? null : <Button size="sm" variant="ghost" onClick={() => startEditBranch(b)}>Edit</Button>}
                                                    <Button size="sm" variant="ghost" onClick={() => removeBranch(d.id, b.id)}>Remove</Button>
                                                </div>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                                {editingDistrictId === d.id && (
                                    <div className="mt-3 flex items-center space-x-2">
                                        <Input placeholder="Branch name" value={newBranchName} onChange={(e) => setNewBranchName(e.target.value)} />
                                        <Button onClick={() => addBranch(d.id)}>Add</Button>
                                        <Button variant="outline" onClick={() => { setEditingDistrictId(null); setNewBranchName(''); }}>Cancel</Button>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </CardContent>
            </Card>
        </>
    );
}

function RolesTab() {
    const [roles, setRoles] = useState<Role[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [providers, setProviders] = useState<LoanProvider[]>([]);
    const { currentUser } = useAuth();
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [editingRole, setEditingRole] = useState<Role | null>(null);
    const [deletingRoleId, setDeletingRoleId] = useState<string | null>(null);
    const { toast } = useToast();

    const themeColor = React.useMemo(() => {
        if (currentUser?.role === 'Admin' || currentUser?.role === 'Super Admin') {
            return providers.find(p => p.name === 'NIb Bank')?.colorHex || '#fdb913';
        }
        return providers.find(p => p.name === currentUser?.providerName)?.colorHex || '#fdb913';
    }, [currentUser, providers]);

    const fetchRolesAndProviders = async () => {
        try {
            setIsLoading(true);
            const [rolesResponse, providersResponse] = await Promise.all([
                fetch('/api/roles'),
                fetch('/api/providers')
            ]);
            if (!rolesResponse.ok) throw new Error('Failed to fetch roles');
            if (!providersResponse.ok) throw new Error('Failed to fetch providers');
            const rolesData = await rolesResponse.json();
            const providersData = await providersResponse.json();
            setRoles(rolesData);
            setProviders(providersData);
        } catch (error) {
            toast({
                title: 'Error',
                description: 'Could not load role data.',
                variant: 'destructive',
            });
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchRolesAndProviders();
    }, []);

    const handleOpenDialog = (role: Role | null = null) => {
        setEditingRole(role);
        setIsDialogOpen(true);
    };

    const handleCloseDialog = () => {
        setEditingRole(null);
        setIsDialogOpen(false);
    };

    const handleSaveRole = async (roleData: Omit<Role, 'id'>) => {
        const method = editingRole ? 'PUT' : 'POST';
        const endpoint = '/api/roles';
        const body = JSON.stringify(editingRole ? { ...roleData, id: editingRole.id } : roleData);

        try {
            const response = await fetch(endpoint, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body,
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to save role.');
            }
            
            toast({
                title: `Role ${editingRole ? 'Updated' : 'Added'}`,
                description: `${roleData.name} has been successfully ${editingRole ? 'updated' : 'added'}.`,
            });
            fetchRolesAndProviders();
        } catch (error: any) {
            toast({
                title: 'Error',
                description: error.message,
                variant: 'destructive',
            });
        }
    };
    
    const handleDeleteRole = async () => {
        if (!deletingRoleId) return;
        try {
            const response = await fetch('/api/roles', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: deletingRoleId }),
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to delete role.');
            }
            
            toast({
                title: 'Role Deleted',
                description: 'The role has been successfully deleted.',
            });
            fetchRolesAndProviders();
        } catch (error: any) {
            toast({
                title: 'Error',
                description: error.message,
                variant: 'destructive',
            });
        } finally {
            setDeletingRoleId(null);
        }
    };
    
    if (isLoading) {
        return <div className="flex justify-center items-center h-48"><Loader2 className="h-8 w-8 animate-spin" /></div>
    }

    return (
        <>
            <div className="flex items-center justify-between space-y-2 mb-4">
                <div />
                <Button onClick={() => handleOpenDialog()} style={{ backgroundColor: themeColor }} className="text-white">
                    <PlusCircle className="mr-2 h-4 w-4" /> Add Role
                </Button>
            </div>
            <Card>
                <CardHeader>
                    <CardTitle>Roles</CardTitle>
                    <CardDescription>Define roles to control user access and permissions across the application.</CardDescription>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-[150px]">Role Name</TableHead>
                                {PERMISSION_MODULES.map(module => (
                                    <TableHead key={module} className="text-center capitalize">{module.replace(/-/g, ' ')}</TableHead>
                                ))}
                                <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {roles.map((role) => (
                                <TableRow key={role.id}>
                                    <TableCell className="font-medium">{role.name}</TableCell>
                                    {PERMISSION_MODULES.map(module => (
                                        <TableCell key={module} className="text-center">
                                            <div className="flex justify-center items-center space-x-2">
                                                <span title="Create" className={cn((role.permissions as Permissions)[module.toLowerCase()]?.create ? 'text-green-500' : 'text-muted-foreground/30')}>C</span>
                                                <span title="Read" className={cn((role.permissions as Permissions)[module.toLowerCase()]?.read ? 'text-green-500' : 'text-muted-foreground/30')}>R</span>
                                                <span title="Update" className={cn((role.permissions as Permissions)[module.toLowerCase()]?.update ? 'text-green-500' : 'text-muted-foreground/30')}>U</span>
                                                <span title="Delete" className={cn((role.permissions as Permissions)[module.toLowerCase()]?.delete ? 'text-green-500' : 'text-muted-foreground/30')}>D</span>
                                            </div>
                                        </TableCell>
                                    ))}
                                    <TableCell className="text-right">
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <Button variant="ghost" className="h-8 w-8 p-0">
                                                    <span className="sr-only">Open menu</span>
                                                    <MoreHorizontal className="h-4 w-4" />
                                                </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="end">
                                                <DropdownMenuLabel>Actions</DropdownMenuLabel>
                                                <DropdownMenuItem onClick={() => handleOpenDialog(role)}>Edit</DropdownMenuItem>
                                                <DropdownMenuItem className="text-red-600" onClick={() => setDeletingRoleId(role.id)}>Delete</DropdownMenuItem>
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
            <AddRoleDialog
                isOpen={isDialogOpen}
                onClose={handleCloseDialog}
                onSave={handleSaveRole}
                role={editingRole}
                primaryColor={themeColor}
            />
            <AlertDialog open={!!deletingRoleId} onOpenChange={(isOpen) => !isOpen && setDeletingRoleId(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Are you sure you want to delete this role?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This action cannot be undone. This will permanently delete the role and may affect users assigned to it.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDeleteRole} style={{ backgroundColor: themeColor }} className="text-white">Delete</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
}

export default function AccessControlPage() {
    return (
        <div className="flex-1 space-y-4 p-8 pt-6">
            <h2 className="text-3xl font-bold tracking-tight">Access Control</h2>
            <Tabs defaultValue="users" className="space-y-4">
                <TabsList>
                        <TabsTrigger value="users">Users</TabsTrigger>
                        <TabsTrigger value="roles">Roles</TabsTrigger>
                        <TabsTrigger value="districts">Districts</TabsTrigger>
                    </TabsList>
                <TabsContent value="users">
                    <UsersTab />
                </TabsContent>
                <TabsContent value="roles">
                    <RolesTab />
                </TabsContent>
                    <TabsContent value="districts">
                        <DistrictsTab />
                    </TabsContent>
            </Tabs>
        </div>
    );
}
