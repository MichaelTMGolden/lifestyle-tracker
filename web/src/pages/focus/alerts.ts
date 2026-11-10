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

// One audio context for the app. Browsers (iOS Safari above all) only let sound
// start from a tap, so the first tap anywhere unlocks it and the chime, played
// minutes later from a timer, reuses it.
let audio: AudioContext | null = null
function context(): AudioContext | null {
  if (audio) return audio
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    audio = Ctx ? new Ctx() : null
  } catch { audio = null }
  return audio
}
/** Call from a tap: creates or resumes the shared context. */
export function unlockAudio() {
  const ctx = context()
  if (ctx && ctx.state !== 'running') void ctx.resume().catch(() => { /* not allowed yet */ })
}

/** A short rising chime (three soft notes). Silent if sound hasn't been unlocked. */
export function chime() {
  const ctx = context()
  if (!ctx) return
  try {
    if (ctx.state !== 'running') void ctx.resume().catch(() => { /* still locked */ })
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
