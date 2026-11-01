# Hosting the backend online (GitHub + Render, optional Vercel for the web app)

Read this if you want a public URL for the API so that logins work without `localhost`.

## Why the Vercel deployment showed 404

A correct build of this project takes much longer than 2 seconds. A Vercel deployment that is "Ready" after 2 seconds and shows
`404 NOT_FOUND` built nothing: it published an empty site. Two further reasons Vercel is the wrong place for **this** backend:

- The API is a normal, always-on Node server (`apps/api/src/bin/server.ts` calls `listen()`). Vercel runs short-lived serverless
  functions, not a server process, so it would need code changes (a handler export) and connection-pool workarounds for PostgreSQL.
- Vercel does not host PostgreSQL, which this project requires.

Use **Render** (a web service plus a PostgreSQL database in one dashboard, deploys straight from GitHub). Railway is a close
alternative with the same steps. Keep **Vercel for the web app only**, if you want it there.

Note: opening the API's base address (`https://your-service.onrender.com/`) shows `404 No route: GET /` **by design**. The API has
no home page. Check `https://your-service.onrender.com/api/health`, which must show `{"status":"ok",...}`.

## 1. What to put on GitHub (and why `apps` was rejected)

Upload the **whole project exactly as it is in the ZIP** (about 2 MB), and nothing else. The backend is not only `apps/api`: it
imports `packages/shared`, `packages/validation` and `packages/database`, so those must be uploaded too.

Required for the backend:

```
package.json  pnpm-lock.yaml  pnpm-workspace.yaml  tsconfig.base.json  .npmrc  .nvmrc  .env.example  .gitignore  .gitattributes
apps/api/            (everything inside)
packages/shared/     (everything inside)
packages/validation/ (everything inside)
packages/database/   (everything inside, including prisma/schema.prisma, prisma/migrations/, prisma.config.ts)
```

Not needed by the backend but safe to keep in the repository: `apps/web`, `apps/desktop`, `e2e`, `docs`, `scripts`, `README.md`.
(The commands below install only what the API needs, so Electron and the web tooling are never downloaded on the server.)

**Never upload:** `node_modules`, `dist`, `release`, `packages/database/src/generated`, any `.env` file. These are the folders that
make `apps` too large: `node_modules` is about 1 GB here and Electron's program alone is over 100 MB, and GitHub refuses files over
100 MB. They are re-created by the build and are already listed in `.gitignore`.

Upload with Git (it honours `.gitignore`), **not** by dragging folders into the GitHub web page. In Command Prompt, in the project
folder you extracted from the ZIP (do not run `pnpm install` first):

```
git init
git add .
git status
git commit -m "MAFK POS"
git branch -M main
git remote add origin https://github.com/YOUR-NAME/YOUR-REPO.git
git push -u origin main
```

Look at `git status` before committing: no path may contain `node_modules`, `dist` or `release`. Make the repository **private**.
If you already pushed or committed those folders, the simplest fix is to delete the repository, create a new empty one, and repeat
the steps above from a fresh extraction of the ZIP.

The repository now contains `vercel.json`, `api/index.js` and `public/index.html`. They are used only by the Vercel option
("Alternative: API on Vercel" below) and are ignored by Render.

## 2. Create the database (Render)

New > PostgreSQL. Pick the region closest to you and use the **same region** for the web service below. When it is ready, copy:

- **Internal Database URL** (for the web service)
- **External Database URL** (only for the one-time setup from your PC)

## 3. Create the web service (Render)

New > Web Service > connect the GitHub repository, then:

| Field              | Value                                                                                                                                         |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Root Directory     | leave **empty** (the repository root)                                                                                                         |
| Language / Runtime | Node                                                                                                                                          |
| Build Command      | `npx -y pnpm@10.34.5 install --frozen-lockfile --prod=false --filter "@mafk/api..." && npx -y pnpm@10.34.5 --filter "@mafk/api..." run build` |
| Start Command      | `node apps/api/dist/bin/server.js`                                                                                                            |
| Health Check Path  | `/api/health`                                                                                                                                 |

Environment variables:

| Name           | Value                                                                                                                         |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `NODE_VERSION` | `22`                                                                                                                          |
| `NODE_ENV`     | `production`                                                                                                                  |
| `DATABASE_URL` | the **Internal** Database URL                                                                                                 |
| `JWT_SECRET`   | a new random value: run `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` and paste the result |
| `CLIENT_URL`   | the address(es) of your web app, comma separated, for example `https://your-app.vercel.app` (no trailing slash)               |
| `TRUST_PROXY`  | `1` (use `2` if the browser reaches the API through the Vercel rewrite in section 5)                                          |

Do not set `PORT` (Render supplies it; the API reads it). Do **not** put `MASTER_ADMIN_*` here. The API refuses to start in
production with the example secrets from `.env.example`; if it fails at boot, the log names the missing or invalid variable.

`--prod=false` is required because the build needs TypeScript and the Prisma tools, which are development dependencies, and hosts
set `NODE_ENV=production` during the build.

## 4. One-time database setup from your PC

The tables, permissions and the first Master Admin must exist before anyone can log in. Run this **once** on your Windows PC
(Command Prompt, in the project folder, after `pnpm install`), using the **External** Database URL and adding `?sslmode=require`
at the end:

```
set "DATABASE_URL=<paste the External Database URL here>?sslmode=require"
pnpm db:generate
pnpm db:migrate:deploy
pnpm db:seed
set "MASTER_ADMIN_LOGIN_ID=owner.admin"
set "MASTER_ADMIN_PASSWORD=choose-a-long-unique-password"
pnpm bootstrap:master
```

Then close that Command Prompt window so the variables disappear. Never use `migrate reset` or anything that drops data on this
database. Choose a new password; do not reuse one from development.

## 5. Check it, then connect the web app

1. Open `https://YOUR-SERVICE.onrender.com/api/health`. It must show `"status":"ok"`.
2. Test a login (Command Prompt, `curl.exe` ships with Windows 10 and later):

```
curl.exe -X POST https://YOUR-SERVICE.onrender.com/api/auth/login -H "Content-Type: application/json" -d "{\"loginId\":\"owner.admin\",\"password\":\"YOUR-PASSWORD\"}"
```

A reply starting `{"accessToken":` means the backend is live. This used the same production start path that was tested.

**Web app (optional, on Vercel).** The web app is a separate project. In Vercel: Add New Project > the same repository, then:

| Field            | Value                                                                                                 |
| ---------------- | ----------------------------------------------------------------------------------------------------- |
| Root Directory   | leave empty                                                                                           |
| Framework Preset | Other                                                                                                 |
| Install Command  | `pnpm install --frozen-lockfile --prod=false --filter "@mafk/web..."`                                 |
| Build Command    | `pnpm --filter @mafk/shared --filter @mafk/validation run build && pnpm --filter @mafk/web run build` |
| Output Directory | `apps/web/dist`                                                                                       |
| Env variable     | `VITE_API_URL` = `/api`                                                                               |

and add a `vercel.json` at the repository root (replace the address with your Render service):

```json
{
  "rewrites": [
    { "source": "/api/:path*", "destination": "https://YOUR-SERVICE.onrender.com/api/:path*" },
    { "source": "/((?!api/).*)", "destination": "/index.html" }
  ]
}
```

Why the rewrite: the login uses a refresh cookie with `SameSite=Lax`. If the browser page (`*.vercel.app`) called the API on another
site (`*.onrender.com`) directly, the browser would not send that cookie and people would be signed out when the 15-minute access token
expires. With the rewrite the browser only talks to the Vercel address, so the cookie works. Without `VITE_API_URL` the web app
calls `http://localhost:4000` and nothing works online. Set `CLIENT_URL` on Render to the Vercel address.

## Alternative: API on Vercel (no card needed)

The API has a serverless entry (`apps/api/src/vercel.ts`, exposed through `api/index.js`), so it can run on Vercel. Vercel has no
PostgreSQL of its own: create a free database first (Vercel dashboard > Storage / Marketplace > Neon, or neon.tech) and copy its
connection string (it already ends with `?sslmode=require`).

Vercel > Add New Project > the repository, then:

| Field            | Value                                                                 |
| ---------------- | --------------------------------------------------------------------- |
| Root Directory   | leave empty                                                           |
| Framework Preset | **Other** (not Vite)                                                  |
| Install Command  | `pnpm install --frozen-lockfile --prod=false --filter "@mafk/api..."` |
| Build Command    | `pnpm --filter "@mafk/api..." run build`                              |
| Output Directory | `public`                                                              |

(These are also set in `vercel.json`; if the dashboard fields are greyed out or show "Override" off, that is fine.) Do **not** use the
root `pnpm run build`: it also builds the web and desktop apps and fails on a backend-only install.

Environment variables (Project Settings > Environment Variables): `NODE_ENV=production`, `DATABASE_URL` (the Neon string),
`JWT_SECRET` (random, 32+ characters, see step 3), `CLIENT_URL` (your web address, or any `https://` address if you only use the API
for now), `TRUST_PROXY=1`. Run the one-time database setup from step 4 with the same `DATABASE_URL`. Then open
`https://YOUR-PROJECT.vercel.app/api/health` and test the login as in step 5.

If the build fails, open the deployment > Build Logs and use "Find in logs" for `error`; send me that line.

## What was verified, and what was not

Verified in the build sandbox with a clean copy of the project: the backend-only install with `--prod=false` while
`NODE_ENV=production`, the build, running `node apps/api/dist/bin/server.js` in production mode against PostgreSQL, a successful
login (refresh cookie `HttpOnly; Secure; SameSite=Lax`), `/api/health`, `GET /` returning the 404 above, CORS allowing only the
listed origin, `sslmode=require` accepted by the database driver, and the web build with `VITE_API_URL=/api`.

Also verified: the Vercel entry (`api/index.js`) called as a plain Node request handler in production mode against PostgreSQL: login
returned 200 with the refresh cookie, a wrong password returned 401. `TRUST_PROXY` was read from the environment but never applied;
it is now applied (test added; API suite 290 passed).

**NOT VERIFIED:** the Vercel build and function bundling (the Vercel CLI is not available here: whether Vercel includes the workspace
packages, the Prisma client and the argon2 binary in the function, and whether the rewrite keeps the original `/api/...` path),
anything on Render or Vercel themselves (field names, plan limits, the Vercel rewrite and cookie flow, `NODE_VERSION`
handling), the official Prisma engine download and `db:migrate:deploy` (blocked in the sandbox; step 4 is the first real run), and
`npx pnpm` behaviour on the host. If a step fails, send me the exact error text from the Render or Vercel build log.

Free plans: services may sleep when idle and free databases may be time-limited or deleted. Check the host's current pricing page
before putting real shop data on a free plan, and set up backups (`DEPLOYMENT.md`).
