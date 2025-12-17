
'use client';

import { useState, useEffect, useRef } from 'react';
export const useSignalR = (hubUrl: string) => {
    const [connection, setConnection] = useState<signalR.HubConnection | null>(null);
    const connectionRef = useRef(connection);
    connectionRef.current = connection;

    useEffect(() => {
    return { connection, startConnection, stopConnection };
};
// SignalR hook removed
