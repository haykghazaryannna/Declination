'use strict';
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const dir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(dir, { recursive: true });
const file = process.env.DB_FILE || path.join(dir, 'declination.db');
const db = new DatabaseSync(file);

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  surname TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  handle TEXT NOT NULL UNIQUE,
  pass_salt TEXT, pass_hash TEXT,
  bio TEXT NOT NULL DEFAULT '',
  avatar TEXT,
  level INTEGER NOT NULL DEFAULT 1,
  followers INTEGER NOT NULL DEFAULT 0,
  following INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS reset_tokens (
  token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS trails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL, location TEXT NOT NULL,
  difficulty TEXT NOT NULL CHECK (difficulty IN ('Easy','Moderate','Hard')),
  distance_km REAL NOT NULL, elevation_m INTEGER NOT NULL, duration_h REAL NOT NULL,
  tags TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '',
  featured INTEGER NOT NULL DEFAULT 0, popularity INTEGER NOT NULL DEFAULT 0,
  image TEXT,
  weather TEXT NOT NULL DEFAULT '{}',
  weather_updated INTEGER NOT NULL DEFAULT 0,
  owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  shared INTEGER NOT NULL DEFAULT 1,
  is_new INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS saved_trails (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  trail_id INTEGER NOT NULL REFERENCES trails(id) ON DELETE CASCADE,
  saved_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, trail_id)
);
CREATE TABLE IF NOT EXISTS places (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trail_id INTEGER NOT NULL REFERENCES trails(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('hotel','restaurant','church')),
  name TEXT NOT NULL, distance_km REAL NOT NULL,
  rating REAL NOT NULL, reviews INTEGER NOT NULL,
  price INTEGER, amenities TEXT NOT NULL DEFAULT '',
  rooms_total INTEGER NOT NULL DEFAULT 0,
  image TEXT,
  cuisine TEXT, price_level TEXT, slots TEXT NOT NULL DEFAULT '',
  hours TEXT, notes TEXT
);
CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  place_id INTEGER NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('hotel','restaurant')),
  start_date TEXT NOT NULL, end_date TEXT, time_slot TEXT,
  guests INTEGER NOT NULL, rooms INTEGER NOT NULL DEFAULT 1,
  total INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'confirmed',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS groups_ (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, trail_id INTEGER NOT NULL REFERENCES trails(id) ON DELETE CASCADE,
  host_id INTEGER NOT NULL REFERENCES users(id),
  starts_at TEXT NOT NULL, meeting_point TEXT NOT NULL,
  capacity INTEGER NOT NULL CHECK (capacity > 0)
);
CREATE TABLE IF NOT EXISTS group_members (
  group_id INTEGER NOT NULL REFERENCES groups_(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (group_id, user_id)
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES groups_(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id INTEGER REFERENCES groups_(id) ON DELETE SET NULL,
  body TEXT NOT NULL, image TEXT, likes INTEGER NOT NULL DEFAULT 0, comments INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS post_likes (
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, user_id)
);
CREATE TABLE IF NOT EXISTS hikes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  trail_id INTEGER REFERENCES trails(id) ON DELETE SET NULL,
  name TEXT NOT NULL, distance_km REAL NOT NULL, elevation_m INTEGER NOT NULL,
  duration_s INTEGER NOT NULL, completed_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS challenge_progress (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  trails_done INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_places_trail ON places(trail_id, kind);
CREATE INDEX IF NOT EXISTS idx_bookings_place ON bookings(place_id, start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_messages_group ON messages(group_id, id);
`);

// Migrate databases created before photos existed.
for (const [t, col] of [['trails', 'image'], ['places', 'image'], ['posts', 'image'], ['users', 'avatar']]) {
  if (!db.prepare(`PRAGMA table_info(${t})`).all().some((c) => c.name === col)) db.exec(`ALTER TABLE ${t} ADD COLUMN ${col} TEXT`);
}

module.exports = db;
