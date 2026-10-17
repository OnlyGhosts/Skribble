/**
 * The checkpoint format: a room sealed so that only this server (holding the key) can read it or
 * vouch for it, and no phone can alter it.
 *
 *   header = version (1 byte) | issuedAt (uint64 BE, epoch ms) | code length (1 byte) | code (ASCII)
 *   text   = base64url( header | iv (12) | AES-256-GCM(deflateRaw(JSON)) | tag (16) )
 *
 * The whole header is the additional authenticated data, so the version, the room code and the
 * time it was issued cannot be changed without the tag failing.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { CHECKPOINT_MAX_AGE_MS, CHECKPOINT_MAX_CHARS } from '../../../shared/platform/constants.js';

export const CHECKPOINT_VERSION = 1;
export const CHECKPOINT_KEY_BYTES = 32;
/** The most a checkpoint may inflate to: a 50-seat room is a small fraction of it. */
export const CHECKPOINT_MAX_INFLATED_BYTES = 1024 * 1024;
/** A checkpoint dated further ahead than this was not issued by a sane clock. */
export const CHECKPOINT_MAX_FUTURE_MS = 60_000;

const IV_BYTES = 12;
const TAG_BYTES = 16;
const FIXED_HEADER_BYTES = 1 + 8 + 1;
const MAX_CODE_BYTES = 16;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

export type OpenFailure = 'tooLarge' | 'malformed' | 'version' | 'code' | 'expired' | 'future' | 'auth' | 'inflate' | 'json';

export type Opened = { ok: true; issuedAt: number; value: unknown } | { ok: false; reason: OpenFailure };

function header(version: number, issuedAt: number, code: string): Buffer {
  const codeBytes = Buffer.from(code, 'ascii');
  if (codeBytes.length === 0 || codeBytes.length > MAX_CODE_BYTES) throw new Error('checkpoint: bad room code');
  const out = Buffer.alloc(FIXED_HEADER_BYTES + codeBytes.length);
  out.writeUInt8(version, 0);
  out.writeBigUInt64BE(BigInt(issuedAt), 1);
  out.writeUInt8(codeBytes.length, 9);
  codeBytes.copy(out, FIXED_HEADER_BYTES);
  return out;
}

/** Seals `value` (any JSON-safe value) for room `code` as issued at `issuedAt`. */
export function sealCheckpoint(key: Buffer, code: string, issuedAt: number, value: unknown): string {
  const head = header(CHECKPOINT_VERSION, issuedAt, code);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(head);
  const body = Buffer.concat([cipher.update(deflateRawSync(Buffer.from(JSON.stringify(value), 'utf8'))), cipher.final()]);
  return Buffer.concat([head, iv, body, cipher.getAuthTag()]).toString('base64url');
}

export interface OpenOptions {
  /** The room code the phone is rejoining: a checkpoint for any other room is refused. */
  code: string;
  now: number;
}

/**
 * Opens a checkpoint a phone sent back. Everything cheap is checked before any crypto, and the
 * size before any decoding; the inflated size is capped as well.
 */
export function openCheckpoint(key: Buffer, text: string, { code, now }: OpenOptions): Opened {
  if (text.length > CHECKPOINT_MAX_CHARS) return { ok: false, reason: 'tooLarge' };
  if (!BASE64URL.test(text)) return { ok: false, reason: 'malformed' };
  const raw = Buffer.from(text, 'base64url');
  if (raw.length < FIXED_HEADER_BYTES + IV_BYTES + TAG_BYTES) return { ok: false, reason: 'malformed' };
  if (raw.readUInt8(0) !== CHECKPOINT_VERSION) return { ok: false, reason: 'version' };
  const codeLength = raw.readUInt8(9);
  const headerEnd = FIXED_HEADER_BYTES + codeLength;
  if (codeLength === 0 || raw.length < headerEnd + IV_BYTES + TAG_BYTES) return { ok: false, reason: 'malformed' };
  if (raw.subarray(FIXED_HEADER_BYTES, headerEnd).toString('ascii') !== code) return { ok: false, reason: 'code' };
  const issuedAt = Number(raw.readBigUInt64BE(1));
  if (now - issuedAt > CHECKPOINT_MAX_AGE_MS) return { ok: false, reason: 'expired' };
  if (issuedAt - now > CHECKPOINT_MAX_FUTURE_MS) return { ok: false, reason: 'future' };

  let deflated: Buffer;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(headerEnd, headerEnd + IV_BYTES));
    decipher.setAAD(raw.subarray(0, headerEnd));
    decipher.setAuthTag(raw.subarray(raw.length - TAG_BYTES));
    deflated = Buffer.concat([decipher.update(raw.subarray(headerEnd + IV_BYTES, raw.length - TAG_BYTES)), decipher.final()]);
  } catch {
    return { ok: false, reason: 'auth' };
  }
  let json: Buffer;
  try {
    json = inflateRawSync(deflated, { maxOutputLength: CHECKPOINT_MAX_INFLATED_BYTES });
  } catch {
    return { ok: false, reason: 'inflate' };
  }
  try {
    return { ok: true, issuedAt, value: JSON.parse(json.toString('utf8')) as unknown };
  } catch {
    return { ok: false, reason: 'json' };
  }
}
