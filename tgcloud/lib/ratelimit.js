import { db } from 'sdk';
import { and, eq, lt, sql } from 'sdk/db';
import { users } from '../schema.js';
import { RATE_LIMIT_MAX, RATE_LIMIT_SECONDS } from './config.js';

/** Fixed one-minute window stored on the user row; conditional increment avoids most races. */
export async function consumeMessageQuota(user) {
  const now = Math.floor(Date.now() / 1000);
  const windowStart = Number.isSafeInteger(user.rlWindow) ? user.rlWindow : 0;
  const count = Number.isSafeInteger(user.rlCount) ? user.rlCount : 0;

  if (windowStart <= now - RATE_LIMIT_SECONDS) {
    await db.update(users).set({ rlWindow: now, rlCount: 1 }).where(eq(users.tgId, user.tgId)).run();
    return true;
  }
  if (count >= RATE_LIMIT_MAX) return false;

  const result = await db.update(users)
    .set({ rlCount: sql`${users.rlCount} + ${1}` })
    .where(and(eq(users.tgId, user.tgId), eq(users.rlWindow, windowStart), lt(users.rlCount, RATE_LIMIT_MAX)))
    .run();
  return result.rowsAffected === 1;
}
