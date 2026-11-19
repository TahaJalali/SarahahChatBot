import { api } from 'sdk';
import { beginAnonymousReply, beginLinkedMessage, blockAnonymousSender, regenerateAnonymousLink, reportAnonymousMessage, safeSendMessage, showLinkSettings, showMainMenu, toggleLink, toggleNotifications } from '../lib/anon.js';
import { assertCallbackData, isLinkToken } from '../lib/crypto.js';
import { t } from '../lib/i18n.js';
import { languageKeyboard, linkSettingsKeyboard, mainMenuKeyboard, rulesKeyboard } from '../lib/keyboards.js';
import { searchForPartner } from '../lib/random.js';
import { ensureOwnerAdmin, findUser, getOrCreateUser, updateUser } from '../lib/users.js';

async function answer(callbackQuery, text = '') {
  if (!callbackQuery?.id) return;
  try {
    await api.answerCallbackQuery({ callback_query_id: callbackQuery.id, text });
  } catch {
    // Telegram may have expired the callback; there is no sensitive fallback to send.
  }
}

async function showRules(user) {
  return safeSendMessage(user.tgId, t(user, 'rules'), { reply_markup: rulesKeyboard(user) });
}

async function chooseLanguage(user) {
  return safeSendMessage(user.tgId, t(user, 'menuLanguage'), { reply_markup: languageKeyboard() });
}

export default async function (callbackQuery) {
  const callbackId = callbackQuery?.id;
  if (!callbackId) return;

  let answerText = '';
  try {
    const tgId = callbackQuery?.from?.id;
    if (!Number.isSafeInteger(tgId) || tgId <= 0) {
      answerText = 'Invalid callback';
      return;
    }

    // Ban check is deliberately before any action, registration, or callback parsing.
    const known = await findUser(tgId);
    if (known?.status === 'banned') return;

    await ensureOwnerAdmin();
    let user = known || await getOrCreateUser(tgId);
    if (user.status === 'banned') return;

    const data = callbackQuery.data;
    try {
      assertCallbackData(data);
    } catch {
      answerText = t(user, 'invalidButton');
      return;
    }

    // Language selection is harmless before rules acceptance; every other action is gated.
    if (typeof data === 'string' && data.startsWith('lang:')) {
      const lang = data.slice(5);
      if (lang !== 'fa' && lang !== 'en') {
        answerText = t(user, 'invalidButton');
        return;
      }
      await updateUser(user.tgId, { lang });
      user = { ...user, lang };
      await safeSendMessage(user.tgId, t(user, 'languageSet'));
      if (user.acceptedRules) await showMainMenu(user);
      else await showRules(user);
      answerText = t(user, 'languageSet');
      return;
    }

    if (!user.acceptedRules) {
      if (data === 'rules:accept') {
        await updateUser(user.tgId, { acceptedRules: true });
        user = { ...user, acceptedRules: true };
        await safeSendMessage(user.tgId, t(user, 'rulesAccepted'), { reply_markup: mainMenuKeyboard(user) });
        answerText = t(user, 'rulesAccepted');
      } else if (data === 'menu:lang') {
        await chooseLanguage(user);
      } else {
        await showRules(user);
        answerText = t(user, 'invalidButton');
      }
      return;
    }

    if (data === 'rules:accept' || data === 'menu:main') {
      await showMainMenu(user);
      return;
    }
    if (data === 'menu:lang') {
      await chooseLanguage(user);
      return;
    }
    if (data === 'link:show') {
      await showLinkSettings(user);
      return;
    }
    if (data === 'link:regen') {
      const link = await regenerateAnonymousLink(user);
      const fresh = await findUser(user.tgId);
      await safeSendMessage(user.tgId, t(user, 'linkRegenerated', { link }), {
        reply_markup: fresh ? linkSettingsKeyboard(fresh) : undefined,
      });
      return;
    }
    if (data === 'link:toggle') {
      const enabled = await toggleLink(user);
      await safeSendMessage(user.tgId, t(user, 'linkToggled', { status: t(user, enabled ? 'enabled' : 'disabled') }));
      return;
    }
    if (data === 'link:notify') {
      const notify = await toggleNotifications(user);
      await safeSendMessage(user.tgId, t(user, 'notificationsToggled', { status: t(user, notify ? 'on' : 'off') }));
      return;
    }
    if (data === 'chat:search') {
      const result = await searchForPartner(user);
      if (result.state === 'searching') await safeSendMessage(user.tgId, t(user, 'searching'));
      if (result.state === 'chatting') await safeSendMessage(user.tgId, t(user, 'chatStarted'));
      return;
    }

    if (typeof data === 'string' && /^[rbp]:/.test(data)) {
      const prefix = data.slice(0, 2);
      const token = data.slice(2);
      if (prefix === 'r:') {
        const result = await beginAnonymousReply(user.tgId, token);
        await safeSendMessage(user.tgId, t(user, result.ok ? 'replyPrompt' : result.reason));
        return;
      }
      if (prefix === 'b:') {
        const ok = await blockAnonymousSender(user.tgId, token);
        await safeSendMessage(user.tgId, t(user, ok ? 'blocked' : 'invalidButton'));
        return;
      }
      const ok = await reportAnonymousMessage(callbackQuery.message, user.tgId, token);
      await safeSendMessage(user.tgId, t(user, ok ? 'reportReceived' : 'reportUnavailable'));
      return;
    }

    if (typeof data === 'string' && data.startsWith('s:')) {
      const linkToken = data.slice(2);
      if (!isLinkToken(linkToken)) {
        answerText = t(user, 'invalidButton');
        return;
      }
      const result = await beginLinkedMessage(user, linkToken);
      await safeSendMessage(user.tgId, t(user, result.ok ? 'writeForLink' : result.reason));
      return;
    }

    answerText = t(user, 'invalidButton');
  } finally {
    await answer(callbackQuery, answerText);
  }
}
