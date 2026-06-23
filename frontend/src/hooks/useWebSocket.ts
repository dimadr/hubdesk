import { useEffect, useRef, useCallback } from 'react';

type EventHandler = (data: any) => void;

export function useWebSocket(url: string, onEvent: Record<string, EventHandler>) {
  const wsRef = useRef<WebSocket | null>(null);
  const onEventRef = useRef(onEvent);

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${location.host}${url}`);
    wsRef.current = ws;
    ws.onmessage = (e) => {
      try {
        const { event, data } = JSON.parse(e.data);
        onEventRef.current[event]?.(data);
      } catch {
        // Ignore malformed websocket messages.
      }
    };
    return () => {
      wsRef.current = null;
      ws.close();
    };
  }, [url]);

  const send = useCallback((event: string, data: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ event, data }));
    }
  }, []);

  return { send };
}
