import { assertCallbackData, callbackData, open, seal } from './crypto.js';

function expect(condition, label) {
  if (!condition) throw new Error(`Self-test failed: ${label}`);
}

async function rejects(work) {
  try {
    await work();
    return false;
  } catch {
    return true;
  }
}

/** Crypto regression checks; invoke through handlers/message with --ctx '{ selftest: true }'. */
export async function runCryptoSelfTest() {
  const token = await seal(123456789, 987654321);
  expect(token.length === 50, 'sealed token has the expected compact length');
  expect(await open(token, 987654321) === 123456789, 'AES-GCM round trip');
  expect(await rejects(() => open(token, 987654322)), 'wrong AAD fails');

  // The final base64url character encodes only two significant bits here; change those bits.
  const replacement = token.endsWith('A') ? 'Q' : 'A';
  const tampered = `${token.slice(0, -1)}${replacement}`;
  expect(await rejects(() => open(tampered, 987654321)), 'tampered token fails');

  const callback = callbackData('r:', token);
  expect(callback.length === 52, 'reply callback length');
  expect(assertCallbackData(callback) === true, 'valid callback accepted');
  expect(await rejects(() => Promise.resolve(assertCallbackData('x'.repeat(65)))), 'oversized callback rejected');
  return { ok: true, checks: 6 };
}
