
'use client';

import React, { useState, useEffect } from 'react';
import { useRequirePermission } from '@/hooks/use-require-permission';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, ChevronLeft, ChevronRight, FileJson } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';

interface AuditLog {
    id: string;
    actorId: string;
    action: string;
    entity: string | null;
    entityId: string | null;
    ipAddress: string | null;
    createdAt: string;
    details: string | null;
}

const ITEMS_PER_PAGE = 20;

export default function AuditLogsPage() {
    useRequirePermission('audit-logs');
    const [logs, setLogs] = useState<AuditLog[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);
    const { toast } = useToast();

    useEffect(() => {
        const fetchLogs = async () => {
            setIsLoading(true);
            try {
                const response = await fetch(`/api/audit-logs?page=${page}&limit=${ITEMS_PER_PAGE}`);
                if (!response.ok) {
                    throw new Error('Failed to fetch audit logs.');
                }
                const data = await response.json();
                setLogs(data.logs);
                setTotalPages(data.totalPages);
            } catch (error: any) {
                toast({
                    title: 'Error',
                    description: error.message,
                    variant: 'destructive',
                });
            } finally {
                setIsLoading(false);
            }
        };

        fetchLogs();
    }, [page, toast]);
    
    const getActionBadgeColor = (action: string): string => {
        if (action.includes('SUCCESS') || action.includes('CREATE')) return 'bg-green-600';
        if (action.includes('FAILURE') || action.includes('DELETE')) return 'bg-red-600';
        if (action.includes('UPDATE')) return 'bg-blue-600';
        if (action.includes('LOGIN')) return 'bg-yellow-500 text-black';
        return 'bg-gray-500';
    };


    return (
        <>
            <div className="flex-1 space-y-4 p-8 pt-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h2 className="text-3xl font-bold tracking-tight">Audit Logs</h2>
                        <p className="text-muted-foreground">
                            A chronological record of system activities.
                        </p>
                    </div>
                </div>
                <Card>
                    <CardHeader>
                        <CardTitle>Activity History</CardTitle>
                        <CardDescription>
                            This log contains all significant actions performed by users and the system.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Actor</TableHead>
                                    <TableHead>Action</TableHead>
                                    <TableHead>Entity</TableHead>
                                    <TableHead>Date</TableHead>
                                    <TableHead>IP Address</TableHead>
                                    <TableHead>Details</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {isLoading ? (
                                    <TableRow>
                                        <TableCell colSpan={6} className="h-24 text-center">
                                            <Loader2 className="h-6 w-6 animate-spin mx-auto"/>
                                        </TableCell>
                                    </TableRow>
                                ) : logs.length > 0 ? (
                                    logs.map((log) => (
                                        <TableRow key={log.id}>
                                            <TableCell className="font-mono text-xs">{log.actorId}</TableCell>
                                            <TableCell>
                                                <Badge
                                                    className="text-white"
                                                    style={{ backgroundColor: getActionBadgeColor(log.action) }}
                                                >
                                                    {log.action}
                                                </Badge>
                                            </TableCell>
                                            <TableCell>
                                                {log.entity && (
                                                    <div className="flex flex-col">
                                                        <span className="font-medium">{log.entity}</span>
                                                        <span className="text-xs text-muted-foreground font-mono">{log.entityId}</span>
                                                    </div>
                                                )}
                                            </TableCell>
                                            <TableCell>{format(new Date(log.createdAt), 'yyyy-MM-dd HH:mm:ss')}</TableCell>
                                            <TableCell className="font-mono">{log.ipAddress || 'N/A'}</TableCell>
                                            <TableCell>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() => setSelectedLog(log)}
                                                    disabled={!log.details}
                                                    className="h-8 w-8"
                                                >
                                                    <FileJson className="h-4 w-4" />
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    ))
                                ) : (
                                    <TableRow>
                                        <TableCell colSpan={6} className="h-24 text-center">
                                            No audit logs found.
                                        </TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </CardContent>
                    <CardFooter>
                        <div className="flex items-center justify-end w-full space-x-2">
                             <span className="text-sm text-muted-foreground">
                                Page {page} of {totalPages}
                            </span>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setPage(p => Math.max(1, p - 1))}
                                disabled={page === 1}
                            >
                                <ChevronLeft className="h-4 w-4" />
                                Previous
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                                disabled={page === totalPages}
                            >
                                Next
                                <ChevronRight className="h-4 w-4" />
                            </Button>
                        </div>
                    </CardFooter>
                </Card>
            </div>
            <Dialog open={!!selectedLog} onOpenChange={() => setSelectedLog(null)}>
                <DialogContent className="max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>Log Details</DialogTitle>
                        <DialogDescription>
                            Raw JSON details for log entry #{selectedLog?.id}.
                        </DialogDescription>
                    </DialogHeader>
                    <pre className="mt-2 w-full overflow-auto rounded-md bg-muted p-4 text-sm">
                        <code>
                            {selectedLog?.details ? JSON.stringify(JSON.parse(selectedLog.details), null, 2) : '{}'}
                        </code>
                    </pre>
                </DialogContent>
            </Dialog>
        </>
    );
}
