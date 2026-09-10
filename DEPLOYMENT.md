# Production Deployment

The root `docker-compose.yml` runs the frontend, API, PostgreSQL, and Redis as
one production stack. The frontend is served by Nginx and proxies `/api/` to
the API container, so the browser only needs the public frontend URL.

## Required environment

Copy `.env.example` to `.env` and replace every `replace-with-*` value with a
strong, deployment-managed secret. Do not commit `.env`.

- `POSTGRES_PASSWORD`: database password. If it contains URL-reserved
  characters, URL-encode it in `DATABASE_URL` or use a secret without those
  characters.
- `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `PASSWORD_RESET_SECRET`: at least
  16 random characters each, and all different.
- `POSTGRES_USER`, `POSTGRES_DB`: optional database names; defaults are shown in
  `.env.example`.
- `FRONTEND_URL`: public origin allowed by the API CORS policy.
- `FRONTEND_PORT`: host port for Nginx; defaults to `8080`.
- `VITE_API_URL`: frontend API base path; keep `/api/v1` when using the bundled
  Nginx proxy.
- `TRUST_PROXY_HOPS`: number of trusted reverse proxies, normally `1` behind a
  single load balancer.
- `LOG_LEVEL`: Pino level such as `info`, `warn`, or `error`.
- `BACKUP_DIR`: private directory for SQL backups; defaults to `./backups` in
  the API container. Mount this to durable, access-controlled storage in
  production.
- `UPLOAD_DIR`: private directory for lab and ultrasound files; defaults to
  `./uploads` in the API container. Never mount it into Nginx or a public web
  directory.

In a cloud deployment, inject these values from the platform secret manager
instead of storing them in a shell history or image layer.

## Deploy and start

From the repository root:

```bash
cp .env.example .env
# edit .env with real values
docker compose up --build -d
docker compose ps
curl http://localhost:8080/health
```

The public application is available at `http://localhost:8080` in this example.
Put TLS termination, a WAF, and any public DNS in front of Nginx for internet
deployment. PostgreSQL, Redis, and the API are internal compose services and
are not published to the host.

For HTTPS, terminate TLS at an external Nginx, Caddy, or load balancer, redirect
HTTP to HTTPS, and proxy the frontend plus `/api/` to the frontend container.
Set `FRONTEND_URL` to the exact `https://` origin and `TRUST_PROXY_HOPS` to the
number of trusted proxies. Do not expose port 4000, PostgreSQL, or Redis.

## Database migrations

The API container runs `npm run prisma:deploy` before starting Node. This is
Prisma's production migration command: it applies committed migrations in
order and does not create or modify migration files. Compose waits for a healthy
PostgreSQL container before starting the API.

There are no manual schema steps. A schema change must be developed and tested
as a committed Prisma migration, then deployed with the image. Migrations must
be backward-compatible with the currently running image when rolling updates
are possible: add new fields before using them, backfill separately, and remove
old fields only after all old images are gone. Take a verified database backup
before destructive migrations. A failed migration prevents the API process
from becoming healthy, making the deployment fail visibly instead of serving
against a partially updated schema.

Prisma migrations do not have automatic down migrations. Before a risky release,
take and verify a backup. If a migration fails, keep the API image offline,
deploy the previous image if needed, then restore the verified backup during a
maintenance window. For additive changes, fix forward with a new migration;
validate health and data before reopening traffic.

## Database backups

Only an `ADMIN` can list, create, download, delete, or restore backups. The API
runs `pg_dump` on the server and stores private plain SQL files named
`careplus-backup-YYYY-MM-DD-HHmmss.sql`. Restore requires the admin password
again, creates a safety backup first, and blocks other API requests while the
database is restored. Plan disk space for at least one full database copy plus
a safety copy, with headroom for growth.

Keep `BACKUP_DIR` outside public/static folders. If the application is down,
restore directly with PostgreSQL tools:

```bash
psql "$DATABASE_URL" --set ON_ERROR_STOP=1 --single-transaction \
  --file backups/careplus-backup-YYYY-MM-DD-HHmmss.sql
```

Do not put the database password in shell history; use `PGPASSWORD` from a
protected environment or a `.pgpass` file.

Named Docker volumes are not off-host copies. Schedule a host job to copy them
to encrypted, access-controlled storage, for example:
`docker run --rm -v careplus_backups:/src -v /srv/offsite:/dst alpine sh -c
'cp -a /src/. /dst/'`. Regularly test restoring a copied backup.

## Logging and privacy

Production logs are newline-delimited structured JSON from Pino. Set
`LOG_LEVEL` to control verbosity. HTTP logs contain the method, path, status,
duration, and request ID; query strings and request bodies are deliberately
excluded because they can contain patient searches, identifiers, or clinical
data. Authorization, cookies, passwords, reset tokens, refresh tokens, and
response cookies are redacted as defense in depth. Application errors return a
generic message in production and log only a request ID, status/code, and error
name. Never add payloads, tokens, or PHI to log statements, and restrict log
storage/access according to the hospital's retention policy.

## Monitoring and alerting

The API exposes `GET /health`, which returns HTTP 200 only when PostgreSQL is
reachable. The API and frontend images also have Docker health checks. Configure
an external uptime monitor to check the public frontend and `/health` every
minute, alerting after three consecutive failures. Because API request logs
are JSON and include status codes, ship them to the platform log service and
create an alert for sustained 5xx responses (for example, more than 5% over a
five-minute window), container restarts, and database/Redis connection errors.

For a larger deployment, add a metrics collector such as OpenTelemetry or
Prometheus at the ingress layer and track request count, latency percentiles,
5xx rate, database pool saturation, and migration failures. Keep metrics
cardinality free of patient IDs, names, emails, or other PHI.

## Stop and inspect

```bash
docker compose logs --since=10m api
docker compose ps
docker compose down
```

`docker compose down` preserves PostgreSQL data in the named volume. Do not use
`docker compose down -v` in production unless the database volume is known to
be disposable.