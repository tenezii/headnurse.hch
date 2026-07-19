# Nurse & Bed Management — production version (Supabase-backed)

This is a real, working product: live shared data across every device, real email/password
authentication, and role permissions enforced inside the database itself (Row-Level Security) —
not just hidden in the UI.

## What you get
- **Real accounts.** Nurses and the Head Nurse sign up with their own email + password (handled by Supabase Auth — passwords are never seen by this app's own code).
- **One shared department board.** Every device that signs in and joins the same department sees the same live bed map, patients, and workload — updates push instantly (Supabase Realtime).
- **Enforced roles.** A nurse's database queries are restricted to their own assigned patients by PostgreSQL policies. Even a bug in the frontend code can't leak another nurse's patient list.
- **Audit trail.** Every admission, discharge, and reassignment is logged with who did it and when.

## One-time setup (about 15 minutes)

### 1. Create a free Supabase project
Go to [supabase.com](https://supabase.com), sign up, and create a new project. Pick a region close to your hospital if data residency matters to you — confirm this against your compliance requirements.

### 2. Run the database setup
In your Supabase project, open **SQL Editor** and run these two files **in order**:
1. `sql/schema.sql` — creates all the tables.
2. `sql/policies.sql` — sets up the security rules and the functions the app calls (admit, discharge, reassign, join department, etc).

### 3. Get your project's API keys
In Supabase, go to **Project Settings → API**. Copy:
- **Project URL**
- **anon public key**

### 4. Configure the app
```bash
cp .env.example .env
```
Paste your Project URL and anon key into `.env`.

### 5. Run it
```bash
npm install
npm run dev
```
Open the printed URL. Create an account — you'll be asked whether you're setting up a new department (becomes Head Nurse) or joining one with a code (becomes a Nurse). The Head Nurse finds the join code in the **Settings** tab to share with their team.

## Deploying so anyone can reach it
Same as before — Vercel or Netlify, for free:

**Vercel:**
```bash
npx vercel
```
When it asks, add the same two environment variables (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) in the Vercel project settings so the deployed build can reach your Supabase project.

**Netlify:** run `npm run build`, then drag the `dist/` folder onto [app.netlify.com/drop](https://app.netlify.com/drop) — and add the same two environment variables under Site settings → Environment variables, then redeploy so they take effect.

## Honest limits of this version
- **Email confirmation:** by default, Supabase may require confirming a new account by email before sign-in works. You can turn this off in Supabase → Authentication → Providers → Email if you want instant sign-in during testing (turn it back on before real use).
- **Password reset / invite emails:** not wired up yet in this app's UI — Supabase supports both, this is a good next feature to add.
- **Single Head Nurse per department** in this version — promoting a second admin isn't built yet.
- **Compliance sign-off:** real patient data still needs your hospital's IT/compliance team to confirm hosting region, retention policy, and any local regulatory requirements (Saudi PDPL / MOH) before go-live. This app gives you the technical controls (real auth, RLS, audit log) — the organizational sign-off is a separate step.
