/**
 * Event bus — fire-and-forget pub/sub (ADR-0002).
 * Distinct from fireHook (request/response). Events are past-tense notifications;
 * return values are ignored, subscriber errors are isolated.
 */

// eventName -> [handler, ...]
const subscribers = new Map();

export function on(eventName, handler) {
  if (!subscribers.has(eventName)) subscribers.set(eventName, []);
  subscribers.get(eventName).push(handler);
}

export function emit(eventName, payload) {
  const handlers = subscribers.get(eventName);
  if (!handlers?.length) return;
  for (const handler of handlers) {
    try {
      const result = handler(payload);
      // Swallow promise rejections — subscriber errors must not break the emitter
      if (result && typeof result.catch === 'function') result.catch(e => {
        console.error(`[events] subscriber error on "${eventName}": ${e.message}`);
      });
    } catch (e) {
      console.error(`[events] subscriber error on "${eventName}": ${e.message}`);
    }
  }
}

export function off(eventName, handler) {
  const handlers = subscribers.get(eventName);
  if (!handlers) return;
  const idx = handlers.indexOf(handler);
  if (idx !== -1) handlers.splice(idx, 1);
}
