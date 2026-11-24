# Spendwise Expense Tracker

A mobile-first expense tracker built with React, TypeScript, Tailwind CSS 4, Vite, and Supabase. The interface follows the supplied dark Figma screens. Expense and budget values are always calculated from the signed-in user's database rows; the app does not insert demo transactions.

## Local development

Requirements: Node.js 20.19+ and pnpm 11.25.0 (the project pins its package manager).

```bash
pnpm install
cat > .env.local <<'EOF'
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
EOF
pnpm dev
```

Open the Vite address shown in the terminal. A preview can also be used before Supabase is connected, but it is explicitly read-only: it contains no sample transactions and will not save personal data.

## Supabase setup

1. Create a Supabase project using its free plan and open the project's **Connect** panel. Copy its project URL and **publishable** key (a legacy `anon` key is also accepted). These are browser-safe values, but the database remains protected by authentication and RLS.
2. Add them to `.env.local`:

   ```dotenv
   VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_REPLACE_WITH_YOUR_KEY
   ```

   Restart `pnpm dev` after changing environment variables. Never put a Supabase secret or `service_role` key in a `VITE_` variable or browser code.
3. In the Supabase Dashboard, open **SQL Editor**, paste the contents of [`supabase/migrations/20261124053130_expense_tracker_core.sql`](supabase/migrations/20261124053130_expense_tracker_core.sql), and run it once. It creates `profiles`, `categories`, `monthly_budgets`, and `expenses`; enables RLS; revokes signed-out access; and grants authenticated users CRUD access only to rows they own. It also prevents an expense from referencing another user's category.
4. In **Authentication → URL Configuration**, set the site's URL to the app's deployed URL and add the exact Preview/published origins (and local development origin, if used) to the redirect allow-list. Signup confirmation links request a return to the current app origin. Configure email confirmation and recovery in Supabase Auth. The app supports email/password sign-up and sign-in.
5. Start the app, create your account, and confirm your email. The signup confirmation returns to the app; sign in there to finish onboarding. Setup answers are kept locally during this confirmation step so the final budget step can resume. The app stores your profile preferences and monthly budget, then creates your initial category list. No expenses are seeded.

The Supabase dashboard is the source of truth for your saved data. RLS checks `auth.uid()` for every table operation. Do not disable those policies to resolve a data access error.

## Data behavior

Expenses use their actual `spent_on` date. Month queries use inclusive month start and exclusive next-month start, so the year is always part of the filter. The selected month and comparison month are fetched in stable, ordered pages of 500 rows with an exact count, so a configured Data API cap does not silently truncate monthly totals. Adding, editing, or deleting an expense refreshes the selected month, previous month, and recent activity. A zero budget has no utilization percentage; overspending produces a negative remaining amount and utilization above 100%. Daily average divides by elapsed days for the selected period.

CSV export in the month filter contains all saved expenses for the selected month. Recent-history export is a separately named recent-activity file. “Download monthly report” opens a print-ready view for the selected month that can be saved as PDF from the browser. Service-worker caching is limited to the application shell and static assets; it does not cache Supabase data or auth responses.

Signed-in users can download a JSON backup containing their profile, categories, monthly budgets, and all expenses. Restore accepts this app's versioned JSON backup, validates its rows, and merges them into the signed-in account: matching records are updated, missing records are added, and records absent from the file are not deleted. Keep backup files private. Restore is a sequence of authenticated batches rather than one database transaction, so if a batch fails, earlier successful batches remain and the same backup can be retried after fixing the reported issue.

## Implementation references

Supabase documents that the Data API normally returns at most 1,000 rows (a project setting can change that limit) and recommends pagination. Its JavaScript `range()` modifier uses zero-based inclusive bounds and relies on an explicit order. This app paginates the selected and comparison months with stable ordering and an exact row count. See [Supabase JavaScript range and query limits](https://supabase.com/docs/reference/javascript/range). The [Supabase changelog](https://supabase.com/changelog.md) was checked on 2026-11-24; the current CLI v3 breaking-change notice does not affect this setup, which applies SQL through the Dashboard and does not require the CLI.

## Free hosting

Build the static site with `pnpm build`; the output is `dist/`. Deploy that folder to any static host with HTTPS and SPA fallback to `index.html`. Add the same two `VITE_SUPABASE_*` values in the host's build environment and add the production URL to Supabase Auth's allowed URLs. Never publish `.env.local`.

Supabase and hosting providers change their free-tier quotas and inactivity rules. Free tier does not imply unlimited or guaranteed permanent service; review the current limits in your provider dashboard. The source can be self-hosted without a paid API or a server-side secret.

## Project map

- `src/components/Onboarding.tsx`: illustrated setup flow from the Figma reference.
- `src/components/MainApp.tsx`: dashboard, activity, monthly budget, insights and navigation.
- `src/components/ExpenseModal.tsx`, `BudgetModal.tsx`: create/edit/delete forms and per-month limits.
- `src/lib/analytics.ts`: calculations for totals, categories, days and weeks.
- `src/lib/supabase.ts`: browser-safe client, configured only by public project variables.
- `supabase/migrations/`: SQL schema, grants and row-level security policies.
- `public/manifest.webmanifest`, `public/sw.js`: installable app manifest and static-only offline shell.

## Android app and cloud debug build

Spendwise can be built as one Capacitor Android app that keeps the existing React interface. The Android sources are under `android/`; `capacitor.config.ts` points Capacitor at the Vite `dist/` output. For a local build, install Node.js 22, pnpm 11.25.0, JDK 21, Android SDK Platform 36 and Build Tools 36.0.0, then run:

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
pnpm exec cap sync android
cd android
./gradlew assembleDebug
```

The debug APK is written to `android/app/build/outputs/apk/debug/app-debug.apk`. Generated web assets and build outputs are not included in source transfers; the build and Capacitor sync steps recreate them. The Android project uses its checked-in Gradle wrapper (Gradle 8.14.3) and Android Gradle Plugin 8.13.0.

A manual GitHub Actions workflow is at `.github/workflows/android-debug.yml`. See [`GITHUB_ACTIONS_ANDROID_BUILD.md`](GITHUB_ACTIONS_ANDROID_BUILD.md) for private-repository setup, optional public Supabase repository variables, workflow execution, and artifact download. Do not upload `.env.local`, service-role keys, Android signing keys, or other credentials to GitHub. The Supabase publishable/anon key is public client configuration; never use a service-role key in a Vite build or mobile app.

The additive detected-expense idempotency migration `supabase/migrations/20261124160000_detected_expense_idempotency.sql` is source-only and has not been applied. Review it against the actual Supabase schema and obtain approval before applying it; building the APK does not change the database. A debug APK is for private testing and is not a Play Store release.
