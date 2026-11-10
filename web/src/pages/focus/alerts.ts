// End-of-session signals and the per-habit target length, kept on this device
// (the timer itself lives on the server, so a target only shapes the countdown).

const KEY = (id: number) => `pd:focus-target:${id}`

export type Target = { minutes: number; rolled: boolean }

export function loadTarget(id: number): Target | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY(id)) ?? 'null') as Target | null
    return v && v.minutes > 0 ? v : null
  } catch { return null }
}
export function saveTarget(id: number, t: Target | null) {
  try { if (t) localStorage.setItem(KEY(id), JSON.stringify(t)); else localStorage.removeItem(KEY(id)) } catch { /* private mode */ }
}

/** A short rising chime (three soft notes). Silent if audio isn't allowed yet. */
export function chime() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    ;[523.25, 659.25, 783.99].forEach((freq, i) => {
      const osc = ctx.createOscillator(), gain = ctx.createGain()
      const t = ctx.currentTime + i * 0.18
      osc.type = 'sine'; osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, t)
      gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.6)
      osc.connect(gain).connect(ctx.destination)
      osc.start(t); osc.stop(t + 0.65)
    })
    setTimeout(() => void ctx.close(), 1500)
  } catch { /* no audio */ }
}

/** Vibrate (Android) and, if the page is hidden and notifications are allowed, notify. */
export function sessionDone(name: string, minutes: number) {
  try { navigator.vibrate?.([200, 100, 200, 100, 400]) } catch { /* unsupported */ }
  if (document.visibilityState === 'visible' || !('Notification' in window) || Notification.permission !== 'granted') return
  void navigator.serviceWorker?.ready.then(reg => reg.showNotification(`${name}: ${minutes} min done`, {
    body: 'Stop and log it, or keep going.', tag: 'focus-session', icon: '/icon-192.png',
  })).catch(() => { /* no worker */ })
}
