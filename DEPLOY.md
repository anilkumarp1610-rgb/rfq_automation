# Deployment

## Prerequisites
- Node.js 18+ and npm
- Microsoft SQL Server reachable over TCP, with a database and a login for the app
  (**not** `SA` in production — create a least-privilege user that owns the app schema)

## 1. Configure
```bash
cp apps/api/.env.example apps/api/.env
```
Edit `apps/api/.env`:
- `DATABASE_URL` — point at the production SQL Server / database / app user
- `JWT_SECRET` — a long random string
- `ANTHROPIC_API_KEY` — a real `sk-ant-…` key (or leave the placeholder to run Spec Analysis in mock mode)
- `NODE_ENV=production`
- `WEB_ORIGIN` — the browser origin(s) allowed by CORS, comma-separated (only needed if the SPA is served from a different host)

## 2. Install + migrate + seed
```bash
npm ci
npm run prisma:generate
npm run prisma:migrate      # prisma migrate deploy — applies committed migrations, no prompts
npm run prisma:seed         # roles + admin user + sample masters (idempotent)
```
Default admin: `admin@rfq.local` / `Admin@123` — **change the password after first login.**

## 3. Build the web app
```bash
npm run build               # -> apps/web/dist
```

## 4. Run
Single process — the API serves the built SPA and the JSON API on one port:
```bash
npm start                   # NODE_ENV=production, API + SPA on PORT (default 4000)
```
Put a TLS-terminating reverse proxy (nginx / Caddy) in front. Uploaded drawings are
written to `apps/api/uploads/` — mount a persistent volume there.

Run the API and web separately instead (e.g. static hosting for the SPA) by serving
`apps/web/dist` from any static host and setting `WEB_ORIGIN` on the API.

## 5. Verify
```bash
SMOKE_URL=https://your-host npm run smoke
```
Exercises login, master CRUD, an RFQ through compute + quotation, PDF/XLSX export,
similar-RFQ lookup, and the audit log. Exits non-zero on any failure.

## Notes
- The API runs via `tsx` (TypeScript executed directly) — `npm run build` is a typecheck gate, it does not emit `dist/`.
- Rate limiting: 300 req/min globally, 20 attempts / 15 min on `/auth/*`.
- Roles: `ADMIN` (all), `MANAGER` (+ masters + audit log), `ESTIMATOR` (RFQs/estimates), `VIEWER` (read-only).
- All master/RFQ/quote mutations are written to `audit_log` (viewable at `/audit-log`, ADMIN/MANAGER only).
