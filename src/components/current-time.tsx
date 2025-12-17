"use client";

import { useState, useEffect } from 'react';

export function CurrentTime() {
  const [time, setTime] = useState<string | null>(null);

  useEffect(() => {
    setTime(new Date().toLocaleTimeString());
    const timerId = setInterval(() => {
      setTime(new Date().toLocaleTimeString());
    }, 1000);
    return () => clearInterval(timerId);
  }, []);

  return (
    <p className="mt-4 text-2xl text-muted-foreground tabular-nums">
      {time ?? 'Loading time...'}
    </p>
  );
}
