// Bot identity and deployment-specific IDs live here, never scattered through handlers.
export const BOT_USERNAME = 'SarahahChatBot';
export const BOT_NAME = 'OpenVeil';

// Replace both placeholders with numeric Telegram IDs before deploying.
export const OWNER_ID = 0;
export const ADMIN_CHAT_ID = 0;

export const RATE_LIMIT_MAX = 20;
export const RATE_LIMIT_SECONDS = 60;
export const MAX_BLOCKED_USERS = 500;
export const LINK_TOKEN_LENGTH = 12;
export const CALLBACK_DATA_MAX_BYTES = 64;
export const BROADCAST_BATCH_SIZE = 20;

export function botLink(linkToken) {
  return `https://t.me/${BOT_USERNAME}?start=${linkToken}`;
}

export function isConfiguredTelegramId(value) {
  return Number.isSafeInteger(value) && value > 0;
}

// Administrator destinations may be a private user ID or a negative group/supergroup ID.
export function isConfiguredChatId(value) {
  return Number.isSafeInteger(value) && value !== 0;
}
