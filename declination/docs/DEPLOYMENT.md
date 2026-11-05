# Hosting Declination from GitHub

Declination is a Node server with a SQLite database, so it **cannot run on GitHub Pages** (static files only). The usual flow: keep the code on GitHub, and connect that repo to a host that runs Node or Docker.

## 1. Put the code on GitHub

    cd declination
    git init
    git add .
    git commit -m "Declination"
    git branch -M main
    git remote add origin https://github.com/<you>/declination.git
    git push -u origin main

`.gitignore` already keeps the database, `.env` and `node_modules` out of the repo. The included CI workflow (`.github/workflows/ci.yml`) runs `npm test` on every push.

## 2. Pick a host

### A. Render (easiest)
1. Dashboard > New > **Blueprint** > select your repo (it reads `render.yaml`).
2. Set `APP_URL` to the URL Render gives you.
3. Deploy. The 1 GB disk at `/var/data` keeps accounts and bookings; it needs a paid instance. Without a disk, data resets on each deploy.

### B. Railway / Fly.io / Google Cloud Run (Docker)
Use the included `Dockerfile`. Mount a persistent volume at `/data` and set `APP_URL`.

### C. Your own server (VPS)
With Docker:

    docker build -t declination .
    docker run -d --name declination --restart unless-stopped \
      -p 3000:3000 -v declination-data:/data \
      -e APP_URL=https://your-domain.com declination

Without Docker (Node 22.5+):

    NODE_ENV=production DATA_DIR=/var/lib/declination APP_URL=https://your-domain.com npm start

Put nginx or Caddy in front for HTTPS (Caddy: `your-domain.com { reverse_proxy localhost:3000 }`).

### D. Quick temporary link from your laptop

    npm start
    npx localtunnel --port 3000

## 3. Before inviting real users
- Use **https only**: in production the session cookie is `Secure`, so plain http will not keep users logged in.
- Set or delete `DEMO_PASSWORD` (demo login `anna@declination.app`).
- For password-reset emails, create a Resend account and set `RESEND_API_KEY` and `MAIL_FROM`.
- Back up `declination.db` (in `DATA_DIR`).
- Replace the placeholder Terms and Privacy text.

See [CONFIGURATION.md](CONFIGURATION.md) for every variable.
