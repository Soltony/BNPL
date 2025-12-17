
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import * as signalR from '@microsoft/signalr';

export function useSignalR(hubUrl: string) {
    const [connection, setConnection] = useState<signalR.HubConnection | null>(null);
    const connectionRef = useRef<signalR.HubConnection | null>(null);

    useEffect(() => {
        if (!hubUrl) {
            setConnection(null);
            connectionRef.current = null;
            return;
        }

        const conn = new signalR.HubConnectionBuilder()
            .withUrl(hubUrl)
            .withAutomaticReconnect()
            .build();

        connectionRef.current = conn;
        setConnection(conn);

        return () => {
            conn.stop().catch(() => undefined);
            if (connectionRef.current === conn) {
                connectionRef.current = null;
            }
        };
    }, [hubUrl]);

    const startConnection = useCallback(async () => {
        const conn = connectionRef.current;
        if (!conn) return;
        if (conn.state !== signalR.HubConnectionState.Disconnected) return;
        await conn.start();
    }, []);

    const stopConnection = useCallback(async () => {
        const conn = connectionRef.current;
        if (!conn) return;
        if (conn.state === signalR.HubConnectionState.Disconnected) return;
        await conn.stop();
    }, []);

    return { connection, startConnection, stopConnection };
}
