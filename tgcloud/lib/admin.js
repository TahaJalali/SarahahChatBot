import { api } from 'sdk';
import { and, asc, eq, gt, ne } from 'sdk/db';
import { db } from 'sdk';
import { admins, users } from '../schema.js';
import { ADMIN_CHAT_ID, BROADCAST_BATCH_SIZE, OWNER_ID, isConfiguredChatId } from './config.js';
import { open } from './crypto.js';
import { t } from './i18n.js';
import { addAdmin, findUser, isValidTelegramId, removeAdmin, updateUser } from './users.js';

function parseTarget(value) {
  if (typeof value !== 'string' || !/^\d{1,16}$/.test(value.trim())) return null;
  const id = Number(value.trim());
  return isValidTelegramId(id) ? id : null;
}

function reportTokenFromReply(message) {
  const text = message?.reply_to_message?.text;
  if (typeof text !== 'string') return null;
  const match = /(?:^|\s)a:([A-Za-z0-9_-]{50})(?:\s|$)/.exec(text);
  return match ? match[1] : null;
}

export async function banReportedUser(message) {
  if (!isConfiguredChatId(ADMIN_CHAT_ID) || message?.chat?.id !== ADMIN_CHAT_ID) return false;
  const token = reportTokenFromReply(message);
  if (!token) return false;
  let tgId;
  try {
    tgId = await open(token, 'admin');
  } catch {
    return false;
  }
  const target = await findUser(tgId);
  if (!target || tgId === OWNER_ID) return false;

  await updateUser(tgId, { status: 'banned', partnerId: null, searchSince: null, state: null, stateData: null });
  if (Number.isSafeInteger(target.partnerId)) {
    await db.update(users)
      .set({ status: 'idle', partnerId: null, searchSince: null })
      .where(and(eq(users.tgId, target.partnerId), eq(users.partnerId, tgId)))
      .run();
  }
  return true;
}

export async function unbanUser(tgId) {
  const target = await findUser(tgId);
  if (!target || target.status !== 'banned') return false;
  await updateUser(tgId, { status: 'idle', partnerId: null, searchSince: null });
  return true;
}

export async function stats() {
  const total = await db.$count(users);
  const banned = await db.$count(users, eq(users.status, 'banned'));
  const searching = await db.$count(users, eq(users.status, 'searching'));
  const chatting = await db.$count(users, eq(users.status, 'chatting'));
  return { total, banned, searching, chatting };
}

/** Send sequentially within fixed-size database batches, absorbing delivery failures. */
export async function broadcast(text) {
  let lastId = 0;
  let sent = 0;
  let failed = 0;

  for (;;) {
    const batch = await db.select({ id: users.id, tgId: users.tgId })
      .from(users)
      .where(and(ne(users.status, 'banned'), gt(users.id, lastId)))
      .orderBy(asc(users.id))
      .limit(BROADCAST_BATCH_SIZE)
      .all();
    if (batch.length === 0) break;

    for (const recipient of batch) {
      try {
        await api.sendMessage({ chat_id: recipient.tgId, text });
        sent += 1;
      } catch {
        failed += 1;
      }
    }
    lastId = batch[batch.length - 1].id;
  }
  return { sent, failed };
}

/** Execute a validated administrator command. Caller already verified administrator membership. */
export async function runAdminCommand(message, user, command, args) {
  if (command === 'ban') {
    const ok = await banReportedUser(message);
    return { handled: true, text: t(user, ok ? 'adminBanned' : 'adminNeedReportReply') };
  }
  if (command === 'unban') {
    const target = parseTarget(args);
    if (!target) return { handled: true, text: t(user, 'adminBadTarget') };
    const ok = await unbanUser(target);
    return { handled: true, text: t(user, ok ? 'adminUnbanned' : 'adminBadTarget') };
  }
  if (command === 'stats') {
    const values = await stats();
    return { handled: true, text: t(user, 'adminStats', {
      users: values.total,
      banned: values.banned,
      searching: values.searching,
      chatting: values.chatting,
    }) };
  }
  if (command === 'broadcast') {
    if (typeof args !== 'string' || !args.trim() || args.length > 4000) {
      return { handled: true, text: t(user, 'adminBroadcastUsage') };
    }
    const result = await broadcast(args.trim());
    return { handled: true, text: t(user, 'adminBroadcastDone', result) };
  }
  if (command === 'addadmin') {
    const target = parseTarget(args);
    if (!target) return { handled: true, text: t(user, 'adminBadTarget') };
    await addAdmin(target);
    return { handled: true, text: t(user, 'adminAdded') };
  }
  if (command === 'rmadmin') {
    const target = parseTarget(args);
    if (!target) return { handled: true, text: t(user, 'adminBadTarget') };
    const removed = await removeAdmin(target);
    return { handled: true, text: t(user, removed ? 'adminRemoved' : 'adminCannotRemoveOwner') };
  }
  return { handled: false };
}

export function isAdminCommand(command) {
  return ['ban', 'unban', 'stats', 'broadcast', 'addadmin', 'rmadmin'].includes(command);
}
