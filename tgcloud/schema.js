import { table, integer, text, boolean, json, index, sql } from 'sdk/db';

// No foreign keys: Telegram IDs are application-managed values in this schema.
export const users = table('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  tgId: integer('tg_id').notNull().unique(),
  status: text('status').notNull().default('idle'), // idle | searching | chatting | banned
  state: text('state'), // sending_to_link | replying
  stateData: text('state_data'),
  partnerId: integer('partner_id'),
  searchSince: integer('search_since'),
  linkToken: text('link_token').notNull().unique(),
  linkEnabled: boolean('link_enabled').notNull().default(true),
  notify: boolean('notify').notNull().default(true),
  lang: text('lang').notNull().default('fa'),
  acceptedRules: boolean('accepted_rules').notNull().default(false),
  blocked: json('blocked').notNull().default([]),
  rlWindow: integer('rl_window'),
  rlCount: integer('rl_count'),
  created: integer('created', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
}, (t) => ({
  tgIdIdx: index('idx_users_tg_id').on(t.tgId),
  linkTokenIdx: index('idx_users_link_token').on(t.linkToken),
  statusSearchIdx: index('idx_users_status_search_since').on(t.status, t.searchSince),
}));

export const admins = table('admins', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  tgId: integer('tg_id').notNull().unique(),
  created: integer('created', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});
