# SAIC Farmer Registry

Cocoa traceability app for SAIC: the farmer and plot registry from manual **SAIC TRC 01**, forms F01 Sheet A (supplier/farmer) and Sheet B (production plot). English and French.

- **Users:** Traceability Lead (everything, including review decisions and team roles) and Warehouse Manager (registers and edits farmers and plots). Anyone else is read only.
- **Rules enforced:** permanent IDs (F0001, F0001 P01) that are never reused, archive instead of delete, a dated change log with old and new values, and review decisions reserved for the Traceability Lead (enforced by the database, not only the screen).
- **Automatic F01 checks:** polygon above 4 ha, 6-decimal GPS points, location inside Cameroon, swapped coordinates, overlaps and duplicates, mapped vs declared area, deforestation review after 31 Dec 2020, evidence gaps, yield plausibility.
- **Installable:** add it to the home screen on a phone, tablet or computer. Without a connection it shows the last loaded registry (read only).

No build step: it is a plain web app (HTML + JavaScript) that any static host can serve.

---

## Setup (about 30 minutes, once)

### 1. Supabase (database, logins, photos)
1. Create a project at supabase.com and pick a European region.
2. Open **SQL Editor → New query**, paste all of `supabase/schema.sql`, click **Run**.
3. **Authentication → Sign In / Providers → Email:** turn **off** "Allow new users to sign up" so only people you add can get in.
4. **Authentication → URL Configuration:** set **Site URL** to the app's address (from step 3 below) so password-reset emails link back to the app.
5. **Authentication → Users → Add user:** create an account for the Traceability Lead and for the Warehouse Manager (email + password).
6. Make the Traceability Lead a lead. In **SQL Editor** run (with the real email):
   ```sql
   update public.profiles set role = 'lead'
   where id = (select id from auth.users where email = 'lead@example.com');
   ```
   After that, the Lead can set everyone else's role from the app's **Team** page (choose "Warehouse Manager" for the warehouse manager).

### 2. Connect the app to Supabase
In **Project Settings → API**, copy the **Project URL** and the **anon / publishable key** into `js/config.js`.
These two values are public by design. **Never** put the `service_role` / secret key or the database password in this project.

### 3. Hosting (Vercel)
1. Put this folder in a GitHub repository.
2. At vercel.com: **Add New → Project → Import** the repository. Framework preset: **Other**. No build command. Deploy.
3. Vercel gives an address like `saic-registry.vercel.app`. Add your own domain (live app: `saicsuite.com`) under Settings > Domains and use it as the Site URL in step 1.4.

### 4. Install on devices
Open the address in Chrome (Android, Windows) or Safari (iPhone, iPad) → **Add to home screen / Install app**.

---

## Demo mode
While `js/config.js` is empty, the app runs in demo mode with three example farmers, saved only in that browser. Useful for showing the app before the database exists. "Reset demo data" is in the bottom-left.

## Files
| Path | What it is |
|---|---|
| `index.html` | Page shell and styles |
| `js/app.js` | Screens, F01 checks, maps, forms, exports. Rule thresholds are at the top. |
| `js/api.js` | Data layer: Supabase, or the demo store |
| `js/i18n.js` | All English and French text |
| `js/config.js` | Supabase URL and public key |
| `supabase/schema.sql` | Tables, roles, permissions, change log, photo storage |
| `sw.js`, `manifest.webmanifest`, `icons/` | Installable app and offline support |

## Operating notes (from the manual)
- **Backups:** the manual asks for daily backups and a monthly test restore. Supabase's free plan has limited backups; use a paid plan with daily backups for production, and record the monthly restore test.
- **Retention:** keep records at least five years after the related delivery. Farmers are archived, never deleted, and the change log cannot be edited from the app.
- **Access:** limit accounts to people who need them; identity and farm data is personal data.

---

# SAIC Trésorerie (`/tresorerie`)

Cash box management for the **Caisse Achat Cacao** (COC) and the **Caisse Administration** (CAD), following the *Manuel des procédures de trésorerie 2026/2027*.

- **Roles** (table `treasury_members`, separate from the registry roles): Accountant (`comptable`) enters transactions and submits fund requests; `daf` approves top-ups and manages roles; `dg` approves exceptional top-ups; `tresorier` records the Afriland transfer; `viewer` reads.
- **Rules enforced by the database:** imported Excel lines can't be changed; transactions are cancelled with a reason, never deleted; a request follows DAF (regular) or DAF then DG (exceptional), then the Treasurer; nobody acts on their own request; a funded request adds the top-up to the cash box; every change is written to `treasury_log`.
- **Supporting documents** are stored in the private `treasury-files` bucket.

## Setup
1. Supabase → SQL Editor → paste all of `supabase/treasury.sql` → Run. It creates the tables and imports the October cocoa and November admin cash books once.
2. Give the first DAF their role (replace the email):
   ```sql
   insert into public.treasury_members (user_id, role)
   select id, 'daf' from auth.users where email = 'daf@example.com'
   on conflict (user_id) do update set role = excluded.role;
   ```
3. The DAF opens `/tresorerie` → **Team** and sets everyone else's role. New people are first added in Authentication → Users.

Ceilings and opening balances are in the `cash_boxes` table (cocoa ceiling 20,000,000 F, admin 500,000 F).

---

# WHP — PDG dashboard (`/pdg`)

Group dashboard for the PDG of Wenkam Holding Plus: group overview, department health, read-only views of the SAIC treasury and traceability registry, and the approvals inbox.

- **Roles** (table `exec_members`): `pdg`; `dg_whp`, `daf_whp`, `dg_saic` submit requests to the PDG and follow their own.
- **Workflow enforced by the database:** the PDG approves, rejects (reason required) or asks for information (question required); the submitter answers and the request comes back as pending; submitted requests can't be edited; every step is kept in the request's history.
- The PDG reads the registry and the treasury but does not approve inside them (those steps stay with the DG SAIC, the DAF and the Traceability Lead).
- Attachments are stored in the private `pdg-files` bucket.

## Setup
1. Supabase → SQL Editor → paste all of `supabase/pdg.sql` → Run (after `schema.sql` and `treasury.sql`). It also adds three example requests marked "Example".
2. Give each person their role:
   ```sql
   insert into public.exec_members (user_id, role)
   select id, 'pdg' from auth.users where email = 'pdg@example.com'
   on conflict (user_id) do update set role = excluded.role;
   ```

---

# SAIC — Cocoa reception (`/reception`)

Receptions of cocoa at the warehouse: quantities, weighted average price, zones of origin, buyers, losses and bonuses, stock and sales, and deliveries by farmer (linked to the registry by farmer ID and plot).

- **Who records:** the registry's Warehouse Manager and Traceability Lead. Everyone else with a registry role, and the PDG, reads.
- **Checked by the database:** every farmer and plot named in a reception must exist in the registry; amount, bonus and loss are calculated from quantity, price and quantity received; receptions are never deleted; every change goes to `reception_log`.
- **Setup:** Supabase → SQL Editor → run `supabase/reception.sql` (after `schema.sql`, `treasury.sql` and `pdg.sql`). It imports the 86 lines and 6 sales of the 2026/2027 inventory account once.

---

# SAIC — DG SAIC dashboard (`/dg-saic`)

Dashboard for the Managing Director of SAIC, who runs **SAIC Cacao** and **SAIC Industries**.

- **DG SAIC** (`exec_members.role = 'dg_saic'`): overview of every SAIC department (cash boxes, cocoa reception, traceability, requests by department), read-only views of the treasury, reception and registry, the treasury fund requests waiting for her sign-off, and her requests to the PDG.
- **Staff → DG:** SAIC staff send requests to the DG from the same page. The DG approves, rejects (reason required), asks for information (question required) or **forwards to the PDG**: a PDG request is created from it (attachments copied) and the original shows the PDG's decision.
- **Who can send requests:** people the DG adds on the **Team** page (entity + department), and anyone who already has a registry or treasury role (filed under SAIC Cacao).
- **Enforced by the database:** submitted requests can't be edited, only the DG decides, only the sender answers a question, every step is kept in the request's history. Attachments are in the private `dg-files` bucket, one folder per sender.

## Setup
1. Supabase → SQL Editor → paste all of `supabase/dg_saic.sql` → Run (after `schema.sql`, `treasury.sql`, `pdg.sql` and `reception.sql`). It adds three example requests marked "Example".
2. Make sure the DG SAIC has her role (replace the email):
   ```sql
   insert into public.exec_members (user_id, role)
   select id, 'dg_saic' from auth.users where email = 'dg.saic@example.com'
   on conflict (user_id) do update set role = excluded.role;
   ```
3. The DG opens `/dg-saic` → **Team** and adds SAIC Cacao and SAIC Industries staff (their accounts are first created in Authentication → Users).

---

# WHP — DG WHP dashboard (`/dg-whp`)

Same page as `/dg-saic` (Vercel serves it at `/dg-whp` through a rewrite in `vercel.json`), for the Managing Director of Wenkam Holdings Plus.

- **DG WHP** (`exec_members.role = 'dg_whp'`): requests from WHP head-office staff (approve, reject, ask for information, forward to the PDG), his own requests to the PDG, the SAIC subsidiary's performance (read only) and his Team page.
- Each request goes to one office according to the sender's entity: `whp` → DG WHP; `cacao`, `industries` → DG SAIC. Each DG only sees and decides on their own office's requests.

## Setup
1. Supabase → SQL Editor → run `supabase/dg_whp.sql` (after `dg_saic.sql`).
2. Give the DG WHP his role (replace the email):
   ```sql
   insert into public.exec_members (user_id, role)
   select id, 'dg_whp' from auth.users where email = 'dg.whp@example.com'
   on conflict (user_id) do update set role = excluded.role;
   ```

---

## Several roles on one account (test phase)
`exec_members` now allows one account to hold several executive roles (primary key `user_id, role`): every rule checks "does this account have role X?" (`has_exec`). Each page uses the role it is for: `/pdg` the PDG role, `/dg-whp` the DG WHP role, `/dg-saic` the DG SAIC role. To add a role:
```sql
insert into public.exec_members (user_id, role)
select id, 'dg_whp' from auth.users where email = 'someone@example.com'
on conflict do nothing;
```

---

# ABI — Agricultural Business Intelligence (assistant)

ABI is the assistant built into every SAIC Suite page (the "Demander à ABI / Ask ABI" button, bottom right). It writes summaries, answers questions about the treasury, receptions, registry and requests, and drafts notes, in French or English.

- **Same access as the dashboards.** ABI reads the database with the signed-in person's own session, so Row Level Security applies: a warehouse manager can't see the cash boxes through ABI, a DG only sees their office's requests. Phone numbers, ID numbers and photos are never sent to the AI.
- **Actions only with a click (stage 2).** ABI can prepare a treasury fund request step (DAF or DG), a decision on a request to the DG or the PDG, or a correction to a reception. It shows a card; nothing is saved until the person clicks **Confirm**, and the database rules still apply (step order, no self-approval, reasons, history and change logs). Funding by the Treasurer is not done through ABI.
- **Files:** `js/abi.js` (the panel, loaded by each page), `supabase/functions/abi/index.ts` (the server part, which calls Claude).

## Setup (about 10 minutes, once)
1. **Claude API key:** at [platform.claude.com](https://platform.claude.com) → API keys → Create key. Keep it private.
2. **Add the key to Supabase:** Supabase → Edge Functions → Secrets → add `ANTHROPIC_API_KEY` with the key. Never put it in `js/config.js` or in GitHub.
3. **Install the function:** Supabase → Edge Functions → Deploy a new function → Via editor → name it `abi`, paste `supabase/functions/abi/index.ts`, deploy. Then in the function's settings, turn **off** "Enforce JWT verification" (the function checks the session itself).
   With the Supabase CLI instead: `supabase functions deploy abi --no-verify-jwt`.
4. Open any SAIC Suite page, sign in and click **Demander à ABI**.

Options (Edge Functions → Secrets): `ABI_ACTIONS=off` makes ABI read only; `ABI_MODEL` changes the Claude model (default `claude-opus-5-5`).
Costs: each question is billed by Anthropic on the API key's account (roughly 5 to 20 US cents for a typical question, more for long reports). Set a monthly limit in the Claude Console.

---

## Tests
The F01 checks and plot geometry live in `js/checks.js` (no screen code), so they can be tested on their own; `tests/abi.test.mjs` checks that ABI's answers are shown safely. Unit tests are in `tests/`; they need Node 20 or newer and nothing to install:
```
node --test tests/*.test.mjs
```
GitHub runs them on every push and pull request (`.github/workflows/tests.yml`). They don't touch the database or the live site.
