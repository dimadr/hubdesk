import { useEffect, useRef, useCallback } from 'react';

type EventHandler = (data: any) => void;

export function useWebSocket(url: string, onEvent: Record<string, EventHandler>) {
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${location.host}${url}`);
    wsRef.current = ws;
    ws.onmessage = (e) => {
      const { event, data } = JSON.parse(e.data);
      if (onEvent[event]) onEvent[event](data);
    };
    return () => ws.close();
  }, [url]);

  const send = useCallback((event: string, data: any) => {
    wsRef.current?.send(JSON.stringify({ event, data }));
  }, []);

  return { send };
}
