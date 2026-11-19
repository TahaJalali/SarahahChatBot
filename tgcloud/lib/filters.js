// Random chat intentionally filters only visible text/captions. File contents are never inspected.
const URL_RE = /(?:[a-z][a-z0-9+.-]{1,31}:\/\/|tg:\/\/|www\.|(?:[a-z0-9-]+\.)+[a-z]{2,}\b)/i;
const USERNAME_RE = /(^|\s)@[a-zA-Z0-9_]{5,}\b/;
const PHONE_RE = /(?:\+?[\d۰-۹٠-٩][\d۰-۹٠-٩\s().-]{6,}[\d۰-۹٠-٩])/;

export function randomChatContentBlocked(message) {
  const content = typeof message?.text === 'string'
    ? message.text
    : (typeof message?.caption === 'string' ? message.caption : '');
  return URL_RE.test(content) || USERNAME_RE.test(content) || PHONE_RE.test(content);
}
