# NDC Learn: Phases 1 to 9

Auth, roles, routing, security rules, and the server-side free-trial system.
Frontend and functions both type-check and build. Not yet exercised against a live Firebase project.

## 1. Firebase project (one time)
1. console.firebase.google.com → create project → upgrade to **Blaze** (needed for Functions).
2. Enable **Authentication** (Email/Password + Google), **Firestore** (region `asia-south1`), **Storage**.
3. Project settings → add a **Web app** → copy the config into `.env` (see `.env.example`).
4. Put your project id in `.firebaserc`.
5. Install CLI: `npm i -g firebase-tools && firebase login`.

## 2. Secrets (server only)
```bash
# any long random string; NEVER change it after launch (it keys the trial identity hashes)
openssl rand -hex 32
firebase functions:secrets:set IDENTITY_HMAC_PEPPER
```

## 3. Install and deploy
```bash
npm install
npm --prefix functions install
firebase deploy --only firestore,storage        # rules + indexes
firebase deploy --only functions
npm run build && firebase deploy --only hosting
```

## 4. Create the first superadmin
1. Register a normal account in the app, then copy its UID from Firebase Console → Authentication.
2. Download a service-account key (Project settings → Service accounts). Keep it out of git.
```bash
cd functions
GOOGLE_APPLICATION_CREDENTIALS=../serviceAccount.json node scripts/setSuperAdmin.js <UID>
```
Sign out and back in so the new role claim loads.

## 5. Load the NDC student roster (this is what powers verification and one-trial-per-student)
CSV header: `studentId,fullName,department,session` (department = Science | Commerce | Humanities)
```bash
cd functions
GOOGLE_APPLICATION_CREDENTIALS=../serviceAccount.json node scripts/importRoster.js roster.csv
```
Registration compares the student's typed details to this roster. A match means verified, and the server then
checks `studentEntitlements/{HMAC(studentId)}` to grant or deny the 30-day trial.

## 6. Optional: admin-editable settings
Create Firestore doc `settings/system` (Console) to override defaults:
`freeTrialEnabled, freeTrialDurationDays (30), oneTrialPerVerifiedStudent, subscriptionPriceBDT (300)`.

## 7. Before real users
- Enable **App Check** (reCAPTCHA Enterprise), put the site key in `.env`, then set `ENFORCE_APP_CHECK=true` for functions.
- Turn on MFA for admin accounts.
- Get the Privacy Policy and Terms (`src/pages/Legal.tsx` has drafts only) reviewed.
- Test rules with `firebase emulators:start` (set `VITE_USE_EMULATORS=true`).

## Local development
```bash
cp .env.example .env    # fill values
npm run dev
```

## What is where
| Path | Purpose |
|---|---|
| `functions/src/auth/registerStudent.ts` | Profile creation, roster verification, trial decision (transactional) |
| `functions/src/lib/identity.ts` | ID normalisation + HMAC identity hash |
| `functions/src/admin/setRole.ts` | Audited role changes |
| `functions/src/scheduled/expireSubscriptions.ts` | Nightly lock of lapsed plans |
| `firestore.rules`, `storage.rules` | Deny-by-default; no client writes to subscriptions/entitlements |
| `src/context/AuthContext.tsx` | Auth, role, profile, subscription state |
| `src/routes/guards.tsx` | Auth / role / premium route guards |

## Phase 2 additions
- **Feed:** posts with photos/video/links, likes, comments, delete own, report, staff announcements + pin, infinite scroll.
  Posts are created through the `createPost` function (validation, per-user rate limit of 10/hour, media must be in the user's own folder).
  Like/comment/report counters are maintained by triggers, never by the client. 5 distinct reports auto-hide a post for staff review.
- **Profile:** photo upload (compressed in-browser), phone/section edit, score visibility toggle.
- **Redeploy:** `firebase deploy --only firestore,storage,functions` then rebuild/deploy hosting.
  The new composite indexes in `firestore.indexes.json` take a few minutes to build.
- Feed and post files use the **premium gate**: only trial/active subscribers can read or post (enforced in rules, not just UI).

## Phase 3 additions
- **Admin panel** (`/admin`, admin/superadmin only): Overview stats, Students (search by ID, trial grant/extend/revoke/block, suspend),
  Verification queue, Class materials editor, Subjects, Roster import (paste CSV rows), Settings, Audit log + suspicious-registration events.
- **Student side:** `/learn` (search, subject filter, department-targeted) and `/learn/:id`. Students who didn't auto-verify can upload
  an ID photo from Profile (explicit consent checkbox); it is compressed in-browser, stored write-only, viewed by admins via a 5-minute
  signed link (each view audit-logged) and **deleted as soon as the admin decides**.
- Approving a verification also runs the one-trial-per-student decision on the server.

### One extra setup step for signed ID links
Grant the Cloud Functions runtime service account the role **Service Account Token Creator** on itself
(Google Cloud Console → IAM), otherwise `getVerificationImageUrl` fails to sign URLs.

### Redeploy
`firebase deploy --only firestore,storage,functions`, then `npm run build && firebase deploy --only hosting`.
New composite index (materials by status + department + date) takes a few minutes to build.

### Known limits (by design, for now)
- Class attachment URLs are only revealed inside premium-gated documents, but Storage itself allows any signed-in user who knows the exact path. Paths are random UUIDs.
- Moderator role has no panel yet; feed moderation tools arrive with the report queue in a later phase.
- Publishing a material doesn't notify students until Phase 6 (FCM).

## Phase 4 additions: quiz engine
**Security model**
- Students can never read `questions`, `questionKeys`, `quizAttempts` or `quizReviews`. A question reaches a student only through
  `startAttempt`, already shuffled and without the answer.
- The score is computed only in `finalizeAttempt` (Cloud Function, in a transaction, so it runs exactly once). The browser never sends a score.
- Timer runs on the server: each attempt has a server-set `deadline`. Late answers are ignored (10 s grace). A scheduled job
  (`autoSubmitExpired`, every 5 min) scores attempts whose timer ran out (closed tab, dead battery).
- Attempt limits are enforced with a transactional counter, so double-clicks or two devices can't bypass them. Reopening an unfinished attempt resumes it.
- Answers/explanations are shown according to the quiz's policy: right after submit, after the exam closes, or never.
- Weekly quiz: live exam inside a time window (own attempt limit) plus practice attempts (own limit). Topic quiz: practice only.

**Admin:** Question bank (create/edit with status workflow draft → ai_generated → approved → published / rejected), Quiz builder
(pick published questions, duration, marking, negative marking, attempts, randomisation, reveal policy, window, departments).
Only *published* questions can be put in a published quiz.

**Student:** `/quiz` list, `/quiz/:id` (practice / exam), full-screen-style runner (timer, progress, next/previous, mark for review,
question palette, submit confirmation), `/results` (totals, average, best, topics to revise) and `/results/:id` (score, per-topic, answer review).

**Redeploy:** `firebase deploy --only firestore,storage,functions` (new indexes take a few minutes) then hosting.

## Phase 5 additions: AI provider layer + AI quiz generation
**Secrets (server only).** Set both, even if you only use one; put the word `unused` for the one you don't have:
```bash
firebase functions:secrets:set GEMINI_API_KEY
firebase functions:secrets:set OPENAI_API_KEY
```
**Architecture.** `functions/src/ai/`: `types.ts` (the `AIProvider` interface), `base.ts` (shared prompts, JSON parsing, retries,
usage logging), `gemini.ts` / `openai.ts` (each only implements one HTTP call), `registry.ts` (reads the admin's routing from
`settings/aiRouting`). To add a vendor: write one small class extending `BaseProvider`, add it to `registry.ts`.
The interface already includes `generateQuiz`, `generateExplanation`, `answerHomework`, `chat`, `analyzeLearningPattern`;
Phase 8 and 9 just call them.

**Admin → AI settings:** choose provider, model and temperature for the default and per task; "Test connection" checks a key + model works.
Use a model name that exists on YOUR provider account (the built-in default is only a starting suggestion).

**Admin → AI generator:** pick 1 to 5 materials of one subject, number of questions, difficulty mix (e.g. 70/20/10) and types.
The model is instructed to use only that material. Everything it returns is validated (4 distinct options, one valid answer,
no duplicates, complete explanation); bad items are discarded and reported. Results are saved as **`ai_generated`**, never published.
AI questions must be **approved** before they can be **published** (enforced on the server, also for bulk actions).

**Question bank = review queue:** filter by status, select many, Approve / Publish / Reject; open any question to edit it first.

**Privacy/cost:** `aiRequests` logs task, model, tokens, latency and status only. Prompts and student text are not stored.
Generation is rate-limited to 20 per admin per hour.

**Known limits:** generation uses the material's typed fields (summary, points, formulas, definitions, examples, homework).
PDF/image text extraction is not wired yet. No automatic fallback to a second provider if the first is down.

## Phase 6 additions: notifications (in-app + push)
**One-time setup for push**
1. Firebase Console → Project settings → Cloud Messaging → *Web Push certificates* → Generate key pair. Put the public key in `.env` as `VITE_FIREBASE_VAPID_KEY`.
2. On deploy, the CLI asks for `APP_URL` (your hosting URL, e.g. `https://your-project.web.app`). It is used so tapping a push opens the right page.
3. Push needs HTTPS (Firebase Hosting has it). On iPhone, the site must be added to the Home Screen first; without push the in-app bell still works.
4. Redeploy everything: `firebase deploy --only firestore,storage,functions,hosting`. New indexes take a few minutes.

**What is sent automatically**
| Event | Who |
|---|---|
| Class material published (first time) | students in the material's departments |
| Quiz published | students in the quiz's departments |
| Weekly quiz: morning of quiz day (from 8 AM Dhaka) and 15 minutes before | students in those departments |
| Exam closed (only for quizzes that reveal answers after close) | students who took the exam |
| Staff announcement post | all students |
| Comment on your post | the post's author |
| Verification approved / rejected / re-upload | that student |
| Plan ends in 3 days, plan expired | that student |

Admin → **Notify** sends a custom message to all students, a department, a class/section, or one student (by student ID), and can be marked *important* to bypass the announcement mute.

**How it works / security**
- Everything is sent from Cloud Functions (`lib/notify.ts`). Clients can't create notifications or read device tokens (`fcmTokens` is functions-only).
- Each student has an in-app inbox (bell) with unread count, and can turn categories off (quizzes, material, announcements, comments) and push on/off per device in Profile. Payment, subscription and verification messages can't be muted.
- Reminders are idempotent (a transaction flag per quiz), and rescheduling a quiz resets its flags. Dead device tokens are pruned automatically.
- Section broadcasts match the section text exactly as students typed it.

## Phase 7 additions: subscription + bKash/Nagad payments (no merchant account)
**Principle:** `/payment/success` and `/payment/failure` only *display* what the server recorded. Subscription activation happens
in exactly one place (`payments/settle.ts`, one transaction). Typing the success URL by hand unlocks nothing.

**Flow**
1. Student taps *Pay with bKash/Nagad* → server creates a payment (amount from admin settings, 30-minute window) and shows your number.
2. Student sends money from their own bKash/Nagad app, then enters the **transaction ID** and the **number they paid from**.
3. Server confirms it in one of two ways:
   - **Automatic:** your phone forwards the "money received" SMS to the `paymentSmsWebhook` function. The server matches TrxID + amount ≥ price + same sender number, marks it used, and activates the plan within seconds.
   - **Manual:** Admin → Payments → *Waiting for confirmation* → Approve/Reject after checking your own bKash/Nagad app. Approved/rejected actions are audit-logged.
4. Success → `/payment/success` (receipt). Failure → `/payment/failure` (plain-language reason, *Try again*, *Back to dashboard*).

**After success:** plan = active, valid until = max(now, remaining time) + 30 days × months paid (paying 2× the price gives 2 months, up to 12); premium features unlock; in-app + push
"Payment successful"; receipt in payment history; reminder 3 days before expiry.
**After failure:** access unchanged, reason shown (not found, amount too low, sender mismatch, TrxID already used, too old, expired, cancelled, rejected by admin), *Try again* keeps history.

**Abuse protection:** one TrxID can be used once (`paymentIdempotency`), sender number must match the SMS, amount must cover the price, per-user rate limits, unconfirmed payments fail after 12 h, all records server-written.

**Setup**
```bash
openssl rand -hex 24                       # make a long random string
firebase functions:secrets:set PAYMENT_WEBHOOK_SECRET
firebase deploy --only functions,firestore
```
Then in Admin → Settings: tick *Accept payments* and enter your bKash and/or Nagad number.

**SMS forwarding (for automatic confirmation):** install an Android SMS-forwarder app on the phone that receives the payments. Configure it to POST JSON
`{"from":"%from%","message":"%text%"}` (use the app's own placeholders) to the `paymentSmsWebhook` URL (shown in the Firebase console after deploy) with header
`x-webhook-secret: <your secret>`. Without it, everything still works through manual approval.
**Important:** the SMS reader was written against *example* bKash/Nagad wording. Send yourself a few real payments first. Unreadable messages appear in Admin → Payments → *Messages we couldn't read*.

**Limits to know:** personal-number "Send Money" has no official API, so confirmation depends on the forwarded SMS or your manual check. If you later get an official gateway,
add it as another confirmation source that calls `settlePayment`; the pages and rules stay the same. bKash/Nagad terms for personal accounts used for business are theirs to decide; check them.

## Phase 8 additions: AI assistants + student chat
**AI study assistant (`/ai`)** answers from the student's own published class notes (latest 3 classes or one chosen class) plus their weak quiz topics.
Quick prompts: explain today's class, practice questions, what to revise, weekly-quiz prep. Nothing is stored. Every answer carries an "AI-generated, not official" note.

**Homework help (`/homework`)**: type or photograph a question, then *hint*, *step by step*, or *similar example*, optionally grounded in a class material.
Photos go to a private folder, are read once by the server, then deleted. Past Q&A is kept for the student only (deletable). Limits: 20/hour and 60/day.
Photo reading needs a vision-capable model in Admin → AI settings (the Homework task can use its own model).

**Chat (`/chat`)**: one-to-one chats (search classmates by name) and admin-created class groups (by department and optional section).
Messages go through Cloud Functions (length limit, 25 msgs/min, block + restriction checks). Blocking hides both directions; students can report a message (a copy is kept as evidence).
One-to-one messages notify the recipient at most once every 2 minutes. Chat is text only for now (no media).
**Privacy:** admins can read class-group chats, but private DMs are visible to admins only as report evidence.

**Admin → Reports:** dismiss (restores auto-hidden posts), remove, remove + restrict chat, or remove + suspend, all audit-logged.
**Admin → Chat groups:** create/delete groups. **Students → Actions:** restrict/restore a student's chat.
**One-time step:** after deploying, existing students need a searchable name. Call `adminBackfillPublicProfiles` once (or just have each student save their profile).

## Launch checklist (in order)
1. Firebase project on Blaze; enable Auth (Email + Google), Firestore (asia-south1), Storage, Cloud Messaging.
2. `.env` from `.env.example`; `.firebaserc` project id.
3. Secrets: `IDENTITY_HMAC_PEPPER`, `GEMINI_API_KEY`, `OPENAI_API_KEY` (use `unused` for a key you don't have), `PAYMENT_WEBHOOK_SECRET`. Set `APP_URL` when prompted.
4. `npm install && npm --prefix functions install`
5. `firebase deploy --only firestore,storage,functions` then `npm run build && firebase deploy --only hosting` (indexes take a few minutes).
6. Cloud Console → IAM: give the functions service account *Service Account Token Creator* (ID-image links).
7. Create the superadmin (`functions/scripts/setSuperAdmin.js`), import the roster (Admin → Roster).
8. Admin → Settings: trial, price, payment numbers, *Accept payments*. Admin → AI settings: pick models, press *Test connection*.
9. Add subjects, a class material, a few questions, then publish a test quiz. Register a test student and walk the whole path.
10. Emulator-test the security rules (`firebase emulators:start`) before real users. They were written carefully but **have not been run against the emulator yet**.

## Phase 9 additions: analytics + learning insights
**Student → `/insights`** (private): score trend, quizzes per week, accuracy by subject / topic / difficulty, time per question, skipped rate, streak,
plus **study tips**. Tips are computed from the student's own results on the server (rule-based, always available) and, when an AI model is configured for the
*Learning pattern analysis* task, rewritten by AI from **aggregate numbers only** (no name, ID or contact details go to the provider). Replies are filtered
so nothing about personality, mental health or ability can appear, and the page says these are study tips, not an assessment. Cached for 24 h; 8 refreshes/day.

**Admin → Analytics:** daily and weekly active students, engagement %, quiz participation, average score, new students, payments/revenue, students by plan
(paid / trial / expired / none), paid share after trial, subject performance and "topics students struggle with". Everything is read from **anonymous daily summaries**
(`analyticsDaily`) built nightly at 00:30 Dhaka time; admins never query individual students for analytics. Press **Rebuild 30 days** once after deploying to fill the charts.
"Active" is recorded once per student per day by `pingActive` (no page-level tracking); records are kept 90 days.

**Public profiles (`/students/:uid`):** name, department, session, photo, and quiz numbers only if the student set *Scores: public* in Profile. Never email, phone, ID or topics.
Quiz results now also record per-subject and per-difficulty accuracy; quizzes taken before this update simply lack those breakdowns.

**Redeploy:** `firebase deploy --only firestore,functions` then hosting.

## Still to do before real users
Run the security rules in the emulator; run a real end-to-end pass (register → verify → trial → material → quiz → pay → chat); get Privacy Policy/Terms reviewed;
enable App Check and admin MFA; test real bKash/Nagad SMS wording. (Phase 10 = security audit + performance + deployment polish.)
