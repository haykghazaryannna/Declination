# Declination

Hiking community app: trails, weather, group hikes + chat, stays/tables booking, trail recording, profiles.

- **Zero dependencies**: no `npm install`, no CDN. Fonts, images and code are all in this repo.
- **Requires Node 22.5+** (uses the built-in `node:sqlite`).

## Run locally

    npm start            # http://localhost:3000

The database creates and seeds itself on first run (stored in `./data`, git-ignored).
Demo login: `anna@declination.app` / `wyoming1230`

    npm test             # API tests
    npm run seed         # wipe and re-seed the database

## Project layout

    src/
      server.js          HTTP server + API routes + static file serving
      db.js              SQLite connection and schema
      auth.js            password hashing and sessions
      seed.js            demo data (trail/hotel photos are set per row here)
    public/              the front end, served as-is
      index.html  app.js  styles.css
      assets/            photos, logo, backgrounds
      fonts/             self-hosted Inter (OFL licence included)
    test/test.js         API tests
    docs/
      DEPLOYMENT.md      GitHub + hosting guide
      CONFIGURATION.md   environment variables and notes
    .github/workflows/ci.yml   runs tests on every push
    Dockerfile  render.yaml  .env.example

## Hosting

Put the code on GitHub, then run it on a host that supports Node or Docker.
**GitHub Pages cannot run it** (it needs a server and a database). See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
