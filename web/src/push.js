import { api } from "./api";

// Suscripción a notificaciones push. Todo el trabajo sucio de la Web Push API vive acá para que la
// interfaz sólo tenga que llamar a enablePush() / disablePush() y leer pushState().
//
// Requisitos que no dependen de nosotros:
//  · Contexto seguro (HTTPS). En localhost el navegador lo da por bueno.
//  · Service worker registrado — ya lo está para el modo sin conexión.
//  · En iPhone, además, la aplicación tiene que estar agregada a la pantalla de inicio. Safari en
//    una pestaña común no entrega ninguna push, y no hay forma de sortearlo ni de avisar desde el
//    servidor: por eso pushState() lo detecta y lo informa, en lugar de fallar sin explicación.

// La clave VAPID viaja en base64url y la API la exige como bytes.
function urlBase64ToUint8Array(base64) {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  return Uint8Array.from([...raw].map((char) => char.charCodeAt(0)));
}

const isStandalone = () =>
  window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true;

const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);

export function pushSupport() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    // iOS viejo cae acá: la API no existe hasta iOS 16.4.
    return { supported: false, reason: isIos() ? "Actualizá iOS a 16.4 o superior." : "Este navegador no admite notificaciones." };
  }
  if (isIos() && !isStandalone()) {
    return { supported: false, reason: "En iPhone hay que agregar la aplicación a la pantalla de inicio: tocá Compartir y después «Agregar a inicio»." };
  }
  return { supported: true, reason: "" };
}

export async function pushState() {
  const support = pushSupport();
  if (!support.supported) return { ...support, enabled: false, permission: "unsupported" };
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  return { ...support, enabled: Boolean(subscription), permission: Notification.permission };
}

export async function enablePush() {
  const support = pushSupport();
  if (!support.supported) throw new Error(support.reason);
  const permission = await Notification.requestPermission();
  // "denied" es definitivo desde el código: sólo el usuario puede revertirlo en la configuración
  // del navegador, así que se dice explícitamente en vez de reintentar.
  if (permission !== "granted") {
    throw new Error(permission === "denied"
      ? "Bloqueaste las notificaciones. Habilitalas desde la configuración del navegador para este sitio."
      : "No se concedió el permiso de notificaciones.");
  }
  const { key } = await api.pushKey();
  if (!key) throw new Error("El servidor todavía no tiene configuradas las claves de notificación.");
  const registration = await navigator.serviceWorker.ready;
  // Si ya había una suscripción se reutiliza: volver a suscribir genera un endpoint nuevo y deja el
  // anterior huérfano en la base, recibiendo avisos que ya nadie lee.
  const subscription = await registration.pushManager.getSubscription()
    || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) });
  await api.pushSubscribe(subscription.toJSON());
  return true;
}

export async function disablePush() {
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return false;
  // Primero se avisa al servidor y después se cancela en el navegador: al revés, si la baja local
  // funciona y la petición falla, el servidor sigue enviando a un endpoint muerto para siempre.
  try { await api.pushUnsubscribe(subscription.endpoint); } catch { /* se cancela igual */ }
  await subscription.unsubscribe();
  return true;
}

/* Instalada como aplicación (no en una pestaña del navegador). Es la condición que iOS exige para
   entregar push, y la señal de que la persona ya adoptó la aplicación en su teléfono. */
export const isInstalledApp = () => isStandalone();

/* Suscripción automática, sin preguntar nada. Sólo procede cuando el permiso YA está concedido y
   falta el registro en el servidor: pasa al reinstalar la aplicación, al limpiar los datos del sitio
   o cuando el navegador rota la suscripción por su cuenta. En esos casos el usuario cree que tiene
   los avisos activados —de hecho los autorizó— y no recibiría ninguno.

   No pide permiso por su cuenta a propósito: requestPermission() sin un gesto de la persona lo
   bloquean los navegadores, y en Chrome insistir deja el sitio marcado para no volver a preguntar. */
export async function syncPushIfAllowed() {
  const support = pushSupport();
  if (!support.supported || Notification.permission !== "granted") return false;
  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  if (existing) {
    // Ya suscrito: se reenvía al servidor de todos modos, que es idempotente por endpoint. Cubre el
    // caso de una suscripción viva en el teléfono cuya fila se perdió en la base.
    try { await api.pushSubscribe(existing.toJSON()); } catch { return false; }
    return true;
  }
  try {
    const { key } = await api.pushKey();
    if (!key) return false;
    const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) });
    await api.pushSubscribe(subscription.toJSON());
    return true;
  } catch { return false; }
}
