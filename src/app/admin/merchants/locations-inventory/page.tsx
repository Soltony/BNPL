'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRequirePermission } from '@/hooks/use-require-permission';
import { useAuth } from '@/hooks/use-auth';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Loader2, PlusCircle } from 'lucide-react';

type StockLocation = {
	id: string;
	name: string;
	address?: string | null;
	isActive: boolean;
	contactInfo?: string | null;
};

function StatusBadge({ status }: { status: string }) {
	const variant = status === 'ACTIVE' ? 'secondary' : 'destructive';
	return <Badge variant={variant}>{status}</Badge>;
}

export default function MerchantsLocationsInventoryPage() {
	useRequirePermission('merchants');
	const { currentUser } = useAuth();
	const { toast } = useToast();

	const [loading, setLoading] = useState(true);
	const [locations, setLocations] = useState<StockLocation[]>([]);

	const [locationDialogOpen, setLocationDialogOpen] = useState(false);
	const [editingLocation, setEditingLocation] = useState<StockLocation | null>(null);
	const [locationName, setLocationName] = useState('');
	const [locationAddress, setLocationAddress] = useState('');
	const [locationIsActive, setLocationIsActive] = useState<'true' | 'false'>('true');
	const [locationContactInfo, setLocationContactInfo] = useState('');

	const themeColor = useMemo(() => {
		return currentUser?.role === 'Super Admin' ? 'hsl(var(--primary))' : 'hsl(var(--primary))';
	}, [currentUser]);

	const load = async () => {
		try {
			setLoading(true);
			const locRes = await fetch('/api/admin/stock-locations');
			if (!locRes.ok) throw new Error('Failed to load stock locations');
			setLocations(await locRes.json());
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

	const openAddLocation = () => {
		setEditingLocation(null);
		setLocationName('');
		setLocationAddress('');
		setLocationIsActive('true');
		setLocationContactInfo('');
		setLocationDialogOpen(true);
	};

	const openEditLocation = (loc: StockLocation) => {
		setEditingLocation(loc);
		setLocationName(loc.name);
		setLocationAddress(loc.address || '');
		setLocationIsActive(loc.isActive ? 'true' : 'false');
		setLocationContactInfo(loc.contactInfo || '');
		setLocationDialogOpen(true);
	};

	const saveLocation = async () => {
		try {
			const method = editingLocation ? 'PUT' : 'POST';
			const payload: any = {
				name: locationName,
				address: locationAddress.trim() ? locationAddress.trim() : null,
				isActive: locationIsActive === 'true',
				contactInfo: locationContactInfo.trim() ? locationContactInfo.trim() : null,
			};
			if (editingLocation) payload.id = editingLocation.id;

			const res = await fetch('/api/admin/stock-locations', {
				method,
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload),
			});
			const data = await res.json().catch(() => null);
			if (!res.ok) throw new Error(data?.error || 'Failed to save location');
			toast({ title: 'Saved', description: 'Stock location saved.' });
			setLocationDialogOpen(false);
			await load();
		} catch (err: any) {
			toast({ title: 'Error', description: err?.message || 'Failed to save', variant: 'destructive' });
		}
	};

	const deleteLocation = async (id: string) => {
		try {
			const res = await fetch(`/api/admin/stock-locations?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
			const data = await res.json().catch(() => null);
			if (!res.ok) throw new Error(data?.error || 'Failed to delete location');
			toast({ title: 'Deleted', description: 'Stock location deleted.' });
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
					<CardTitle>Locations</CardTitle>
					<CardDescription>Manage stock locations used when assigning item quantities.</CardDescription>
				</CardHeader>
				<CardContent>
					<div className="flex justify-end mb-4">
						<Button onClick={openAddLocation} style={{ backgroundColor: themeColor }} className="text-white">
							<PlusCircle className="mr-2 h-4 w-4" /> Add Location
						</Button>
					</div>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Name</TableHead>
								<TableHead>Address</TableHead>
								<TableHead>Status</TableHead>
								<TableHead>Contact</TableHead>
								<TableHead className="w-[220px]">Actions</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{locations.map((loc) => (
								<TableRow key={loc.id}>
									<TableCell className="font-medium">{loc.name}</TableCell>
									<TableCell>{loc.address || '-'}</TableCell>
									<TableCell><StatusBadge status={loc.isActive ? 'ACTIVE' : 'INACTIVE'} /></TableCell>
									<TableCell>{loc.contactInfo || '-'}</TableCell>
									<TableCell className="flex gap-2">
										<Button variant="outline" onClick={() => openEditLocation(loc)}>Edit</Button>
										<Button variant="destructive" onClick={() => deleteLocation(loc.id)}>Delete</Button>
									</TableCell>
								</TableRow>
							))}
							{locations.length === 0 ? (
								<TableRow>
									<TableCell colSpan={5} className="text-center text-muted-foreground">No locations yet.</TableCell>
								</TableRow>
							) : null}
						</TableBody>
					</Table>
				</CardContent>
			</Card>

			<Dialog open={locationDialogOpen} onOpenChange={setLocationDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{editingLocation ? 'Edit Location' : 'Add Location'}</DialogTitle>
						<DialogDescription>Physical or virtual stock locations.</DialogDescription>
					</DialogHeader>
					<div className="space-y-4">
						<div className="space-y-2">
							<div className="text-sm font-medium">Name</div>
							<Input value={locationName} onChange={(e) => setLocationName(e.target.value)} />
						</div>
						<div className="space-y-2">
							<div className="text-sm font-medium">Address</div>
							<Input value={locationAddress} onChange={(e) => setLocationAddress(e.target.value)} />
						</div>
						<div className="space-y-2">
							<div className="text-sm font-medium">Status</div>
							<Select value={locationIsActive} onValueChange={(v) => setLocationIsActive(v as any)}>
								<SelectTrigger>
									<SelectValue placeholder="Select status" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="true">ACTIVE</SelectItem>
									<SelectItem value="false">INACTIVE</SelectItem>
								</SelectContent>
							</Select>
						</div>
						<div className="space-y-2">
							<div className="text-sm font-medium">Contact Info</div>
							<Input value={locationContactInfo} onChange={(e) => setLocationContactInfo(e.target.value)} />
						</div>
					</div>
					<DialogFooter>
						<Button variant="outline" onClick={() => setLocationDialogOpen(false)}>Cancel</Button>
						<Button onClick={saveLocation} style={{ backgroundColor: themeColor }} className="text-white" disabled={!locationName.trim()}>
							Save
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

		</div>
	);
}
