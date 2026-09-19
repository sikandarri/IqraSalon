# Vercel deployment for Iqra Signature Salon

This archive now includes a Vercel-compatible deployment for the existing **React + Express + MongoDB** version of the salon site.

## What was changed

- Added `api/[...path].mjs` as the Vercel catch-all Node function.
- Added `server/mongo-files.mjs` so uploaded media is stored in MongoDB GridFS instead of Vercel's ephemeral filesystem.
- Added `vercel.json` to build the existing Vite/MERN frontend and route `/admin` to the SPA entry point.
- Kept the existing `lib/salon/api.mjs`, validation, authentication, bookings and content-management logic.
- The frontend continues to call relative URLs such as `/api/content`, so no frontend API URL needs to be hard-coded.

## Vercel project settings

Use the repository/project root containing `package.json` as the Vercel Root Directory.

Vercel will use:

- Build command: `pnpm build:mern`
- Output directory: `dist-mern`
- Node runtime: Vercel Node.js Functions

The `vercel.json` file already contains these settings, so the normal Vercel defaults should work.

## Required environment variables

Add these to **Vercel → Project → Settings → Environment Variables**:

```text
MONGODB_URI=mongodb+srv://USER:PASSWORD@CLUSTER/iqra_signature?retryWrites=true&w=majority
PUBLIC_ORIGIN=https://igra-one-azure.vercel.app
SETUP_TOKEN=<64 lowercase hexadecimal characters>
AUTH_SECRET=<64 lowercase hexadecimal characters>
```

`PUBLIC_ORIGIN` must exactly match the public HTTPS origin. For a custom domain, replace it with the custom domain origin.

Generate the two 64-character secrets with:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Run it once for `SETUP_TOKEN` and once for `AUTH_SECRET`.

Do **not** commit these values to GitHub.

## MongoDB Atlas

The Vercel function must be allowed to connect to your MongoDB Atlas cluster. Configure Atlas network access for the Vercel deployment and use a database user restricted to this application/database.

The application creates these MongoDB collections automatically:

- `salonrecords`
- `salonlimits`
- `salonMedia.files`
- `salonMedia.chunks`

The media files are stored in GridFS, so they survive normal Vercel function restarts and redeployments.

## First admin setup

After deployment, open:

```text
https://igra-one-azure.vercel.app/admin
```

The admin screen will show the setup state. The first account requires the private setup token.

The setup token should be supplied through the setup link generated for the site. Keep that link private. After the first successful setup, the API refuses further account creation.

## Important Vercel upload limitation

Vercel Functions have a request-body limit that is lower than this project's original 12 MB image / 25 MB video limits. The Vercel build therefore blocks uploads above **4 MB per request** in the browser so users receive a clear message instead of an opaque platform 413 error.

The original local/Express deployment limits remain in the server validation code. If you need the full 12/25 MB upload limits on Vercel, the next step is to move browser uploads to direct object storage (for example Vercel Blob or Cloudflare R2) and then save the validated media metadata in MongoDB.

## Local MERN development remains unchanged

You can still use the original local flow:

```bash
pnpm setup:mern
docker compose up -d mongo
pnpm build:mern
pnpm start:mern
```

Local uploads continue to use `UPLOAD_DIR`.
