const QUEUE_KEY = "ordengo_offline_queue_v1";
const ORDER_ID_MAP_KEY = "ordengo_offline_order_ids_v1";

const readQueue = () => {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]"); } catch { return []; }
};

const writeQueue = (queue) => localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));

export function queueOfflineOperation(type, payload) {
  const operation = { id: `offline-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, type, payload, createdAt: new Date().toISOString() };
  writeQueue([...readQueue(), operation]);
  return operation;
}

export function offlineQueueSize() { return readQueue().length; }

export function updateQueuedOrder(localId, patch) {
  const queue = readQueue();
  const index = queue.findIndex((operation) => operation.type === "order:create" && operation.payload?._localId === localId);
  if (index < 0) return false;
  queue[index] = { ...queue[index], payload: { ...queue[index].payload, ...patch } };
  writeQueue(queue);
  return true;
}

export function rememberSyncedOrderId(localId, serverId) {
  if (!localId || !serverId) return;
  let current = {}; try { current = JSON.parse(localStorage.getItem(ORDER_ID_MAP_KEY) || "{}"); } catch {}
  localStorage.setItem(ORDER_ID_MAP_KEY, JSON.stringify({ ...current, [localId]: serverId }));
}

export function resolveSyncedOrderId(localId, consume = false) {
  let current = {}; try { current = JSON.parse(localStorage.getItem(ORDER_ID_MAP_KEY) || "{}"); } catch { return ""; }
  const serverId = current[localId] || "";
  if (serverId && consume) { delete current[localId]; localStorage.setItem(ORDER_ID_MAP_KEY, JSON.stringify(current)); }
  return serverId;
}

export async function flushOfflineQueue(handler) {
  const pending = readQueue();
  if (!pending.length) return { sent: 0, remaining: 0 };
  const remaining = [];
  let sent = 0;
  for (const operation of pending) {
    try { await handler(operation); sent += 1; }
    catch { remaining.push(operation); }
  }
  writeQueue(remaining);
  return { sent, remaining: remaining.length };
}

export function saveOrderDraft(userId, draft) {
  try { localStorage.setItem(`ordengo_order_draft_${userId}`, JSON.stringify({ ...draft, savedAt: new Date().toISOString() })); } catch {}
}

export function loadOrderDraft(userId) {
  try { return JSON.parse(localStorage.getItem(`ordengo_order_draft_${userId}`) || "null"); } catch { return null; }
}

export function clearOrderDraft(userId) { localStorage.removeItem(`ordengo_order_draft_${userId}`); }
