import { useEffect, useRef, useCallback } from 'react';

type EventHandler = (data: any) => void;

export function useWebSocket(url: string, onEvent: Record<string, EventHandler>) {
  const wsRef = useRef<WebSocket | null>(null);
  const onEventRef = useRef(onEvent);
  const retryRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    const connect = () => {
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${location.host}${url}`);
      wsRef.current = ws;

      ws.onopen = () => {
        retryRef.current = 0;
      };

      ws.onmessage = (e) => {
        try {
          const { event, data } = JSON.parse(e.data);
          onEventRef.current[event]?.(data);
        } catch {
          // Ignore malformed websocket messages.
        }
      };

      ws.onclose = () => {
        wsRef.current = null;
        const delay = Math.min(1000 * 2 ** retryRef.current, 30000);
        retryRef.current++;
        timerRef.current = setTimeout(connect, delay);
      };

      ws.onerror = () => {
        ws.close();
      };
    };

    connect();

    return () => {
      clearTimeout(timerRef.current);
      wsRef.current?.close();
    };
  }, [url]);

  const send = useCallback((event: string, data: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ event, data }));
    }
  }, []);

  return { send };
}
