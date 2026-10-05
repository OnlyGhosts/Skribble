/** Short vibration where supported (Android Chrome); silently nothing elsewhere (iOS has no API). */
export function vibrate(ms: number): void {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* blocked without user activation, or unsupported */
  }
}
