# Website Start Guide

Ye file aik complete guide hai jo is project ko start karne ka full method bataati hai.

## 1) Project ka folder open karo

Repository root yeh hai:

- `e:\Download folder\Khalida Hospital full stack`

Yahan par do main parts hain:

- `careplus-backend/`  -> API / server
- `careplus-frontend/` -> React website frontend

---

## 2) Prerequisites

Agar tum local machine par run karna chaho to yeh cheezen honi chahiye:

- Node.js 20+
- npm
- PostgreSQL 16
- Redis 7
- Docker Desktop (optional, agar Docker se run karna ho)

Agar Docker install hai to Postgres aur Redis easy ho jain ge.

---

## 3) Root environment file set karo

Repository root par `.env.example` hai. Isay copy kar ke `.env` banao:

```bash
cd "e:\Download folder\Khalida Hospital full stack"
copy .env.example .env
```

Phir `.env` file ko open karke real values set karo. Example:

```env
POSTGRES_USER=careplus
POSTGRES_PASSWORD=your_secure_password
POSTGRES_DB=careplus
JWT_ACCESS_SECRET=your_long_secret_here
JWT_REFRESH_SECRET=your_long_secret_here
PASSWORD_RESET_SECRET=your_long_secret_here
FRONTEND_URL=http://localhost:8080
FRONTEND_PORT=8080
VITE_API_URL=/api/v1
BACKUP_DIR=./backups
UPLOAD_DIR=./uploads
TRUST_PROXY_HOPS=1
LOG_LEVEL=info
```

> Important: `replace-with-*` values ko real secret se replace karna zaroori hai.

---

## 4) Backend start karna (local method)

### Step A: dependency install

```bash
cd "e:\Download folder\Khalida Hospital full stack\careplus-backend"
npm install
```

### Step B: backend .env create karo

```bash
copy .env.example .env
```

Then `.env` file me yeh values set karo:

```env
NODE_ENV=development
PORT=4000
DATABASE_URL="postgresql://careplus:your_secure_password@localhost:5432/careplus?schema=public"
REDIS_URL="redis://localhost:6379"
JWT_ACCESS_SECRET=your_long_secret_here
JWT_REFRESH_SECRET=your_long_secret_here
PASSWORD_RESET_SECRET=your_long_secret_here
FRONTEND_URL="http://localhost:5173"
LOG_LEVEL=info
```

### Step C: Database aur Redis start karo

Agar Docker se service chalayen:

```bash
docker compose up -d postgres redis
```

Agar tumhara local PostgreSQL aur Redis already running ho to is step ko skip kar sakte ho.

### Step D: Prisma setup

```bash
npx prisma generate
npx prisma migrate dev --name init
npm run prisma:seed
```

Agar migration error ho to DB correct chal rahi hai ya password sahi hai check karo.

### Step E: backend run karo

```bash
npm run dev
```

Backend default host:

- http://localhost:4000
- Swagger docs: http://localhost:4000/api-docs
- Health check: http://localhost:4000/health

---

## 5) Frontend start karna (local method)

### Step A: dependencies install

```bash
cd "e:\Download folder\Khalida Hospital full stack\careplus-frontend"
npm install
```

### Step B: API URL set karo

Front-end default API URL target hai:

```text
http://localhost:4000/api/v1
```

Agar `.env.local` banana ho to is tarah:

```env
VITE_API_URL=http://localhost:4000/api/v1
```

Yeh file agar maujood na ho to app default value use kar leta hai.

### Step C: frontend run karo

```bash
npm run dev
```

Frontend default host:

- http://localhost:5173

---

## 6) Full project ko ek saath start karna

Agar tum full stack ko single command se chalayana chaho to root folder se yeh command run karo:

```bash
cd "e:\Download folder\Khalida Hospital full stack"
docker compose up --build -d
```

Then browser me yeh open karo:

- Frontend: http://localhost:8080

This setup automatically runs:

- PostgreSQL
- Redis
- Backend API
- Frontend Nginx app

---

## 7) Production-style deployment command

Agar production stack run karna ho to root folder se:

```bash
copy .env.example .env
# .env file ko edit karo

docker compose up --build -d
docker compose ps
```

Health check:

```bash
curl http://localhost:8080/health
```

---

## 8) Stop karna

### Docker se stop:

```bash
docker compose down
```

### Local backend/frontend ko stop karne ke liye:

Terminal par `Ctrl + C` press karo.

---

## 9) Seeded login accounts

Database ko seed karne ke baad ye default accounts available hon ge:

| Role | Email | Password |
|---|---|---|
| Admin | admin@careplus.local | Admin@12345 |
| Doctor | dr.ahmed@careplus.local | Doctor@12345 |
| Doctor | dr.fatima@careplus.local | Doctor@12345 |
| Receptionist | reception@careplus.local | Staff@12345 |
| Pharmacist | pharmacist@careplus.local | Staff@12345 |
| Lab Technician | labtech@careplus.local | Staff@12345 |
| Nurse | nurse@careplus.local | Staff@12345 |

---

## 10) Quick command list

### Backend

```bash
cd "e:\Download folder\Khalida Hospital full stack\careplus-backend"
npm install
npx prisma generate
npx prisma migrate dev --name init
npm run prisma:seed
npm run dev
```

### Frontend

```bash
cd "e:\Download folder\Khalida Hospital full stack\careplus-frontend"
npm install
npm run dev
```

### Docker full stack

```bash
cd "e:\Download folder\Khalida Hospital full stack"
docker compose up --build -d
```

---

## 11) Common issues

### Problem: `Prisma generate` fails

```bash
npx prisma generate
```

Network restrictions ya missing binary ki wajah se fail ho sakta hai. Ensure karo ke Node aur internet access sahi ho.

### Problem: database connection failed

Check karo:

- PostgreSQL running hai?
- `.env` me `DATABASE_URL` sahi hai?
- password correct hai?

### Problem: backend not accessible

Check karo:

```bash
curl http://localhost:4000/health
```

### Problem: frontend API call fail ho rahi hai

Check karo `VITE_API_URL` is set to:

```env
VITE_API_URL=http://localhost:4000/api/v1
```

---

## 12) Final summary

Agar tum website ko start karna chaho to sab se simple method yeh hai:

```bash
cd "e:\Download folder\Khalida Hospital full stack\careplus-backend"
npm install
npx prisma generate
npx prisma migrate dev --name init
npm run prisma:seed
npm run dev
```

Dusra terminal:

```bash
cd "e:\Download folder\Khalida Hospital full stack\careplus-frontend"
npm install
npm run dev
```

Ab browser me:

- Frontend: http://localhost:5173
- Backend: http://localhost:4000

Agar Docker se chalo to:

```bash
cd "e:\Download folder\Khalida Hospital full stack"
docker compose up --build -d
```

Open:

- http://localhost:8080

---

Agar chaho to mein aglay step mein is project ke liye ek aur file bana sakta hoon jismein exact Windows PowerShell commands likhe hue hon, taake aap direct copy-paste kar ke run kar saken.
