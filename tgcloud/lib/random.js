import { api } from 'sdk';
import { and, asc, eq, ne } from 'sdk/db';
import { db } from 'sdk';
import { users } from '../schema.js';
import { randomChatContentBlocked } from './filters.js';
import { t } from './i18n.js';
import { safeSendMessage } from './anon.js';
import { findUser, updateUser } from './users.js';

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

async function tellChatStarted(user) {
  return safeSendMessage(user.tgId, t(user, 'chatStarted'), {
    disable_notification: user.notify === false,
  });
}

/** Race-safe pairing: a contender is claimed only while still searching. */
export async function searchForPartner(user) {
  let me = await findUser(user.tgId);
  if (!me || me.status === 'banned') return { state: 'unavailable' };
  if (me.status === 'chatting') return { state: 'chatting' };

  if (me.status !== 'searching') {
    await updateUser(me.tgId, { status: 'searching', partnerId: null, searchSince: nowSeconds() });
    me = await findUser(me.tgId);
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = await db.select().from(users)
      .where(and(eq(users.status, 'searching'), ne(users.tgId, me.tgId)))
      .orderBy(asc(users.searchSince), asc(users.id))
      .limit(1)
      .get();

    if (!candidate) return { state: 'searching' };

    const claimedCandidate = await db.update(users)
      .set({ status: 'chatting', partnerId: me.tgId, searchSince: null })
      .where(and(eq(users.tgId, candidate.tgId), eq(users.status, 'searching')))
      .run();
    if (claimedCandidate.rowsAffected !== 1) continue;

    const claimedMe = await db.update(users)
      .set({ status: 'chatting', partnerId: candidate.tgId, searchSince: null })
      .where(and(eq(users.tgId, me.tgId), eq(users.status, 'searching')))
      .run();

    if (claimedMe.rowsAffected !== 1) {
      // The caller stopped searching in another concurrent update: release the candidate.
      await db.update(users)
        .set({ status: 'searching', partnerId: null, searchSince: candidate.searchSince ?? nowSeconds() })
        .where(and(eq(users.tgId, candidate.tgId), eq(users.status, 'chatting'), eq(users.partnerId, me.tgId)))
        .run();
      return { state: 'searching' };
    }

    const pairedMe = await findUser(me.tgId);
    const pairedCandidate = await findUser(candidate.tgId);
    if (pairedMe) await tellChatStarted(pairedMe);
    if (pairedCandidate) await tellChatStarted(pairedCandidate);
    return { state: 'paired', partner: pairedCandidate };
  }
  return { state: 'searching' };
}

/** End both sides only if they still point to one another; prevents stale-session clobbering. */
export async function endRandomChat(user, requeue = false) {
  const current = await findUser(user.tgId);
  if (!current || current.status === 'banned') return { ended: false, partner: null };

  const nextState = requeue ? 'searching' : 'idle';
  const nextSearchSince = requeue ? nowSeconds() : null;
  await updateUser(current.tgId, { status: nextState, partnerId: null, searchSince: nextSearchSince });

  if (current.status !== 'chatting' || !Number.isSafeInteger(current.partnerId)) {
    return { ended: current.status === 'searching', partner: null };
  }

  const partner = await findUser(current.partnerId);
  const clearedPartner = await db.update(users)
    .set({ status: 'idle', partnerId: null, searchSince: null })
    .where(and(eq(users.tgId, current.partnerId), eq(users.status, 'chatting'), eq(users.partnerId, current.tgId)))
    .run();

  if (partner && clearedPartner.rowsAffected === 1) {
    await safeSendMessage(partner.tgId, t(partner, 'chatEnded'), { disable_notification: partner.notify === false });
  }
  return { ended: true, partner };
}

export async function relayRandomMessage(message, sender) {
  if (randomChatContentBlocked(message)) return { ok: false, reason: 'filtering' };
  const freshSender = await findUser(sender.tgId);
  if (!freshSender || freshSender.status !== 'chatting' || !Number.isSafeInteger(freshSender.partnerId)) {
    return { ok: false, reason: 'noChat' };
  }
  const partner = await findUser(freshSender.partnerId);
  if (!partner || partner.status !== 'chatting' || partner.partnerId !== freshSender.tgId) {
    await updateUser(freshSender.tgId, { status: 'idle', partnerId: null, searchSince: null });
    return { ok: false, reason: 'noChat' };
  }
  if (!message?.chat || message.chat.id !== freshSender.tgId || !Number.isSafeInteger(message.message_id)) {
    return { ok: false, reason: 'noChat' };
  }

  try {
    await api.copyMessage({
      chat_id: partner.tgId,
      from_chat_id: message.chat.id,
      message_id: message.message_id,
      disable_notification: partner.notify === false,
    });
    return { ok: true };
  } catch (error) {
    if (Number(error?.code) === 403) await endRandomChat(freshSender, false);
    return { ok: false, reason: 'deliveryFailed' };
  }
}
