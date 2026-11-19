# OpenVeil — anonymous Telegram messaging bot

OpenVeil is the open-source code for **@SarahahChatBot**, an anonymous-messaging bot built for [Telegram Serverless](https://core.telegram.org/bots/serverless) (`tgcloud`). It provides:

- personal anonymous links such as `https://t.me/SarahahChatBot?start=<random-token>`;
- stateless, recipient-bound Reply / Block / Report buttons;
- opt-in random anonymous chat with race-safe matching;
- Persian (default) and English user interfaces; and
- an administrator report and moderation flow that avoids exposing Telegram IDs in normal bot content.

There is no Mini App, HTTP endpoint, or Node.js runtime component.

## Privacy model and limits

**What OpenVeil does**

- It uses `copyMessage`, not forwarding, so the other participant does not get a Telegram forward header or username.
- Normal anonymous-link and random-chat message contents are not stored in OpenVeil's database.
- Personal link tokens are random 12-character URL-safe values; they are never derived from Telegram IDs.
- Reply tokens are AES-256-GCM encrypted with a fresh nonce and bound to the person pressing the button through authenticated associated data. A copied button cannot be used by another account.
- A block list stores only a truncated keyed HMAC fingerprint of a sender, not their raw ID.
- Reports copy only the selected message to the configured admin chat. The accompanying admin token lets `/ban` recover the reported source without displaying a raw Telegram ID to admins.

**What it does not claim**

OpenVeil is **anonymous to the other participant**, not end-to-end encrypted and not anonymous to Telegram. Telegram transports and hosts bot messages. The bot server necessarily receives updates in order to copy them. Reported messages are forwarded to the administrator chat. As with every bot, people can still screenshot, copy, or report content outside this bot.

The database intentionally has no message table, message mapping table, or durable sender-to-recipient conversation mapping. The only temporary routing values are the user-requested FSM state (`stateData`) while a user is composing an anonymous message or reply.

## Prerequisites

- A Telegram bot created with [@BotFather](https://t.me/BotFather).
- Node.js/npm for the `tgcloud` CLI on your workstation.
- A Telegram Serverless-enabled bot and CLI access token.

## Setup

1. Install the project dependencies:

   ```sh
   npm ci
   ```

2. Fill the deployment IDs in `tgcloud/lib/config.js`:

   ```js
   export const OWNER_ID = 123456789;
   export const ADMIN_CHAT_ID = -1001234567890;
   ```

   `OWNER_ID` is inserted idempotently into the `admins` table on bot activity. `ADMIN_CHAT_ID` is where report copies and admin tokens are sent.

3. Create the ignored local secrets file from the example:

   ```sh
   cp docs/secrets.example.js tgcloud/lib/secrets.js
   node -e "const c=require('crypto'); console.log(c.randomBytes(32).toString('hex'))"
   ```

   Run the `node` command **twice**, and place one 64-character hex value in each of `AES_KEY_HEX` and `HMAC_KEY_HEX`. Keep `tgcloud/lib/secrets.js` private; it is deliberately listed in `.gitignore`.

4. Optionally change `BOT_USERNAME` or the display name `BOT_NAME` only in `tgcloud/lib/config.js`. The deployed bot username must match the BotFather username exactly.

## Deploy checklist

1. In **@BotFather**, enable **Serverless** for the bot.
2. Obtain a Telegram Serverless **CLI access token**.
3. Authenticate this checkout:

   ```sh
   npx tgcloud login
   ```

4. Fill `tgcloud/lib/config.js` and the untracked `tgcloud/lib/secrets.js` as described above.
5. Deploy code:

   ```sh
   npx tgcloud push
   ```

6. Apply the schema separately (deployment never migrates the database):

   ```sh
   npx tgcloud migrate
   ```

7. Confirm the platform-managed webhook is current:

   ```sh
   npx tgcloud webhook sync
   ```

8. In **@BotFather**, set the About text, Description, and command list. A suggested command list is:

   ```text
   start - Open the menu or use an anonymous link
   menu - Show the main menu
   link - Manage your anonymous link
   search - Find a random chat partner
   next - Find someone new
   stop - End random chat/search
   report - Report a replied random-chat message
   cancel - Cancel an anonymous message or reply
   language - Choose Persian or English
   ```

   Keep the administrator commands (`/ban`, `/unban`, `/stats`, `/broadcast`, `/addadmin`, `/rmadmin`) out of the public command list.

## Testing

The serverless runtime must be linked before `run` can execute code. Verify the basic `/start` route with the payload shape supplied by the platform:

```sh
npx tgcloud run handlers/message '{ chat:{id:1}, from:{id:1}, text:"/start" }'
```

The runtime crypto self-test covers an AES-GCM round trip, wrong-AAD rejection, tampered-token rejection, and callback-data sizing:

```sh
npx tgcloud run handlers/message '{}' --ctx '{ selftest: true }'
```

Expected self-test result:

```json
{"ok":true,"checks":6}
```

Run `npx tgcloud push` before remote execution when testing changes not yet deployed, then run `npx tgcloud migrate` after schema changes.

## Security notes

- The AES-256-GCM and HMAC keys are part of the deployed serverless code, **not** the database. This is required because the platform has no environment-variable facility for this project. Treat the local secret file and deployed source access as sensitive.
- Rotating either key invalidates existing reply/block/report buttons. AES-key rotation makes old sealed reply/admin tokens unreadable; HMAC-key rotation makes existing block fingerprints no longer match. Announce or accept that trade-off before rotation.
- Never log message text, decrypted token values, or IDs paired with secure tokens. The code intentionally does not do so.
- The 20-message-per-minute limit is stored on each user row. Random chat additionally filters visible links, `@usernames`, and phone-number-shaped text/captions.
- The Bot API can return `403` when a recipient has blocked the bot. Delivery code treats this as a generic delivery failure and does not reveal recipient details.
- Back up neither database contents nor code into a location that accidentally includes `tgcloud/lib/secrets.js`.

## Project structure

```text
tgcloud/
  schema.js                    # users and admins only
  handlers/message.js           # command/FSM/relay router
  handlers/callback_query.js    # inline button router
  lib/config.js                 # bot identity and deployment IDs
  lib/secrets.js                # untracked keys
  lib/crypto.js                 # stateless AES-GCM/HMAC token functions
  lib/anon.js                   # anonymous-link relay/report flow
  lib/random.js                 # random-chat state and matching
  lib/admin.js                  # moderation and broadcast
```

## Contributing

Read `AGENTS.md` and `docs/tgcloud-sdk.md` before changing bot code. Serverless modules may use only `sdk`, `sdk/db`, standard web globals, and project-relative `.js` imports. Do not add npm imports or Node APIs inside `tgcloud/`. Every database call is async; schema changes require both `npx tgcloud push` and `npx tgcloud migrate`.

Please keep the no-message-storage design intact, add or update the runtime self-test for cryptographic changes, and never commit real secrets, exported user data, or message content.

## License

[MIT](LICENSE)
