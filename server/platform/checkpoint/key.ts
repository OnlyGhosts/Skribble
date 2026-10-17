import { randomBytes } from 'node:crypto';
import { CHECKPOINT_KEY_BYTES } from './seal.js';

export const CHECKPOINT_KEY_ENV = 'ROOM_CHECKPOINT_KEY';

/**
 * The key that seals room checkpoints: ROOM_CHECKPOINT_KEY, 32 random bytes as base64. Without a
 * usable one, production runs without checkpoints (rooms end on a restart, as before) and anywhere
 * else a random key per process is used, so a dev restart does not bring rooms back unless the key
 * is set. The key itself is never logged.
 */
export function checkpointKeyFromEnv(env: NodeJS.ProcessEnv, log: (msg: string) => void): Buffer | null {
  const raw = env[CHECKPOINT_KEY_ENV]?.trim();
  if (raw) {
    const key = Buffer.from(raw, 'base64');
    if (key.length === CHECKPOINT_KEY_BYTES) return key;
    log(`WARNING: ${CHECKPOINT_KEY_ENV} is not ${CHECKPOINT_KEY_BYTES} bytes of base64, so it is ignored.`);
  }
  if (env.NODE_ENV === 'production') {
    log(`WARNING: ${CHECKPOINT_KEY_ENV} is not set: games in progress end when the server restarts.`);
    return null;
  }
  return randomBytes(CHECKPOINT_KEY_BYTES);
}
