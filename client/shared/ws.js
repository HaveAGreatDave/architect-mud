// Parameterized WebSocket wrapper with auto-reconnect, exponential backoff,
// client-side ping keepalive, and a cold-start notification hook.
export function connectWS(url, { onOpen, onClose, onRetry, onColdStart, onMessage }) {
  let ws = null;
  let reconnectDelay = 1000;
  let coldStartTimer = null;
  let pingInterval = null;
  let permanent = false;
  let retryTimer = null;

  function connect() {
    ws = new WebSocket(url);

    ws.onopen = () => {
      reconnectDelay = 1000;
      if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
      if (coldStartTimer) { clearTimeout(coldStartTimer); coldStartTimer = null; }
      if (pingInterval) clearInterval(pingInterval);
      pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send('{"type":"ping"}');
      }, 10000);
      onOpen?.();
    };

    ws.onclose = () => {
      if (permanent) return;
      coldStartTimer = setTimeout(() => { coldStartTimer = null; onColdStart?.(true); }, 5000);
      reconnectDelay = Math.min(reconnectDelay * 1.5, 15000);
      onClose?.();
      onRetry?.();
      retryTimer = setTimeout(connect, reconnectDelay);
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
    // Skip the remaining backoff and dial immediately — what the overlay's
    // Reconnect button does. A no-op while a socket is already up or dialling,
    // so an impatient click can never open a second one.
    retryNow: () => {
      if (permanent) return false;
      if (ws?.readyState === WebSocket.OPEN || ws?.readyState === WebSocket.CONNECTING) return false;
      if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
      reconnectDelay = 1000;
      connect();
      return true;
    },
    close: () => { permanent = true; ws?.close(); },
  };
}
