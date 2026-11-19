// Copy this file to tgcloud/lib/secrets.js, then replace both values.
// Do not commit tgcloud/lib/secrets.js.
//
// Generate each 32-byte key locally, for example:
//   node -e "const c=require('crypto'); console.log(c.randomBytes(32).toString('hex'))"
// Run it twice: once for AES_KEY_HEX and once for HMAC_KEY_HEX.
export const AES_KEY_HEX = 'REPLACE_WITH_64_RANDOM_HEX_CHARACTERS';
export const HMAC_KEY_HEX = 'REPLACE_WITH_64_RANDOM_HEX_CHARACTERS';
