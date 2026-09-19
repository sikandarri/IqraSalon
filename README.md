# Iqra Signature Salon

Premium responsive salon website in ivory, charcoal, rose metal and gold. Includes a React frontend and a full Node.js/Express/MongoDB backend, plus a separate Sites adapter for the hosted preview.

## Included

Services and prices, offers, FAQs, optional team/reviews; appointment requests with validation, reference numbers and status management; image/video galleries with consent checks; multiple Three.js 360° panorama scenes; secure admin setup/sign-in; add/edit/publish/unpublish/delete content; persistent media uploads; contact/social details; custom Fugi font upload.

No Fugi font file was supplied. The heading stack uses a serif fallback until a licensed Fugi WOFF or WOFF2 file is uploaded in Site settings. Body text uses Manrope with an Arial fallback. Generated hero and interior images are labelled as AI editorial/concept imagery, not actual clients or the real salon.

## Run the MERN application

Requires Node 22.13+ and the pnpm version in package.json.

```bash
pnpm install
pnpm setup:mern
docker compose up -d mongo
pnpm build:mern
pnpm start:mern
```

The setup command creates `.env` with a random private setup key and prints an admin setup URL. Open it after the server starts and choose an admin email/password. Account creation is disabled after the first successful setup. Keep that link private.

The server runs at http://localhost:3000. Use `MONGODB_URI` for an existing MongoDB/Atlas deployment instead of Docker. Express serves the React client and API on one origin. MongoDB stores content, bookings, sessions and file metadata. Files live in `UPLOAD_DIR` and need persistent storage and backups in production.

Set `PUBLIC_ORIGIN` to the exact production HTTPS origin. Keep `HOST=127.0.0.1` when a reverse proxy runs on the same machine. Set `HOST=0.0.0.0` only when your deployment platform requires it, with its firewall configured. `TRUST_PROXY` defaults to `0`; when needed, set exact trusted proxy IPs/CIDRs (for example `127.0.0.1,::1`). Unrestricted hop-count values are rejected. Never commit .env or uploaded client media.

## Hosted preview

The Sites deployment uses the same React components, API business logic and validation, with D1 and R2 for persistence. It does **not** run Express/MongoDB. Sites cannot connect directly to MongoDB's TCP protocol. The standalone MERN server is included for a Node-compatible host with your MongoDB connection.

The hosted runtime needs the `DB` and `BUCKET` logical bindings, `SETUP_TOKEN` and `AUTH_SECRET` secrets, and `PUBLIC_ORIGIN`. Its initial deployment is private to the site owner.

## Set up your real salon

1. Create the admin account using the private setup link.
2. Add your exact address, phone/WhatsApp, hours, social links and licensed Fugi font in Site settings.
3. Set service prices and durations.
4. Upload client photos/videos, confirm permission and publish.
5. Upload a genuine 2:1 equirectangular panorama in 360° tours, for example 6000 × 3000 px. Choose the starting angle and publish. A normal landscape image is not a panorama.
6. Review appointment requests and contact clients to confirm details before changing status.

Images: JPG/PNG/WebP, up to 12 MB. Videos: MP4/WebM, up to 25 MB. Fonts: WOFF/WOFF2, up to 2 MB. Uploads are private until used in published content or public site settings. Files currently referenced by content cannot be deleted from the media library.

Bookings are requests, not automatic reservations. Updating status does not send an email or SMS. No email, SMS or payment provider is connected. Exact contact details, prices, client work, the actual panorama and the Fugi file must be supplied by the owner.

## Validation

`pnpm test` runs 14 API/security scenarios, including real Express HTTP tests, using a temporary SQLite database and file store. `pnpm typecheck` validates TypeScript. After a Sites build, `pnpm test:worker` checks the compiled Worker with isolated D1/R2 storage, page CSP nonces and the hosted authentication/upload paths. The MongoDB adapter needs your MongoDB service for a real connection test. Browser/WebGL and WebMCP runtime checks require a supported browser environment and are separate from the API tests.

## Security hardening

Read `SECURITY-AUDIT.md` for tested controls, dependency findings and the remaining limitations. This is a security review and hardening pass, not a promise of complete protection.

- New passwords require at least 15 characters. Existing password hashes are upgraded on successful sign-in to PBKDF2-SHA256 with 600,000 iterations.
- Sessions use HttpOnly, SameSite=Strict cookies and the Secure `__Host-` prefix on HTTPS. They expire after eight hours or 30 minutes of inactivity. Password and two-step verification changes invalidate other sessions immediately.
- In **Admin → Account → Two-step verification**, enroll an authenticator, confirm a code, then save the eight one-use recovery codes. Enrollment is a personal step the owner must complete. The initial setup link remains single use.
- `AUTH_SECRET` is a stable 64-character random hexadecimal encryption key for authenticator secrets. `pnpm setup:mern` generates it for a new installation or adds it to an older configuration without overwriting existing values. Keep this key, the database and media backups private. Do not rotate it without decrypting and migrating enrolled authenticator secrets or disabling and re-enrolling MFA first.
- The API rejects cross-origin writes, malformed JSON, unsupported methods, spoofed file types, invalid date values and unsigned admin access. Limits apply to login attempts, password checks, bookings and uploads. Uploads allow at most 60 files per hour and 512 MB per day per admin credential version.
- Images are limited to 32 million pixels and 16,384 pixels per side; the panorama ratio is checked on the server. HTML, SVG, archives, scripts and unsupported image formats cannot be uploaded. File inspection is not an antivirus service.
- Only exact published media fields make an uploaded file public. Merely mentioning a URL in a description does not publish it. API and media responses are not cached.
- The hosted worker disables unused image-proxy routes and framework server actions. A nonce-based Content Security Policy protects rendered pages. The standalone Express build uses an external-script-only policy. Inline CSS remains allowed for the component library; inline JavaScript is blocked.

For a public production MERN deployment, use an authenticated MongoDB account restricted to this database, TLS, a network allowlist and persistent private upload storage. Docker Compose is a loopback-only local development database. Use your hosting provider's traffic protection, access monitoring and backup/restore facilities. The source archive contains configuration examples only, never live credentials or customer data.

### Re-run the checks

```bash
pnpm test
pnpm typecheck
pnpm audit
pnpm build:mern
# For the hosted adapter:
pnpm build
pnpm test:worker
```

The security suite exercises real HTTP responses from Express and persistent SQLite storage through the D1 adapter. It does not require or modify the live salon database. A separately supplied MongoDB service is required to exercise the MongoDB adapter against a real server. Do not run attack simulations against your customer database.
