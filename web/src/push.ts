// Web Push for habit reminders: ask permission, subscribe this device, and keep
// the server's copy (and this device's time zone) fresh.
import { get, send } from './api'

export type PushState = 'unsupported' | 'needs-install' | 'denied' | 'off' | 'on'

const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true

export async function pushState(): Promise<PushState> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window))
    return isIos() && !isStandalone() ? 'needs-install' : 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  return sub && Notification.permission === 'granted' ? 'on' : 'off'
}

function keyBytes(base64url: string): Uint8Array {
  const b64 = base64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(base64url.length / 4) * 4, '=')
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0))
}

async function save(sub: PushSubscription) {
  const json = sub.toJSON()
  await send('POST', '/api/push/subscribe', { endpoint: json.endpoint, keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth } })
}

/** Ask for permission (must follow a tap) and subscribe this device. Throws with a readable reason. */
export async function enablePush(): Promise<void> {
  const state = await pushState()
  if (state === 'needs-install') throw new Error('On iPhone, add the dashboard to your Home Screen first (Share → Add to Home Screen), then turn reminders on from there.')
  if (state === 'unsupported') throw new Error("This browser can't receive notifications.")
  if (state === 'denied') throw new Error('Notifications are blocked for this site. Allow them in your browser or phone settings.')
  if (await Notification.requestPermission() !== 'granted') throw new Error('Notifications were not allowed.')
  const reg = await navigator.serviceWorker.ready
  const { publicKey } = await get<{ publicKey: string }>('/api/push/key')
  let sub = await reg.pushManager.getSubscription()
  // A subscription made with a different server key can't be used; replace it.
  const current = sub?.options.applicationServerKey
  if (sub && current && btoa(String.fromCharCode(...new Uint8Array(current))) !== btoa(String.fromCharCode(...keyBytes(publicKey)))) { await sub.unsubscribe(); sub = null }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) as BufferSource })
  await save(sub)
}

/** On app start: if this device is subscribed, refresh the server's copy and time zone. */
export async function refreshPush(): Promise<void> {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || Notification.permission !== 'granted') return
    const sub = await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription()
    if (sub) await save(sub)
  } catch { /* best effort */ }
}

export const sendTestPush = () => send<{ sent: number }>('POST', '/api/push/test')
