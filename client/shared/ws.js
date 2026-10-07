// Parameterized WebSocket wrapper with auto-reconnect, exponential backoff,
// client-side ping keepalive, and a cold-start notification hook.
export function connectWS(url, { onOpen, onClose, onRetry, onColdStart, onMessage, onBadFrame }) {
  let ws = null;
  let reconnectDelay = 1000;
  let coldStartTimer = null;
  let pingInterval = null;
  let permanent = false;
  let retryTimer = null;

  // Every handler is bound to the socket it belongs to and checks it is still
  // the CURRENT one before touching shared state.
  //
  // Without that check a superseded socket can speak for the live connection.
  // The close event for socket A is not guaranteed to arrive before socket B
  // opens — a laptop waking from sleep, or a network flap, routinely delivers it
  // late — and A's onclose would then set the status to offline, schedule a
  // cold-start notice, and dial a THIRD socket, all while B was up and happily
  // carrying traffic. That is how the "connecting to the world" overlay ended up
  // stuck open on a perfectly good connection: nothing that arrived afterwards
  // was a fresh `onopen`, so nothing ever took it back down.
  function connect() {
    const sock = new WebSocket(url);
    ws = sock;

    sock.onopen = () => {
      // Superseded while dialling (retryNow, or a close that raced us). Drop it
      // rather than let two live sockets fight over the session.
      if (sock !== ws) { try { sock.close(); } catch { /* already gone */ } return; }
      reconnectDelay = 1000;
      if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
      if (coldStartTimer) { clearTimeout(coldStartTimer); coldStartTimer = null; }
      if (pingInterval) clearInterval(pingInterval);
      pingInterval = setInterval(() => {
        if (sock.readyState === WebSocket.OPEN) sock.send('{"type":"ping"}');
      }, 10000);
      // Say the cold start is OVER, explicitly. Relying on the consumer to infer
      // it from onOpen is what made a single missed open permanent.
      onColdStart?.(false);
      onOpen?.();
    };

    sock.onclose = (ev) => {
      if (permanent) return;
      if (sock !== ws) return;   // a stale socket's death says nothing about the live one
      if (pingInterval) { clearInterval(pingInterval); pingInterval = null; }
      // 4001 is the server closing a kicked session itself (closeAfterKick in
      // server/index.js). Redialling would log the kicked session straight back in.
      if (ev?.code === 4001) { permanent = true; onClose?.(); return; }
      coldStartTimer = setTimeout(() => {
        coldStartTimer = null;
        // Last check before crying wolf: the socket may have come up during the
        // wait, in which case there is no cold start to report.
        if (ws?.readyState === WebSocket.OPEN) return;
        onColdStart?.(true);
      }, 5000);
      reconnectDelay = Math.min(reconnectDelay * 1.5, 15000);
      onClose?.();
      onRetry?.();
      // ±25% jitter, so after a server restart every client doesn't redial on
      // the same beat.
      retryTimer = setTimeout(connect, reconnectDelay * (0.75 + Math.random() * 0.5));
    };

    sock.onmessage = (e) => {
      if (sock !== ws) return;
      // A frame that won't parse, or a handler that throws, must not break the stream.
      // It used to vanish here; onBadFrame lets the caller put it in a bug report.
      try { onMessage?.(JSON.parse(e.data)); } catch (err) { try { onBadFrame?.(err); } catch { /* reporting must not throw */ } }
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
    // Shut down for good. `permanent` alone stops the RECONNECT, but the ping
    // interval and any armed timers keep running against a socket nobody is
    // listening to — a leak that outlives the connection it belonged to.
    close: () => {
      permanent = true;
      if (pingInterval) { clearInterval(pingInterval); pingInterval = null; }
      if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
      if (coldStartTimer) { clearTimeout(coldStartTimer); coldStartTimer = null; }
      ws?.close();
    },
  };
}
