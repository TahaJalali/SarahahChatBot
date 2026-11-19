import { CALLBACK_DATA_MAX_BYTES } from './config.js';
import { AES_KEY_HEX, HMAC_KEY_HEX } from './secrets.js';

const VERSION = 1;
const NONCE_BYTES = 12;
const ID_BYTES = 8;
const GCM_TAG_BYTES = 16;
const TOKEN_BYTES = 1 + NONCE_BYTES + ID_BYTES + GCM_TAG_BYTES;
const TOKEN_LENGTH = 50; // base64url encoding of 37 bytes without padding
const LINK_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

let aesKeyPromise;
let hmacKeyPromise;

function hexToBytes(hex, name) {
  if (typeof hex !== 'string' || !/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(`${name} must be exactly 32 random bytes encoded as 64 hex characters`);
  }
  const bytes = new Uint8Array(32);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function aesKey() {
  if (!aesKeyPromise) {
    aesKeyPromise = crypto.subtle.importKey(
      'raw',
      hexToBytes(AES_KEY_HEX, 'AES_KEY_HEX'),
      { name: 'AES-GCM' },
      false,
      ['encrypt', 'decrypt'],
    );
  }
  return aesKeyPromise;
}

function hmacKey() {
  if (!hmacKeyPromise) {
    hmacKeyPromise = crypto.subtle.importKey(
      'raw',
      hexToBytes(HMAC_KEY_HEX, 'HMAC_KEY_HEX'),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
  }
  return hmacKeyPromise;
}

function idToBytes(id) {
  let value;
  try {
    if (typeof id === 'string' && !/^\d+$/.test(id)) throw new Error('bad id');
    value = BigInt(id);
  } catch {
    throw new Error('Invalid Telegram ID');
  }
  if (value < 0n || value > 0xffffffffffffffffn) throw new Error('Invalid Telegram ID');

  const bytes = new Uint8Array(ID_BYTES);
  for (let i = ID_BYTES - 1; i >= 0; i -= 1) {
    bytes[i] = Number(value & 0xffn);
    value >>= 8n;
  }
  return bytes;
}

function bytesToSafeId(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length !== ID_BYTES) {
    throw new Error('Invalid token payload');
  }
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Token ID is out of range');
  return Number(value);
}

function aadBytes(aad) {
  if (aad === 'admin') return new TextEncoder().encode('admin');
  return idToBytes(aad);
}

function toBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(token) {
  if (typeof token !== 'string' || token.length !== TOKEN_LENGTH || !/^[A-Za-z0-9_-]+$/.test(token)) {
    throw new Error('Invalid secure token');
  }
  const padded = token.replace(/-/g, '+').replace(/_/g, '/') + '==';
  let binary;
  try {
    binary = atob(padded);
  } catch {
    throw new Error('Invalid secure token');
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  if (bytes.length !== TOKEN_BYTES) throw new Error('Invalid secure token');
  return bytes;
}

/** Encrypt a Telegram ID for one intended button recipient (or the admin channel). */
export async function seal(senderId, aad) {
  const nonce = new Uint8Array(NONCE_BYTES);
  crypto.getRandomValues(nonce);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: aadBytes(aad) },
    await aesKey(),
    idToBytes(senderId),
  ));

  const packed = new Uint8Array(1 + nonce.length + ciphertext.length);
  packed[0] = VERSION;
  packed.set(nonce, 1);
  packed.set(ciphertext, 1 + nonce.length);
  return toBase64Url(packed);
}

/** Decrypt a recipient-bound token. Throws for tampering or wrong associated data. */
export async function open(token, aad) {
  const packed = fromBase64Url(token);
  if (packed[0] !== VERSION) throw new Error('Unsupported secure token');
  const nonce = packed.slice(1, 1 + NONCE_BYTES);
  const ciphertext = packed.slice(1 + NONCE_BYTES);
  try {
    const plaintext = new Uint8Array(await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: nonce, additionalData: aadBytes(aad) },
      await aesKey(),
      ciphertext,
    ));
    return bytesToSafeId(plaintext);
  } catch {
    throw new Error('Invalid secure token');
  }
}

/** A keyed, truncated sender fingerprint used only in a recipient's block list. */
export async function senderFingerprint(senderId) {
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(), idToBytes(senderId)));
  let hex = '';
  for (let i = 0; i < 16; i += 1) hex += signature[i].toString(16).padStart(2, '0');
  return hex;
}

/** Twelve-character links use random URL-safe characters and never encode an ID. */
export function randomLinkToken(length = 12) {
  if (!Number.isSafeInteger(length) || length < 1 || length > 64) throw new Error('Invalid token length');
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let token = '';
  for (const byte of bytes) token += LINK_ALPHABET[byte & 63];
  return token;
}

export function isLinkToken(token) {
  return typeof token === 'string' && /^[A-Za-z0-9_-]{12}$/.test(token);
}

export function callbackData(prefix, token) {
  if (typeof prefix !== 'string' || !/^[a-z]:$/.test(prefix) || typeof token !== 'string') {
    throw new Error('Invalid callback data');
  }
  const data = `${prefix}${token}`;
  assertCallbackData(data);
  return data;
}

export function assertCallbackData(data) {
  if (typeof data !== 'string' || new TextEncoder().encode(data).length > CALLBACK_DATA_MAX_BYTES) {
    throw new Error('Callback data exceeds Telegram limit');
  }
  return true;
}
