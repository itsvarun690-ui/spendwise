# Build Spendwise Android APK with GitHub Actions

The workflow is `.github/workflows/android-debug.yml`. It is **manual only** (`workflow_dispatch`): it does not publish to Google Play, deploy the website, apply Supabase SQL, or store a service-role key. It builds a debug APK on a GitHub-hosted Ubuntu runner and keeps the artifact for 14 days.

## 1. Connect the project to a private GitHub repository

If you do not already have a GitHub repository for this project, create one on GitHub and choose **Private**. Do not initialize it with a README, license, or `.gitignore` because this project already has those files. If the existing `origin` remote already points to the right private repository, keep using it rather than creating another repository. I have not inspected or changed the remote URL, pushed commits, or changed repository visibility.

Before committing, review `git status --short` and stage the workflow and required app source, Android project/wrapper, package files, Capacitor config, and migration file. For example, from the project root:

```bash
git add .github/workflows/android-debug.yml package.json pnpm-lock.yaml capacitor.config.ts android src supabase/migrations/20261124160000_detected_expense_idempotency.sql
```

Then review the staged file list before committing:

```bash
git status --short
git diff --cached --name-only
```

Do **not** stage `.env.local`, any `.env` file other than `.env.example`, `local.properties`, signing keystores/passwords, service-role keys, or other private credentials. The root `.gitignore` excludes `.env.*` (except `.env.example`); Android's `.gitignore` excludes `local.properties` and build output. Check that `android/app/google-services.json` or any other credential/config file is not staged if one exists. The SQL file is only source text; committing it does not apply it to a database.

Commit and push through the GitHub account/repository you selected. The workflow must be present on the repository's default branch before the manual workflow appears in the Actions tab. If you already use another deployment or CI workflow, this one has no deploy/publish steps and does not invoke it.

## 2. Optional: configure the public Supabase client values

The workflow can build without any Supabase configuration, but that APK will open Spendwise without a configured backend. To build an APK connected to your existing Supabase project, add these under the repository's **Settings → Secrets and variables → Actions → Variables** (not secrets):

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

If your project still uses the legacy anon key, you may instead define `VITE_SUPABASE_ANON_KEY`. The publishable/anon key is intentionally public client configuration and is embedded in the app bundle; it is not a service-role key. **Never** define or pass a Supabase service-role key. These values are optional for the build, but necessary for Supabase-backed sign-in and data access in the generated app.

The migration `supabase/migrations/20261124160000_detected_expense_idempotency.sql` remains unapplied. Detected expense saves that call its RPC cannot complete until the database migration has been separately reviewed and applied with your approval.

## 3. Run the cloud build

1. Open the private repository on GitHub and select **Actions**.
2. Choose **Android debug APK** from the workflow list.
3. Select **Run workflow**, choose the branch containing the workflow (normally `main`), and confirm **Run workflow**.
4. Open the new run and wait for the **Build debug APK** job to finish with a green check. A failed run does not produce a successful APK artifact; open the failing step's logs for its error.

The workflow uses Node.js 22, pnpm 11.25.0, Temurin JDK 21, the project's Gradle wrapper (Gradle 8.14.3), Android SDK Platform 36 and Build Tools 36.0.0. It runs `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm build`, `pnpm exec cap sync android`, and `./gradlew --no-daemon --stacktrace :app:assembleDebug` in that order before uploading the APK.

## 4. Download the APK

On a successful run, open the run summary and download the artifact named `spendwise-debug-apk-<run number>` under **Artifacts**. GitHub retains it for 14 days. The artifact contains `app-debug.apk`; it is a debug/testing build, not a Play Store release APK/AAB. Installing it on an Android phone may require allowing installation from the browser/file manager used to open it. Use Android Settings to grant notification access; grant optional SMS permission only if you opted into that feature.

## Status of this workflow

The workflow file has been added locally, but it has **not** been pushed to GitHub or run on a GitHub-hosted runner. No cloud build has completed yet, so no APK artifact exists and build success is not claimed. A successful GitHub Actions run is still required to verify the workflow end to end.
