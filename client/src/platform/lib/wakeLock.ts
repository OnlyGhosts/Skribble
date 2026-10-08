/**
 * Keeps the screen awake while the player is in a room. A phone that locks mid-game drops its
 * socket and misses its turn; the Screen Wake Lock API stops the lock from kicking in. The OS
 * releases the lock whenever the page is hidden, so it is requested again when the page is
 * visible, and a request refused before any user gesture (some browsers insist on one) is
 * retried on the next tap or key. Everything is feature-detected and nothing here ever throws.
 */

/** The slice of WakeLockSentinel this module uses (the DOM type is only in newer lib files). */
export interface WakeLockSentinelLike {
  released: boolean;
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void): void;
}

export interface WakeLockEnv {
  navigator: { wakeLock?: { request(type: 'screen'): Promise<WakeLockSentinelLike> } };
  document: {
    visibilityState: string;
    addEventListener(type: string, listener: () => void, options?: AddEventListenerOptions): void;
    removeEventListener(type: string, listener: () => void): void;
  };
}

const GESTURE_EVENTS = ['pointerdown', 'keydown'] as const;

export class WakeLockKeeper {
  private wanted = false;
  private sentinel: WakeLockSentinelLike | null = null;
  private requesting = false;
  private listening = false;
  private gestureArmed = false;

  constructor(private readonly env: WakeLockEnv) {}

  get supported(): boolean {
    return typeof this.env.navigator.wakeLock?.request === 'function';
  }

  /** True while a lock is held (for tests and diagnostics). */
  get active(): boolean {
    return this.sentinel !== null && !this.sentinel.released;
  }

  /** Asks for the lock and keeps asking after it is lost until `release()`. Idempotent. */
  hold(): void {
    if (!this.supported) return;
    this.wanted = true;
    if (!this.listening) {
      this.listening = true;
      this.env.document.addEventListener('visibilitychange', this.onVisibility);
    }
    void this.request();
  }

  /** Lets the screen lock again. Idempotent. */
  release(): void {
    this.wanted = false;
    if (this.listening) {
      this.listening = false;
      this.env.document.removeEventListener('visibilitychange', this.onVisibility);
    }
    this.disarmGesture();
    const sentinel = this.sentinel;
    this.sentinel = null;
    if (sentinel && !sentinel.released) sentinel.release().catch(() => undefined);
  }

  private async request(): Promise<void> {
    if (!this.wanted || this.requesting || this.active || this.env.document.visibilityState !== 'visible') return;
    const wakeLock = this.env.navigator.wakeLock;
    if (!wakeLock) return;
    this.requesting = true;
    try {
      const sentinel = await wakeLock.request('screen');
      if (!this.wanted) {
        sentinel.release().catch(() => undefined);
        return;
      }
      this.sentinel = sentinel;
      this.disarmGesture();
      sentinel.addEventListener('release', () => {
        if (this.sentinel === sentinel) this.sentinel = null;
        // The OS took it back (page hidden, low battery): ask again once the page is visible.
        if (this.wanted && this.env.document.visibilityState === 'visible') void this.request();
      });
    } catch {
      // Refused (no user activation yet, battery saver, permissions policy): try again on a gesture.
      this.armGesture();
    } finally {
      this.requesting = false;
    }
  }

  private readonly onVisibility = (): void => {
    if (this.env.document.visibilityState === 'visible') void this.request();
  };

  private readonly onGesture = (): void => {
    this.disarmGesture();
    void this.request();
  };

  private armGesture(): void {
    if (this.gestureArmed || !this.wanted) return;
    this.gestureArmed = true;
    for (const type of GESTURE_EVENTS) this.env.document.addEventListener(type, this.onGesture, { passive: true });
  }

  private disarmGesture(): void {
    if (!this.gestureArmed) return;
    this.gestureArmed = false;
    for (const type of GESTURE_EVENTS) this.env.document.removeEventListener(type, this.onGesture);
  }
}

function browserEnv(): WakeLockEnv {
  // The unit tests run without a DOM; the keeper then simply reports "unsupported".
  if (typeof navigator === 'undefined' || typeof document === 'undefined') return { navigator: {}, document: { visibilityState: 'hidden', addEventListener: () => undefined, removeEventListener: () => undefined } };
  return { navigator: navigator as WakeLockEnv['navigator'], document };
}

/** The page's one keeper; `App` holds it while the player is in a room. */
export const wakeLock = new WakeLockKeeper(browserEnv());
