import { db } from 'sdk';
import { and, eq } from 'sdk/db';
import { admins, users } from '../schema.js';
import { LINK_TOKEN_LENGTH, MAX_BLOCKED_USERS, OWNER_ID, isConfiguredTelegramId } from './config.js';
import { isLinkToken, randomLinkToken, senderFingerprint } from './crypto.js';

export function isValidTelegramId(value) {
  return Number.isSafeInteger(value) && value > 0;
}

export async function findUser(tgId) {
  if (!isValidTelegramId(tgId)) return null;
  return await db.select().from(users).where(eq(users.tgId, tgId)).get();
}

export async function findUserByLink(linkToken) {
  if (!isLinkToken(linkToken)) return null;
  return await db.select().from(users).where(eq(users.linkToken, linkToken)).get();
}

/** Idempotent registration. A link is random and is never derived from a Telegram ID. */
export async function getOrCreateUser(tgId) {
  if (!isValidTelegramId(tgId)) throw new Error('Invalid Telegram ID');
  const existing = await findUser(tgId);
  if (existing) return existing;

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const linkToken = randomLinkToken(LINK_TOKEN_LENGTH);
    try {
      await db.insert(users).values({ tgId, linkToken })
        .onConflictDoUpdate({ target: users.tgId, set: { tgId } })
        .run();
      const saved = await findUser(tgId);
      if (saved) return saved;
    } catch {
      // A statistically unlikely link collision or another concurrent registration.
      const raced = await findUser(tgId);
      if (raced) return raced;
    }
  }
  throw new Error('Could not create a unique anonymous link');
}

export async function updateUser(tgId, changes) {
  if (!isValidTelegramId(tgId)) return { rowsAffected: 0 };
  return await db.update(users).set(changes).where(eq(users.tgId, tgId)).run();
}

export async function setUserState(tgId, state, stateData = null) {
  const allowed = state === null || state === 'sending_to_link' || state === 'replying';
  if (!allowed) throw new Error('Invalid conversation state');
  return updateUser(tgId, { state, stateData });
}

export async function clearUserState(tgId) {
  return setUserState(tgId, null, null);
}

export async function regenerateLink(tgId) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const linkToken = randomLinkToken(LINK_TOKEN_LENGTH);
    try {
      const result = await db.update(users).set({ linkToken }).where(eq(users.tgId, tgId)).run();
      if (result.rowsAffected === 1) return linkToken;
    } catch {
      // Unique link-token collision: draw another random token.
    }
  }
  throw new Error('Could not regenerate anonymous link');
}

function normalizedBlocked(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((entry) => typeof entry === 'string' && /^[0-9a-f]{32}$/.test(entry)).slice(0, MAX_BLOCKED_USERS);
}

export async function hasBlocked(receiver, senderTgId) {
  if (!receiver || !isValidTelegramId(senderTgId)) return false;
  const fingerprint = await senderFingerprint(senderTgId);
  return normalizedBlocked(receiver.blocked).includes(fingerprint);
}

export async function blockSender(receiverTgId, senderTgId) {
  if (!isValidTelegramId(receiverTgId) || !isValidTelegramId(senderTgId) || receiverTgId === senderTgId) {
    throw new Error('Invalid block request');
  }
  const receiver = await findUser(receiverTgId);
  if (!receiver) throw new Error('Receiver is not registered');
  const fingerprint = await senderFingerprint(senderTgId);
  const blocked = normalizedBlocked(receiver.blocked).filter((entry) => entry !== fingerprint);
  blocked.push(fingerprint);
  const capped = blocked.slice(-MAX_BLOCKED_USERS);
  await db.update(users).set({ blocked: capped }).where(and(eq(users.tgId, receiverTgId), eq(users.tgId, receiver.tgId))).run();
  return capped.length;
}

/** Insert the configured owner once; harmless on every warm/cold invocation. */
export async function ensureOwnerAdmin() {
  if (!isConfiguredTelegramId(OWNER_ID)) return;
  await db.insert(admins).values({ tgId: OWNER_ID })
    .onConflictDoUpdate({ target: admins.tgId, set: { tgId: OWNER_ID } })
    .run();
}

export async function isAdmin(tgId) {
  if (!isValidTelegramId(tgId)) return false;
  const row = await db.select().from(admins).where(eq(admins.tgId, tgId)).get();
  return Boolean(row);
}

export async function addAdmin(tgId) {
  if (!isValidTelegramId(tgId)) throw new Error('Invalid administrator ID');
  await db.insert(admins).values({ tgId })
    .onConflictDoUpdate({ target: admins.tgId, set: { tgId } })
    .run();
}

export async function removeAdmin(tgId) {
  if (!isValidTelegramId(tgId) || tgId === OWNER_ID) return false;
  const result = await db.delete(admins).where(eq(admins.tgId, tgId)).run();
  return result.rowsAffected > 0;
}
