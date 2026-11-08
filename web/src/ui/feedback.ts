// Small physical feedback for taps that change something. Android vibrates; iOS
// browsers ignore it. Skipped when the person asks for reduced motion.
export function haptic(pattern: number | number[] = 10) {
  try {
    if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return
    navigator.vibrate?.(pattern)
  } catch { /* unsupported */ }
}
