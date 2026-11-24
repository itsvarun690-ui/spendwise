# Spendwise Phase 2 — Single Android app implementation plan

**Status: Plan only.** No application source, database, APK, or deployment has been changed for this revised plan. This is a proposal for approval before implementation.

## Recommended architecture: one app, two runtimes

Keep the existing Spendwise React 19 + TypeScript + Vite application as the UI and business-logic source. Add Capacitor to the same repository and build the Vite production bundle into the Android package. Capacitor is designed to add an Android runtime to an existing web project and allows its JavaScript layer to communicate with native Kotlin/Java functionality. [1] [2]

The Android deliverable would be one installed app named **Spendwise**, not a second companion app. Its screens would be the existing React Spendwise screens, including the current dark theme, onboarding, auth, dashboard, categories, budgets, manual expense form, history, and backup flows. Only the transaction-review state and Android settings/permission explanation need additions to the current React UI. The PWA/web deployment remains available and unchanged as a web application; it will not gain device-wide transaction detection.

I recommend packaging the built React assets locally inside the Android app rather than making the app a wrapper that merely opens the deployed website. A local bundle can still use the existing Supabase URL and publishable key while providing a first-party native service and a controlled bridge. Web updates can continue independently, but updates to the Android-bundled UI require a new Android build and installation/update. The existing web app's Supabase Auth session is stored in browser storage; the Android WebView has its own app storage, so the user will sign in to the same Supabase account once inside Spendwise Android. This reuses the authentication provider and identity, not a shared browser cookie/session. The Android app must contain only the public publishable key, never a service-role/secret key.

Suggested repository shape:

```text
src/                         Existing React UI, Supabase JS client, expense workflow
android/                     Capacitor-generated native Android project
  app/src/main/...            Kotlin notification/SMS services, permission and deep-link handling
  app/src/main/assets/...     Bundled web assets produced from the existing Vite build
src/lib/nativeTransactions/   Typed Capacitor bridge and review-route integration
supabase/migrations/          One additive migration, if approved
```

The current `src/App.tsx` already loads authenticated categories and expenses and exposes `saveExpense`; manual entry uses the existing `expenses` insert/update path. The proposal preserves that manual flow. Detected expenses need a separate idempotent server operation described below because a plain insert cannot safely distinguish a retry after an uncertain network response.

## Detection and classification

A Kotlin `NotificationListenerService` inside the same Android package would be the primary detection mechanism. Android calls it when notifications are posted or removed, after the user enables Spendwise in Android's special **Notification access** settings. [3] In Spendwise settings, the user would explicitly choose supported source apps, such as Android Messages, Google Pay, and Super.money, where installed. The native service would check the posting package first, inspect text only for selected packages, parse locally, and discard the original notification text. No unrelated notification content would be written to the queue, Supabase, or logs.

For a candidate to issue **“Payment detected — Add expense?”**, local parsing must find a sufficiently clear successful outgoing debit and amount. Incoming credit is ignored. Failed and pending items are ignored. Refunds and reversals are kept in a reconciliation state and never become a new expense. Ambiguous items can appear in a low-key **Needs review** list in Spendwise, but will not use the debit notification or be eligible for Proceed until the user can establish that they are a valid completed outgoing payment. Neither notification wording nor a sender ID alone proves a bank transaction. SBI formats, source package names, transaction direction, and status must be checked against redacted examples from the user's actual phone before treating any provider-specific parser as dependable.

Notification access is broad at the Android system level: the operating system grants visibility to notifications, not just SBI messages. App-side package filtering reduces what Spendwise reads and retains, but cannot turn that OS permission into a narrowly scoped SBI-only grant. Notification capture also depends on the source app actually posting usable transaction details. It can miss payments if notifications are disabled, hidden on the lock screen, suppressed by the source app, formatted differently, delayed, or affected by OEM battery controls. This is not a bank API and cannot guarantee capture of every UPI payment.

### Optional SBI SMS fallback

SMS detection should be a separately switched-on option and off by default. A native `SMS_RECEIVED` receiver can receive a newly arrived SMS broadcast with `RECEIVE_SMS`; it does not need `READ_SMS` or access to the stored inbox for this new-message-only design. [4] The receiver would immediately compare the sender/header to a small user-approved SBI candidate allow-list, then check transaction wording and required debit/status details. It would parse only matching messages in memory, discard raw text, and store only the minimal normalized candidate fields. Candidate SBI sender IDs such as `AD-SBIUPI-S` and `AX-SBIBNK-S` remain provisional: IDs may vary by carrier/template and must not be treated as proof of authenticity.

Google Play currently restricts SMS permissions. Its policy lists SMS-based money management, including budget apps, as a possible exception use, but it is subject to the Play declaration and review; acceptance is not guaranteed. [5] The initial Play-ready configuration should therefore omit SMS permissions unless the SMS feature is approved for inclusion and the permission declaration is accepted. For personal testing, a privately signed APK can be installed outside Play, but the user must opt in to installing from that source on Android 8.0+; private distribution does not remove the Android permission prompt or privacy obligations. [6]

## Permissions and user control

The app would request only:

- **Notification access:** special Settings grant, explained before opening Android settings; required for notification detection.
- **Notifications (`POST_NOTIFICATIONS`):** requested contextually on Android 13+ when the user enables Spendwise alerts. If denied, Android blocks ordinary app notifications; Spendwise will retain candidates and show an in-app review badge/list when opened. [7]
- **SMS (`RECEIVE_SMS`):** only if the optional SMS switch is enabled and this distribution's policy route allows it. No `READ_SMS`, contacts, accessibility, overlay, call-log, or UPI PIN permission is planned.
- **Internet:** for authenticated Supabase reads/writes and later synchronization.

A visible **Pause detection** switch would stop the native service from processing events and cancel any queued, unhandled detection work as the user chooses. Spendwise would link back to Android's Notification access screen so permission can be revoked there. The app will not draw over other apps or use full-screen intents; the detection alert is a normal Android notification.

## Notification tap, review and save

When a valid outgoing debit is queued, a standard Spendwise notification will have the requested title **“Payment detected — Add expense?”** and message **“₹[amount] paid to [merchant, if available].”** The notification's immutable, explicit Android `PendingIntent` will open Spendwise with only an opaque local candidate ID—not the amount, merchant, raw message, credentials, or account information in a URL. A Capacitor bridge event will route the existing React app into the review state and load that candidate from native local storage. If the app is signed out, the user signs in first and the pending review resumes.

The review uses Spendwise styling and shows an alert icon, **“Add this as an expense?”**, amount, merchant/description, date/time, UPI payment method, SBI, reference where available, and category. The user can edit the supported expense fields. **PROCEED** validates and submits; **SKIP** records the local decision without creating an expense. For an external HTTPS link, verified Android App Links can use an opaque ID and route to the same screen, but require a matching `assetlinks.json` on the domain and the app's signing-certificate fingerprint. [8] This is optional for the notification path: an explicit in-app `PendingIntent` is simpler and avoids a domain publication dependency.

## Offline queue, auth and duplicate prevention

Detected candidates remain on the device until the user acts. Store only normalized fields needed for review—amount, merchant if present, transaction time, bank/source, payment method, reference and state—in a local database. Encrypt candidate data with an app key protected by Android Keystore; Keystore helps prevent key extraction, but it is not a guarantee against a compromised or unlocked device. [9] Discard raw SMS/notification text and never persist OTPs, PINs, passwords, balances, or account numbers.

The local queue records `pending`, `skipped`, or `proceed_queued` decisions. A skipped event stays suppressed locally. Pressing Proceed is the only action that creates a confirmed save request. If offline, Spendwise keeps the edited, user-confirmed request encrypted and labels it **Queued to save when online** rather than claiming it has already been saved. A unique WorkManager request with network constraints and retry/backoff can send it later; Android may defer this work, so it is persistent/retryable but not guaranteed to run at an exact time. [10]

For background work, the React Supabase session and native worker need one carefully controlled credential handoff. The plan is to pass the current Supabase session from the WebView to the native bridge and keep any refresh material only in Keystore-protected storage, clearing it on sign-out. The worker uses the same Supabase user session and public key; it never uses a service-role key. This token lifecycle is a security-sensitive implementation detail and must be tested for sign-in, refresh, sign-out, and account switching before enabling background writes. If that shared-session path proves unreliable, the safe fallback is to sync confirmed requests when the Spendwise screen is next opened and authenticated, with the limitation clearly stated.

An additive migration would add a narrow **payment-save idempotency ledger**, not replace or rewrite `expenses`. It would record the authenticated `user_id`, opaque deduplication key, source class, linked expense ID, and timestamps. It would not store raw message text. The key uses a normalized UPI reference/transaction ID when present. Otherwise it uses normalized amount, original event date/time, merchant, and source class. A bounded near-duplicate warning is safer than silently dropping a potentially genuine purchase where reference or merchant is absent. No fallback can perfectly distinguish two identical purchases with incomplete event data.

A narrowly scoped authenticated RPC would atomically create the expense from the user's final edited values and claim the ledger key in the same database transaction. Repeating the same key after an uncertain timeout returns the already-associated expense rather than inserting a second one. It will verify the caller via `auth.uid()`, preserve category ownership constraints, and use RLS/least-privilege grants. The existing manual expense operation remains separate and untouched; manual rows receive no detection key and are never overwritten or deduplicated against an automatically detected event. Supabase recommends combining grants with owner-scoped RLS and prefers `SECURITY INVOKER` functions unless a carefully secured definer function is necessary. [11] [12]

The migration is proposal-only until approved. The checked-in migration establishes `public.expenses` with `user_id`, `category_id`, `amount`, `spent_on`, `payment_method`, `description`, and owner-scoped RLS. The live database could not be queried in this session, so its current schema has not been independently compared with the checked-in migration. Before anyone applies a migration, the actual live schema must be checked; until then the SQL must remain unapplied. Existing rows and manual expenses are not to be altered.

## Installation and release path

After implementation approval, the project would build its regular Vite assets, run Capacitor sync, and open the generated `android/` project in Android Studio. A signed private APK can be installed directly on the user's Android phone after allowing that installation source. An eventual Play release would require the usual app signing and policy declarations, especially if SMS is included. Exact build commands, package identity, SDK targets, permission screens, and APK steps would be supplied after the Android project is configured.

The current sandbox has Java but no Android SDK or Gradle and no connected handset. Therefore, it cannot currently produce a verified APK or test actual SBI/Google Pay/Super.money notifications. After approval, source/static checks can be done here if the toolchain permits; APK compilation, permission behavior, notification parsing, battery behavior, and end-to-end payment samples must be verified on an Android device before claiming them as working. The actual handset model/Android version and redacted SBI/GPay/Super.money notification/SMS examples are needed to validate source formats.

## What can and cannot be reliable

**Reasonably reliable after device testing:** keeping the current React source as the UI, reusing its Supabase Auth project and `expenses` model, locally queuing normalized candidates, opening the review from an in-app notification, making Proceed explicit, preserving Skip, and using a server-side unique receipt key to make retries idempotent.

**Best-effort only:** seeing a source-app notification, extracting every transaction field, scheduling background sync promptly, and recognizing every SBI message/template across app versions, carriers and OEMs. Notification or SMS permission denial disables that source. Android battery optimization, force-stop, source-app notification settings, network availability, token expiry, and OEM changes can delay or stop background work. We cannot guarantee all transactions will be detected or that every candidate will contain merchant/reference details.

**Not provided:** a bank-authoritative API, balance/account-number collection, full inbox scanning, silent/automatic expense saving, cross-device pending-review sync, or transaction detection in the browser/PWA alone. Cross-device pending review could be considered later, but it would require storing pending candidate details in Supabase and is intentionally excluded from this privacy-first first release.

## Approval boundary

If this plan is approved, the next phase would be source implementation and creation of a migration file only. It would not apply the migration, alter existing rows, or publish the application. Those remain separate actions requiring your approval. Before implementation, the live schema limitation and Android SDK/device-testing gap above will be carried forward rather than treated as resolved.

## References

[1]: https://capacitorjs.com/docs/getting-started "Capacitor installation and adding to an existing web app"
[2]: https://capacitorjs.com/docs/android "Capacitor Android documentation"
[3]: https://developer.android.com/reference/android/service/notification/NotificationListenerService "Android NotificationListenerService API"
[4]: https://developer.android.com/reference/android/provider/Telephony.Sms.Intents "Android Telephony SMS Intents API"
[5]: https://support.google.com/googleplay/android-developer/answer/10208820?hl=en "Google Play SMS and Call Log permissions policy"
[6]: https://developer.android.com/distribute/marketing-tools/alternative-distribution "Android alternative app distribution"
[7]: https://developer.android.com/develop/ui/views/notifications/notification-permission "Android notification runtime permission"
[8]: https://developer.android.com/training/app-links/about "Android App Links"
[9]: https://developer.android.com/privacy-and-security/keystore "Android Keystore system"
[10]: https://developer.android.com/develop/background-work/background-tasks/persistent "Android persistent background work"
[11]: https://supabase.com/docs/guides/database/postgres/row-level-security "Supabase Row Level Security"
[12]: https://supabase.com/docs/guides/database/functions "Supabase database functions and security"
