import { beginLinkedMessage, deliverAnonymousReply, deliverLinkedMessage, reportRandomMessage, safeSendMessage, sendAnotherFor, showLinkSettings, showMainMenu } from '../lib/anon.js';
import { isAdminCommand, runAdminCommand } from '../lib/admin.js';
import { ADMIN_CHAT_ID, isConfiguredChatId } from '../lib/config.js';
import { t } from '../lib/i18n.js';
import { languageKeyboard, rulesKeyboard } from '../lib/keyboards.js';
import { consumeMessageQuota } from '../lib/ratelimit.js';
import { endRandomChat, relayRandomMessage, searchForPartner } from '../lib/random.js';
import { runCryptoSelfTest } from '../lib/selftest.js';
import { clearUserState, ensureOwnerAdmin, findUser, getOrCreateUser, isAdmin } from '../lib/users.js';

function messageContext(message) {
  const tgId = message?.from?.id;
  const chatId = message?.chat?.id;
  if (!Number.isSafeInteger(tgId) || tgId <= 0 || !Number.isSafeInteger(chatId) || chatId === 0) return null;
  return { tgId, chatId, isPrivate: chatId === tgId };
}

function parseCommand(text) {
  if (typeof text !== 'string') return null;
  const match = /^\/([a-zA-Z]+)(?:@[A-Za-z0-9_]+)?(?:\s+([\s\S]*))?$/.exec(text);
  if (!match) return null;
  return { name: match[1].toLowerCase(), args: match[2] ?? '' };
}

async function showRules(user) {
  return safeSendMessage(user.tgId, t(user, 'rules'), { reply_markup: rulesKeyboard(user) });
}

async function respondStateResult(user, result, successKey) {
  if (result.ok) return safeSendMessage(user.tgId, t(user, successKey));
  return safeSendMessage(user.tgId, t(user, result.reason || 'deliveryFailed'));
}

export default async function (message, ctx) {
  // tgcloud run can invoke this private harness without exposing it to Telegram updates.
  if (ctx?.selftest === true) return runCryptoSelfTest();

  const context = messageContext(message);
  if (!context) return;
  const { tgId, chatId, isPrivate } = context;

  // Ban check intentionally precedes registration, quotas, commands, and state-machine work.
  const known = await findUser(tgId);
  if (known?.status === 'banned') return;

  const command = parseCommand(message.text);
  // Ignore ordinary group traffic. Only configured-admin-chat commands are processed there.
  if (!isPrivate && (!command || !isAdminCommand(command.name)
    || !isConfiguredChatId(ADMIN_CHAT_ID) || chatId !== ADMIN_CHAT_ID)) return;

  await ensureOwnerAdmin();
  if (!isPrivate && !await isAdmin(tgId)) return;

  const user = known || await getOrCreateUser(tgId);
  if (user.status === 'banned') return;

  if (!await consumeMessageQuota(user)) {
    await safeSendMessage(isPrivate ? user.tgId : chatId, t(user, 'rateLimited'));
    return;
  }
  if (!user.acceptedRules) {
    await showRules(user);
    return;
  }

  if (command && isAdminCommand(command.name)) {
    if (!await isAdmin(user.tgId)) {
      await safeSendMessage(isPrivate ? user.tgId : chatId, t(user, 'adminOnly'));
      return;
    }
    if (!isPrivate && (!isConfiguredChatId(ADMIN_CHAT_ID) || chatId !== ADMIN_CHAT_ID)) return;
    const result = await runAdminCommand(message, user, command.name, command.args);
    if (result.handled) await safeSendMessage(isPrivate ? user.tgId : chatId, result.text);
    return;
  }

  // The public admin chat accepts only authenticated administrator commands.
  if (!isPrivate) return;

  if (command?.name === 'start') {
    const linkToken = command.args.trim();
    if (!linkToken) {
      await showMainMenu(user);
      return;
    }
    const result = await beginLinkedMessage(user, linkToken);
    await safeSendMessage(user.tgId, t(user, result.ok ? 'writeForLink' : result.reason));
    return;
  }

  if (command?.name === 'cancel') {
    if (user.state) {
      await clearUserState(user.tgId);
      await safeSendMessage(user.tgId, t(user, 'cancelled'));
    } else {
      await safeSendMessage(user.tgId, t(user, 'noActiveAction'));
    }
    return;
  }

  if (command?.name === 'menu') {
    await showMainMenu(user);
    return;
  }

  if (command?.name === 'link') {
    await showLinkSettings(user);
    return;
  }

  if (command?.name === 'language') {
    await safeSendMessage(user.tgId, t(user, 'menuLanguage'), { reply_markup: languageKeyboard() });
    return;
  }

  if (command?.name === 'search') {
    const result = await searchForPartner(user);
    if (result.state === 'searching') await safeSendMessage(user.tgId, t(user, 'searching'));
    if (result.state === 'chatting') await safeSendMessage(user.tgId, t(user, 'chatStarted'));
    return;
  }

  if (command?.name === 'next') {
    await endRandomChat(user, true);
    const fresh = await findUser(user.tgId);
    if (fresh) {
      const result = await searchForPartner(fresh);
      if (result.state === 'searching') await safeSendMessage(user.tgId, t(fresh, 'searching'));
    }
    return;
  }

  if (command?.name === 'stop') {
    const wasActive = user.status === 'searching' || user.status === 'chatting';
    await endRandomChat(user, false);
    await safeSendMessage(user.tgId, t(user, wasActive ? 'chatEnded' : 'noChat'));
    return;
  }

  if (command?.name === 'report') {
    const ok = await reportRandomMessage(message, user);
    await safeSendMessage(user.tgId, t(user, ok ? 'randomReported' : 'replyToReport'));
    return;
  }

  if (user.state === 'sending_to_link') {
    const result = await deliverLinkedMessage(message, user);
    if (result.ok) {
      await safeSendMessage(user.tgId, t(user, 'sent'), { reply_markup: sendAnotherFor(result.linkToken) });
    } else {
      await respondStateResult(user, result, 'sent');
    }
    return;
  }

  if (user.state === 'replying') {
    const result = await deliverAnonymousReply(message, user);
    await respondStateResult(user, result, 'replySent');
    return;
  }

  if (user.status === 'chatting') {
    const result = await relayRandomMessage(message, user);
    if (!result.ok) await safeSendMessage(user.tgId, t(user, result.reason));
    return;
  }

  await safeSendMessage(user.tgId, t(user, 'useMenu'));
}
