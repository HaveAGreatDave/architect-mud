// Parameterized WebSocket wrapper with auto-reconnect, exponential backoff,
// client-side ping keepalive, and a cold-start notification hook.
export function connectWS(url, { onOpen, onClose, onColdStart, onMessage }) {
  let ws = null;
  let reconnectDelay = 1000;
  let coldStartTimer = null;
  let pingInterval = null;

  function connect() {
    ws = new WebSocket(url);

    ws.onopen = () => {
      reconnectDelay = 1000;
      if (coldStartTimer) { clearTimeout(coldStartTimer); coldStartTimer = null; }
      if (pingInterval) clearInterval(pingInterval);
      pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send('{"type":"ping"}');
      }, 10000);
      onOpen?.();
    };

    ws.onclose = () => {
      coldStartTimer = setTimeout(() => { coldStartTimer = null; onColdStart?.(true); }, 5000);
      reconnectDelay = Math.min(reconnectDelay * 1.5, 15000);
      setTimeout(connect, reconnectDelay);
      onClose?.();
    };

    ws.onmessage = (e) => {
      try { onMessage?.(JSON.parse(e.data)); } catch {}
    };
  }

  connect();

  return {
    send: (obj) => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj)); },
    isOpen: () => ws?.readyState === WebSocket.OPEN,
    isConnecting: () => ws?.readyState === WebSocket.CONNECTING,
    close: () => ws?.close(),
  };
}
