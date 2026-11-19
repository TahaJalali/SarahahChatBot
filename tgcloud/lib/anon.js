import { api, BotApiError } from 'sdk';
import { ADMIN_CHAT_ID, botLink, isConfiguredChatId } from './config.js';
import { open, seal } from './crypto.js';
import { anonymousMessageKeyboard, linkSettingsKeyboard, mainMenuKeyboard, sendAnotherKeyboard } from './keyboards.js';
import { t } from './i18n.js';
import {
  blockSender,
  clearUserState,
  findUser,
  findUserByLink,
  hasBlocked,
  regenerateLink,
  setUserState,
  updateUser,
} from './users.js';

function validSourceMessage(message, expectedChatId) {
  return Boolean(message
    && message.chat
    && message.chat.id === expectedChatId
    && Number.isSafeInteger(message.message_id)
    && message.message_id > 0);
}

function deliveryError(error) {
  return error instanceof BotApiError || Number.isSafeInteger(error?.code);
}

/** Never throws delivery details back to the other Telegram user. */
export async function safeSendMessage(chatId, text, extra = {}) {
  try {
    await api.sendMessage({ chat_id: chatId, text, ...extra });
    return true;
  } catch (error) {
    if (deliveryError(error)) return false;
    return false;
  }
}

async function copyAnonymousMessage({ message, source, recipient }) {
  if (!validSourceMessage(message, source.tgId)) return { ok: false, blockedBot: false };
  const token = await seal(source.tgId, recipient.tgId);
  try {
    await api.copyMessage({
      chat_id: recipient.tgId,
      from_chat_id: message.chat.id,
      message_id: message.message_id,
      disable_notification: recipient.notify === false,
      reply_markup: anonymousMessageKeyboard(token),
    });
    return { ok: true, blockedBot: false };
  } catch (error) {
    return { ok: false, blockedBot: Number(error?.code) === 403 };
  }
}

export async function showMainMenu(user) {
  return safeSendMessage(user.tgId, t(user, 'mainMenu'), { reply_markup: mainMenuKeyboard(user) });
}

export async function showLinkSettings(user) {
  const enabled = user.linkEnabled ? t(user, 'enabled') : t(user, 'disabled');
  const notifications = user.notify ? t(user, 'on') : t(user, 'off');
  return safeSendMessage(user.tgId, t(user, 'linkSettings', {
    link: botLink(user.linkToken),
    status: enabled,
    notifications,
  }), { reply_markup: linkSettingsKeyboard(user) });
}

/** Validate a /start link and put only the intended owner ID in the transient FSM state. */
export async function beginLinkedMessage(sender, linkToken) {
  const owner = await findUserByLink(linkToken);
  if (!owner) return { ok: false, reason: 'invalidLink' };
  if (owner.tgId === sender.tgId) return { ok: false, reason: 'ownLink' };
  if (owner.status === 'banned' || !owner.linkEnabled) return { ok: false, reason: 'linkDisabled' };
  if (await hasBlocked(owner, sender.tgId)) return { ok: false, reason: 'senderBlocked' };
  await setUserState(sender.tgId, 'sending_to_link', String(owner.tgId));
  return { ok: true };
}

/** Relay a user message into a personal link without storing its contents. */
export async function deliverLinkedMessage(message, sender) {
  const stateOwnerId = typeof sender.stateData === 'string' && /^\d+$/.test(sender.stateData)
    ? Number(sender.stateData)
    : null;
  const owner = Number.isSafeInteger(stateOwnerId) ? await findUser(stateOwnerId) : null;
  if (!owner || owner.status === 'banned' || !owner.linkEnabled || owner.tgId === sender.tgId) {
    await clearUserState(sender.tgId);
    return { ok: false, reason: 'invalidLink' };
  }
  if (await hasBlocked(owner, sender.tgId)) {
    await clearUserState(sender.tgId);
    return { ok: false, reason: 'senderBlocked' };
  }

  const delivered = await copyAnonymousMessage({ message, source: sender, recipient: owner });
  await clearUserState(sender.tgId);
  return delivered.ok
    ? { ok: true, linkToken: owner.linkToken }
    : { ok: false, reason: 'deliveryFailed', blockedBot: delivered.blockedBot };
}

/** Reply token is recipient-bound, then retained only while the user composes one reply. */
export async function beginAnonymousReply(receiverTgId, token) {
  let senderId;
  try {
    senderId = await open(token, receiverTgId);
  } catch {
    return { ok: false, reason: 'invalidButton' };
  }
  if (senderId === receiverTgId) return { ok: false, reason: 'invalidButton' };
  const originalSender = await findUser(senderId);
  if (!originalSender || originalSender.status === 'banned' || await hasBlocked(originalSender, receiverTgId)) {
    return { ok: false, reason: 'replyUnavailable' };
  }
  await setUserState(receiverTgId, 'replying', token);
  return { ok: true };
}

export async function deliverAnonymousReply(message, replier) {
  const token = typeof replier.stateData === 'string' ? replier.stateData : '';
  let recipientId;
  try {
    recipientId = await open(token, replier.tgId);
  } catch {
    await clearUserState(replier.tgId);
    return { ok: false, reason: 'replyUnavailable' };
  }
  const recipient = await findUser(recipientId);
  if (!recipient || recipient.status === 'banned' || await hasBlocked(recipient, replier.tgId)) {
    await clearUserState(replier.tgId);
    return { ok: false, reason: 'replyUnavailable' };
  }

  const delivered = await copyAnonymousMessage({ message, source: replier, recipient });
  await clearUserState(replier.tgId);
  return delivered.ok ? { ok: true } : { ok: false, reason: 'deliveryFailed', blockedBot: delivered.blockedBot };
}

export async function blockAnonymousSender(receiverTgId, token) {
  let senderId;
  try {
    senderId = await open(token, receiverTgId);
  } catch {
    return false;
  }
  if (senderId === receiverTgId) return false;
  await blockSender(receiverTgId, senderId);
  return true;
}

async function sendReportCopy(message, sourceTgId) {
  if (!isConfiguredChatId(ADMIN_CHAT_ID)
    || !Number.isSafeInteger(sourceTgId)
    || sourceTgId <= 0
    || !message?.chat
    || !validSourceMessage(message, message.chat.id)) return false;
  const token = await seal(sourceTgId, 'admin');
  try {
    await api.copyMessage({
      chat_id: ADMIN_CHAT_ID,
      from_chat_id: message.chat.id,
      message_id: message.message_id,
      disable_notification: true,
    });
    await api.sendMessage({
      chat_id: ADMIN_CHAT_ID,
      text: `Anonymous-message report\nAdmin token: a:${token}\nReply to this message with /ban to ban the reported source.`,
      disable_notification: true,
    });
    return true;
  } catch (error) {
    if (deliveryError(error)) return false;
    return false;
  }
}

/** Report the displayed copy itself; its source is recovered only from the recipient-bound token. */
export async function reportAnonymousMessage(callbackMessage, reporterTgId, token) {
  let sourceTgId;
  try {
    sourceTgId = await open(token, reporterTgId);
  } catch {
    return false;
  }
  if (!callbackMessage || !callbackMessage.chat || callbackMessage.chat.id !== reporterTgId) return false;
  return sendReportCopy(callbackMessage, sourceTgId);
}

/** /report for random chat uses the current partner ID and only the replied copy. */
export async function reportRandomMessage(message, reporter) {
  if (!reporter || reporter.status !== 'chatting' || !Number.isSafeInteger(reporter.partnerId)) return false;
  const replied = message?.reply_to_message;
  if (!replied || !message.chat || message.chat.id !== reporter.tgId) return false;
  return sendReportCopy({ ...replied, chat: message.chat }, reporter.partnerId);
}

export async function regenerateAnonymousLink(user) {
  const linkToken = await regenerateLink(user.tgId);
  return botLink(linkToken);
}

export async function toggleLink(user) {
  const enabled = !user.linkEnabled;
  await updateUser(user.tgId, { linkEnabled: enabled });
  return enabled;
}

export async function toggleNotifications(user) {
  const notify = !user.notify;
  await updateUser(user.tgId, { notify });
  return notify;
}

export function sendAnotherFor(linkToken) {
  return sendAnotherKeyboard(linkToken);
}
