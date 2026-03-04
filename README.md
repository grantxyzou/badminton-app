# Badminton Sign-Up App

> Next.js 14 · Tailwind CSS · Azure Cosmos DB · Anthropic Claude AI · Azure Static Web Apps

```
badminton-app/
├── app/
│   ├── api/
│   │   ├── admin/route.ts          POST  – PIN verification
│   │   ├── announcements/route.ts  GET / POST
│   │   ├── claude/route.ts         POST  – AI proxy (claude-sonnet-4-20250514)
│   │   ├── players/route.ts        GET / POST / DELETE
│   │   └── session/route.ts        GET / PUT
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx                    Tab router
├── components/
│   ├── AdminTab.tsx
│   ├── BottomNav.tsx
│   ├── HomeTab.tsx
│   ├── PlayersTab.tsx
│   └── TeamsTab.tsx
├── lib/
│   ├── cosmos.ts                   Cosmos DB client + helpers
│   └── types.ts                    Shared TypeScript interfaces
├── .env.local                      Local secrets (never commit)
├── .env.local.example              Key template
├── .github/workflows/
│   └── azure-static-web-apps.yml  CI/CD
├── staticwebapp.config.json
└── README.md
```

---

## Environment Variables

| Variable | Description | Example |
|---|---|---|
| `ANTHROPIC_API_KEY` | Anthropic API key | `sk-ant-...` |
| `COSMOS_CONNECTION_STRING` | Azure Cosmos DB connection string | `AccountEndpoint=...` |
| `COSMOS_DB_NAME` | Cosmos database name | `badminton` |
| `ADMIN_PIN` | PIN to access the Admin tab | `1234` |
| `NEXT_PUBLIC_MAX_PLAYERS` | Max sign-ups per session | `12` |

Copy `.env.local.example` to `.env.local` and fill in the values.

---

## Local Development

```bash
# 1. Install dependencies
npm install

# 2. Add your secrets
cp .env.local.example .env.local
# Edit .env.local with your actual values

# 3. Run the dev server
npm run dev
# → http://localhost:3000
```

The app works without a Cosmos DB connection during development — all API routes return safe fallback data (empty arrays / default session info).

---

## Azure Cosmos DB Setup (Azure Portal GUI)

### 1. Create a Cosmos DB Account
1. Go to **portal.azure.com** → **Create a resource** → search **Azure Cosmos DB**
2. Choose **Azure Cosmos DB for NoSQL** → **Create**
3. Fill in:
   - **Resource Group**: create new or use existing
   - **Account Name**: e.g. `badminton-db`
   - **Region**: choose closest to your users
4. Leave defaults for Capacity mode (**Serverless** is cheapest for low traffic) → **Review + Create**

### 2. Create the Database
1. Open your Cosmos DB account → **Data Explorer** → **New Database**
2. **Database id**: `badminton`
3. Click **OK**

### 3. Create the Three Containers

Repeat for each container:

| Container id | Partition key |
|---|---|
| `sessions` | `/id` |
| `players` | `/sessionId` |
| `announcements` | `/sessionId` |

Steps per container:
1. In Data Explorer → select database `badminton` → **New Container**
2. Set **Container id** and **Partition key** from the table above
3. Click **OK**

### 4. Get the Connection String
1. Cosmos DB account → **Keys** (left sidebar)
2. Copy **PRIMARY CONNECTION STRING**
3. Paste it as `COSMOS_CONNECTION_STRING` in `.env.local` and in Azure Static Web Apps settings

---

## Azure Static Web Apps Setup (Azure Portal GUI)

### 1. Push Code to GitHub
Make sure your code is in a GitHub repository with a `main` branch.

### 2. Create the Static Web App
1. **portal.azure.com** → **Create a resource** → search **Static Web App** → **Create**
2. Fill in:
   - **Resource Group**: same as Cosmos DB
   - **Name**: e.g. `badminton-app`
   - **Plan type**: Free
   - **Region**: closest to users
   - **Deployment source**: GitHub
3. Click **Sign in with GitHub** → authorise → select your **Organisation**, **Repository**, and **Branch** (`main`)
4. **Build Details**:
   - **Build Preset**: Next.js
   - **App location**: `/`
   - **Output location**: `.next`
5. **Review + Create** → **Create**

Azure will add a GitHub Actions workflow file to your repo automatically. You can delete it and use the one already in `.github/workflows/`.

### 3. Add Environment Variables
1. Open the Static Web App → **Configuration** (left sidebar)
2. Under **Application settings**, click **+ Add** for each variable:

| Name | Value |
|---|---|
| `ANTHROPIC_API_KEY` | your Anthropic key |
| `COSMOS_CONNECTION_STRING` | your Cosmos connection string |
| `COSMOS_DB_NAME` | `badminton` |
| `ADMIN_PIN` | your chosen PIN |
| `NEXT_PUBLIC_MAX_PLAYERS` | `12` |

3. Click **Save**

### 4. Get the Deploy Token (for GitHub Actions)
1. Static Web App → **Overview** → **Manage deployment token**
2. Copy the token
3. In GitHub → your repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**
   - Name: `AZURE_STATIC_WEB_APPS_API_TOKEN`
   - Value: paste the token
4. Push to `main` — the GitHub Action will build and deploy automatically

---

## Features

| Tab | What it does |
|---|---|
| **Home** | Session info, announcements, sign-up / cancel |
| **Players** | Numbered list grouped into GAME courts, skill colour labels |
| **Teams** | AI-generated balanced doubles teams via Claude |
| **Admin** | PIN-gated session editor + AI-polished announcement composer |
