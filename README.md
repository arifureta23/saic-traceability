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
3. Vercel gives an address like `saic-registry.vercel.app`. Use it as the Site URL in step 1.4.

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
