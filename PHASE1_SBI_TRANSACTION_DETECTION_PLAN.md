# Spendwise: SBI transaction detection — Phase 1 audit and plan

**Status:** Audit and proposal only. No application files, database objects, expenses, or existing functionality were changed for this feature.

## 1. Existing application

Spendwise is a responsive React 19 + TypeScript application built with Vite 8. It uses Tailwind CSS and the Supabase JavaScript client. The project includes a Progressive Web App manifest with `display: standalone`, so it can be installed to an Android home screen as a web app. It is not a native Android application. A PWA runs in the browser's web security model and cannot register Android's cross-app `NotificationListenerService` or receive device-wide SMS broadcasts. An Android-native companion is therefore needed for the proposed device-side detection.

## 2. Existing data, authentication, and save flow

The existing `public.expenses` table stores `id`, `user_id`, `category_id`, `amount`, `spent_on`, `payment_method`, `description`, `created_at`, and `updated_at`. Existing expense rows are owner-scoped using Supabase Auth and row-level security (RLS). The expense modal in `src/components/ExpenseModal.tsx` gathers editable expense fields; `src/App.tsx` performs authenticated Supabase reads and writes, including creating an expense and refreshing the displayed data. The new feature should retain that table and its existing add/edit path rather than create a second kind of saved expense.

The current browser app uses the signed-in Supabase session and public client configuration. The Android companion can authenticate as the same Supabase Auth user, then use the same project URL and publishable key through a native client. RLS continues to enforce that its signed-in user can access only that user's rows. No service-role key belongs in an Android APK: anyone can extract app contents. The community-maintained `supabase-kt` Kotlin client supports Android Auth and PostgREST, although its documentation cautions that it is not an official Supabase library and currently lists Android SDK 26 as its minimum unless desugaring is enabled. [8] [10]

**Account note:** the native app must sign in as an existing Supabase identity that is actually supported by the current Auth configuration. A display name or username alone is not a password-auth credential in Supabase by default. If the current account flow is email/password with confirmation disabled for personal use, native sign-in can use that same email/password. Do not create a separate auth system or share credentials with the website by copying browser session files.

## 3. Detection options: Android notifications versus SMS

### Recommended first source: notification access

A `NotificationListenerService` receives notifications posted by other apps. Android requires the listener to be declared in the manifest with `BIND_NOTIFICATION_LISTENER_SERVICE`, and the user must explicitly enable Spendwise under Android's Notification access settings. The listener must wait until Android reports it connected before processing notifications. [1]

This approach is suitable for testing with SBI-related alerts and Google Pay/Super.money payment notifications because it does not require SMS permissions. It is still best-effort: the source app may not show a notification, may change its wording, may hide details on the lock screen, or may use a package/notification format the parser does not recognize. Android/OEM battery controls and disabled notification access can also interrupt capture. It cannot guarantee that every SBI debit, UPI payment, refund, reversal, or cash transaction will be detected.

Notification access is sensitive. It potentially exposes notification contents from other applications, not only bank messages. The implementation should allow-list only user-selected relevant app package names, parse locally on the phone, discard unrelated messages immediately, avoid logging notification bodies, explain the access prominently, and provide a clear off switch. It should upload only minimal transaction candidate fields, not the full notification text, unless the user explicitly approves a privacy design that requires it.

### SMS receiver: optional later source, not the first release

An SMS `BroadcastReceiver` can receive new incoming SMS messages with SMS permissions. It may provide an independent source for SBI bank transaction messages, but introduces more sensitive permission access and a larger policy burden. On Google Play, SMS and Call Log permissions are restricted. The policy lists SMS-based money management (including budget apps) as a potentially eligible use case, but apps still need to declare the use and pass review; eligibility is not automatic. The policy also requires clear disclosure/consent and prohibits exfiltrating unrelated personal SMS data. [2]

For a private APK installed directly by the user, Play's permission declaration/review is not the distribution gate, but the Android permission prompt, user consent, data minimization, and security obligations still apply. Direct APK distribution requires the user to allow installation from that source on modern Android. [7] Given the user's likely one-device personal setup, start with notification access and treat SMS as an optional, separately approved fallback only if real-device tests show a material detection gap.

### Practical comparison

Notification access has a one-time special-access settings step and broad visibility into notifications, but avoids SMS permission and is more likely to be acceptable for eventual Play distribution. SMS receiver access uses explicit sensitive SMS permissions and can detect bank SMS even when no app notification appears, but has more permission friction and Play review risk. Both rely on provider-specific message formats and can miss or misclassify messages. Neither is a bank API and neither should be represented as authoritative bank transaction data.

## 4. Proposed architecture

Keep the current Spendwise web app and its production data model intact. Add a separate native Android companion, preferably Kotlin, as a focused integration layer. It should:

1. Ask the user to choose which notification sources to monitor, explain the notification access requirement, and let them grant access in Android Settings. Request `POST_NOTIFICATIONS` on Android 13+ before posting Spendwise review alerts. [1] [5]
2. Filter notifications by selected package and transaction-like content. Parse likely direction (debit/credit), amount, timestamp, merchant/payee, and source. Use conservative parsing and confidence checks; ambiguous notifications go to review as incomplete candidates rather than being saved.
3. Store a minimal local pending item before showing an alert. Do not insert into `expenses` at detection time. When tapped, open an editable review form with amount, date, payment method, category, and description prefilled where possible. Make the user explicitly press **Confirm and save** to create the expense. Provide dismiss/ignore and edit options. Credits, reversals, failed payments, refunds, and balance-only messages should be excluded or clearly classified for review rather than assumed to be expenses.
4. On explicit confirmation, use the signed-in user's Supabase client to insert through the existing `expenses` schema and owner-scoped RLS. If offline, preserve the candidate locally and allow retry; do not create an expense until confirmation and successful insert are clear to the user. The UI must avoid a second insert if the response is lost after the database accepted a write.
5. Keep native sync work small. Use WorkManager for deferrable synchronization and retry with backoff; it persists work over process restarts/reboots but does not promise an exact immediate run time. Local notification review can happen as soon as the listener captures a candidate. [6]
6. Leave normal web expense entry, history, budgets, categories, navigation, and visual design unchanged. Reuse the existing expense field meanings and validation. If review is opened in the web app, use an explicit review mode around the existing expense form/modal rather than redesigning that screen.

### Synchronization and duplicates

A purely local pending inbox needs no migration and is the simplest route if the user confirms expenses on the Android phone. However, pending candidates will not appear on another device or in the web app until a confirmed expense is written.

To support review on the web app as well as Android, the safer option is a new, separate `pending_detected_transactions` table. It would hold only minimal normalized fields, `user_id`, detection source/package, observed time, a stable source event identifier when available, a deduplication fingerprint, status, and timestamps. It needs RLS policies limiting each row to `auth.uid() = user_id`. The web app can then read a pending row and open an editable confirmation route/modal. Confirmation inserts into the existing `expenses` table and marks the pending row handled in one transactional server-side operation, or uses a carefully designed idempotent workflow. A migration would add this table only; it would not alter or rewrite existing expense records.

For duplicate prevention, first use Android notification identity (source package, notification key/tag/id and post time) where available, then a normalized fingerprint incorporating source, direction, amount, merchant, and event time. Store the identity locally and, for cross-device/server sync, enforce a unique constraint scoped to the user. Do not deduplicate solely on amount and date: two genuine same-value purchases can occur close together. If two candidate notifications look alike but lack a stable shared event ID, show a possible duplicate warning instead of silently dropping either one. The confirmed expense should carry a reference to the candidate only if the user approves an additive nullable provenance field or another idempotency mapping; avoid altering the existing schema until that trade-off is approved.

## 5. Deep-link confirmation flow

For a confirmation screen that opens in the **native companion**, the notification's `PendingIntent` can navigate directly to the Android review screen using an internal opaque candidate ID. This is the most reliable first-release path and avoids putting transaction amounts, merchant names, raw notification text, or credentials in a link.

For a confirmation screen that opens in the **existing web app**, add a route/query such as `https://spendwise-j8m7clhh.manus.space/review/<opaque-id>` (final URL should be verified against the deployed domain). Android App Links are preferred for HTTPS links and require an `assetlinks.json` file on the domain plus a matching Android package/signing identity. On Android 12+, unverified web links generally open in the browser, so the web route must remain a usable fallback. A custom URI scheme is easier for private testing but can be claimed by other apps and is less seamless. [3] [4]

The link should carry only an unguessable opaque ID, not editable amounts or full notification text. The app must fetch the pending item using the signed-in Supabase identity, verify ownership via RLS, show the editable form, and write only after explicit confirmation. If the user is not signed in on the web, the route should ask them to sign in, then resume review. Android and browser sessions are separate; signing into the companion does not automatically authenticate the website. Supabase permits native redirect URIs but any auth callback must be explicitly listed in allowed redirect URLs. [9]

## 6. Changes that would be needed after approval

### Android companion

Create a separate Kotlin/Gradle Android project or a clearly isolated Android module, not a rewrite of the web project. Add the notification listener service, local pending storage, parser tests for redacted examples, review UI, Supabase Kotlin auth/data integration, and WorkManager synchronization. Add only the permissions required for the chosen source. For the initial notification-only scope, the main special access is Notification access; `POST_NOTIFICATIONS` is needed on Android 13+ to post Spendwise alerts. Do not add SMS permissions unless SMS detection is approved as a separate option. Select and test a minimum Android SDK that supports the target handset and the chosen Supabase client version.

### Existing React app

If native-only confirmation is chosen, no web app code needs to change for the first release. If the user approves review links into the existing web app, add a small route/state handler in `src/App.tsx`, feed the existing `ExpenseModal`/expense validation with candidate defaults, preserve normal create/edit behavior, and handle pending-state resolution/idempotency. Do not change existing screens or styles beyond the necessary review entry point.

### Database

The native-only local inbox route can write confirmed expenses to the existing `expenses` table without a migration. Cross-device pending review requires an additive migration for `pending_detected_transactions`, with owner-scoped RLS, minimal grants, uniqueness/idempotency rules, and policy tests. Any modification to `expenses` for source linkage or deduplication would also need an additive nullable field or a separate mapping table. These schema changes are proposals only and require approval before creation or application.

### Install and use

After approval and implementation, build a signed debug/release APK or Android App Bundle. For a private personal test, install the APK and allow installation from the source when Android prompts; for general distribution, publish through a store and complete its applicable permissions declarations/review. Sign into the same Supabase account used by Spendwise, enable notification access for only the intended sources, grant Spendwise notifications if desired, and run controlled tests with non-sensitive/redacted sample transactions before relying on detection. Installation source and testing steps will depend on whether the user wants a private APK or a Play release.

## Recommendation and approval point

Proceed, if approved, in two deliberately limited increments: first build a private, notification-only Android companion with local pending review and explicit confirmation, writing confirmed expenses to the existing table; then consider a separate additive pending table and web deep-link review only if cross-device review is needed. Keep SMS out of the first increment. This minimizes changes to the current app and database while validating whether SBI, Google Pay, and Super.money notifications on the user's actual phone provide sufficiently consistent, parseable details.

**Approval requested:** May I proceed with this notification-only native Android companion plan, keeping all existing app features and expense rows intact, and using a local pending review inbox first (no database migration unless cross-device/web review is separately approved)?

## References

[1]: https://developer.android.com/reference/android/service/notification/NotificationListenerService "Android NotificationListenerService API"
[2]: https://support.google.com/googleplay/android-developer/answer/10208820 "Google Play SMS and Call Log permissions policy"
[3]: https://developer.android.com/training/app-links/deep-linking "Android deep linking guide"
[4]: https://developer.android.com/training/app-links/verify-android-applinks "Verify Android App Links"
[5]: https://developer.android.com/develop/ui/views/notifications/notification-permission "Android notification runtime permission"
[6]: https://developer.android.com/develop/background-work/background-tasks/persistent "Android background persistent work"
[7]: https://developer.android.com/distribute/marketing-tools/alternative-distribution "Android alternative app distribution"
[8]: https://supabase.com/docs/reference/kotlin/introduction "Supabase Kotlin client reference"
[9]: https://supabase.com/docs/guides/auth/redirect-urls "Supabase Auth redirect URLs"
[10]: https://supabase.com/docs/guides/database/postgres/row-level-security.md "Supabase Row Level Security guide"
