# Configuration

All settings are environment variables. Copy `.env.example` as a reference; the app does not read `.env` files itself, so set them in your host's dashboard (or `export` them / use `docker run -e`).

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | Port to listen on |
| `NODE_ENV` | (unset) | Set `production` online: Secure cookies, no default demo password |
| `DATA_DIR` | `./data` | Folder holding `declination.db`. Must be on a persistent disk/volume in production |
| `APP_URL` | (unset) | Public URL, used in password-reset links |
| `DEMO_PASSWORD` | `wyoming1230` locally, random in production | Password of `anna@declination.app`. Remove it to lock the demo account |
| `TRUST_PROXY` | on in production | Needed behind Render/Railway/Fly/nginx |
| `RESEND_API_KEY`, `MAIL_FROM` | (unset) | Optional. Without them reset links are only printed to the server log |

## Known placeholders
- Google sign-in is not wired up (needs a Google OAuth client).
- Terms and Privacy pages are placeholder text; have them reviewed before launch.
- Back up `declination.db` regularly.
