import { callbackData, assertCallbackData, isLinkToken } from './crypto.js';
import { t } from './i18n.js';

function button(text, callback_data) {
  assertCallbackData(callback_data);
  return { text, callback_data };
}

export function rulesKeyboard(user) {
  return {
    inline_keyboard: [
      [button(t(user, 'acceptRules'), 'rules:accept')],
      [button(t(user, 'chooseLanguage'), 'menu:lang')],
    ],
  };
}

export function mainMenuKeyboard(user) {
  return {
    inline_keyboard: [
      [button(t(user, 'myLink'), 'link:show')],
      [button(t(user, 'randomChat'), 'chat:search')],
      [button(t(user, 'chooseLanguage'), 'menu:lang')],
    ],
  };
}

export function linkSettingsKeyboard(user) {
  return {
    inline_keyboard: [
      [button(t(user, 'regenerate'), 'link:regen')],
      [button(t(user, 'toggleLink'), 'link:toggle')],
      [button(t(user, 'toggleNotifications'), 'link:notify')],
      [button(t(user, 'cancel'), 'menu:main')],
    ],
  };
}

export function languageKeyboard() {
  return {
    inline_keyboard: [
      [button('فارسی', 'lang:fa'), button('English', 'lang:en')],
      [button('‹', 'menu:main')],
    ],
  };
}

export function anonymousMessageKeyboard(token) {
  return {
    inline_keyboard: [[
      button('💬 Reply', callbackData('r:', token)),
      button('🚫 Block', callbackData('b:', token)),
      button('⚠️ Report', callbackData('p:', token)),
    ]],
  };
}

export function sendAnotherKeyboard(linkToken) {
  if (!isLinkToken(linkToken)) throw new Error('Invalid link token');
  return { inline_keyboard: [[button('✉️ Send another', `s:${linkToken}`)]] };
}
