// Database schema for Declination (Netlify Database / Postgres).
// Migrations in netlify/database/migrations are generated from this file with drizzle-kit.
import { pgTable, serial, text, integer, bigint, doublePrecision, timestamp, primaryKey, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

const ms = (name: string) => bigint(name, { mode: 'number' });

export const users = pgTable('users', {
  id: serial().primaryKey(),
  name: text().notNull(),
  surname: text().notNull(),
  email: text().notNull().unique(),
  handle: text().notNull().unique(),
  passSalt: text('pass_salt'),
  passHash: text('pass_hash'),
  bio: text().notNull().default(''),
  avatar: text(),
  level: integer().notNull().default(1),
  followers: integer().notNull().default(0),
  following: integer().notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const sessions = pgTable('sessions', {
  token: text().primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: ms('expires_at').notNull(),
}, (t) => [index('idx_sessions_user').on(t.userId)]);

export const resetTokens = pgTable('reset_tokens', {
  tokenHash: text('token_hash').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: ms('expires_at').notNull(),
});

export const trails = pgTable('trails', {
  id: serial().primaryKey(),
  slug: text().notNull().unique(),
  name: text().notNull(),
  location: text().notNull(),
  difficulty: text().notNull(),
  distanceKm: doublePrecision('distance_km').notNull(),
  elevationM: integer('elevation_m').notNull(),
  durationH: doublePrecision('duration_h').notNull(),
  tags: text().notNull().default(''),
  description: text().notNull().default(''),
  featured: integer().notNull().default(0),
  popularity: integer().notNull().default(0),
  image: text(),
  weather: text().notNull().default('{}'),
  weatherUpdated: ms('weather_updated').notNull().default(0),
  ownerId: integer('owner_id').references(() => users.id, { onDelete: 'set null' }),
  shared: integer().notNull().default(1),
  isNew: integer('is_new').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [check('trails_difficulty_check', sql`${t.difficulty} IN ('Easy','Moderate','Hard')`)]);

export const savedTrails = pgTable('saved_trails', {
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  trailId: integer('trail_id').notNull().references(() => trails.id, { onDelete: 'cascade' }),
  savedAt: timestamp('saved_at').notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.userId, t.trailId] })]);

export const places = pgTable('places', {
  id: serial().primaryKey(),
  trailId: integer('trail_id').notNull().references(() => trails.id, { onDelete: 'cascade' }),
  kind: text().notNull(),
  name: text().notNull(),
  distanceKm: doublePrecision('distance_km').notNull(),
  rating: doublePrecision().notNull(),
  reviews: integer().notNull(),
  price: integer(),
  amenities: text().notNull().default(''),
  roomsTotal: integer('rooms_total').notNull().default(0),
  image: text(),
  cuisine: text(),
  priceLevel: text('price_level'),
  slots: text().notNull().default(''),
  hours: text(),
  notes: text(),
}, (t) => [
  index('idx_places_trail').on(t.trailId, t.kind),
  check('places_kind_check', sql`${t.kind} IN ('hotel','restaurant','church')`),
]);

export const bookings = pgTable('bookings', {
  id: serial().primaryKey(),
  userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }),
  placeId: integer('place_id').notNull().references(() => places.id, { onDelete: 'cascade' }),
  kind: text().notNull(),
  startDate: text('start_date').notNull(),
  endDate: text('end_date'),
  timeSlot: text('time_slot'),
  guests: integer().notNull(),
  rooms: integer().notNull().default(1),
  total: integer().notNull().default(0),
  status: text().notNull().default('confirmed'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  index('idx_bookings_place').on(t.placeId, t.startDate, t.endDate),
  check('bookings_kind_check', sql`${t.kind} IN ('hotel','restaurant')`),
]);

export const groups = pgTable('groups_', {
  id: serial().primaryKey(),
  name: text().notNull(),
  trailId: integer('trail_id').notNull().references(() => trails.id, { onDelete: 'cascade' }),
  hostId: integer('host_id').notNull().references(() => users.id),
  startsAt: text('starts_at').notNull(),
  meetingPoint: text('meeting_point').notNull(),
  capacity: integer().notNull(),
}, (t) => [check('groups_capacity_check', sql`${t.capacity} > 0`)]);

export const groupMembers = pgTable('group_members', {
  groupId: integer('group_id').notNull().references(() => groups.id, { onDelete: 'cascade' }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  joinedAt: timestamp('joined_at').notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.groupId, t.userId] })]);

export const messages = pgTable('messages', {
  id: serial().primaryKey(),
  groupId: integer('group_id').notNull().references(() => groups.id, { onDelete: 'cascade' }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  body: text().notNull(),
  createdAt: ms('created_at').notNull(),
}, (t) => [index('idx_messages_group').on(t.groupId, t.id)]);

export const posts = pgTable('posts', {
  id: serial().primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  groupId: integer('group_id').references(() => groups.id, { onDelete: 'set null' }),
  body: text().notNull(),
  image: text(),
  likes: integer().notNull().default(0),
  comments: integer().notNull().default(0),
  createdAt: ms('created_at').notNull(),
});

export const postLikes = pgTable('post_likes', {
  postId: integer('post_id').notNull().references(() => posts.id, { onDelete: 'cascade' }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
}, (t) => [primaryKey({ columns: [t.postId, t.userId] })]);

export const hikes = pgTable('hikes', {
  id: serial().primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  trailId: integer('trail_id').references(() => trails.id, { onDelete: 'set null' }),
  name: text().notNull(),
  distanceKm: doublePrecision('distance_km').notNull(),
  elevationM: integer('elevation_m').notNull(),
  durationS: integer('duration_s').notNull(),
  completedAt: ms('completed_at').notNull(),
});

export const challengeProgress = pgTable('challenge_progress', {
  userId: integer('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  trailsDone: integer('trails_done').notNull().default(0),
});

// Request counters for rate limiting (functions are stateless, so these live in the database).
export const rateHits = pgTable('rate_hits', {
  id: serial().primaryKey(),
  key: text().notNull(),
  at: ms('at').notNull(),
}, (t) => [index('idx_rate_hits_key').on(t.key, t.at)]);
