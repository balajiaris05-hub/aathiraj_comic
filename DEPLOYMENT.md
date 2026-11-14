# Aathirai_Comic — Production Architecture, Security & Deployment Guide

## 1. Security & Authentication Architecture
- **Password Storage**: All reader, author, and admin passwords are hashed using Node.js cryptographic `scrypt` with a 16-byte random salt (`scrypt$<salt>$<derivedKey>`) and verified using `crypto.timingSafeEqual`. Legacy plaintext passwords from `aathirai_db.json` are automatically upgraded on startup.
- **Session Tokens & Firebase Auth**:
  - Upon login, registration verification, or Admin 2FA verification, the backend issues an `HMAC-SHA256` signed session token (`sessionToken`) with a 24-hour expiration window (`exp`).
  - Firebase Authentication (`firebase/auth`) and Firestore (`ai-studio-aathiraicomic-1a2e1a9d-77e7-4578-a8cf-3a14563bb24f`) are integrated for Google Sign-In, email/password authentication, and real-time cloud synchronization.
- **Role-Based Access Control (RBAC)**:
  - Roles (`reader`, `author`, `admin`) and suspension states (`isSuspended`) are resolved exclusively from the authoritative database.
  - The UI Role Switcher in the navigation bar is strictly restricted to development mode (`import.meta.env.DEV`) for UI previewing and never alters backend permissions.
- **Zero PII Exposure**:
  - `sanitizeUserForClient` strips `password`, `passwordHash`, and internal lockout counters from all API responses.
  - Public Author Profile views expose only public creator fields (`name`, `avatar`, `bio`, `socialLinks`, and published comics), keeping private phone numbers, emails, and UPI IDs isolated.

---

## 2. Razorpay Payment Integration (`UNCONFIGURED` / `TEST` / `LIVE` Modes)
Payment mode is determined exclusively on the backend (`getRazorpayEnvironmentStatus()` in `src/server/security.ts`) from `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`:
1. **`UNCONFIGURED` Mode**: When `RAZORPAY_KEY_ID` or `RAZORPAY_KEY_SECRET` is absent, `/api/payments/config` returns `mode: 'UNCONFIGURED'` and checkout buttons are disabled with a clear administrator configuration notice.
2. **`TEST` Mode (`rzp_test_*`)**: Displays a prominent amber warning banner (`TEST MODE ACTIVE — No real money will be charged`), creates server-side test orders, and verifies `HMAC-SHA256` signatures before recording transactions with `environment: 'test'`.
3. **`LIVE` Mode (`rzp_live_*`)**: Launches official `window.Razorpay` Checkout (`https://checkout.razorpay.com/v1/checkout.js`) and verifies the returned `razorpay_order_id`, `razorpay_payment_id`, and `razorpay_signature` via `HMAC-SHA256` before unlocking content and recording `environment: 'live'`.
4. **Webhooks & Idempotency**:
   - `/api/webhooks/razorpay` (and `/api/payments/webhook`) validates `x-razorpay-signature` using `HMAC-SHA256`.
   - Duplicate payment submissions are prevented via `idempotencyKey` lookup in `purchases` and `paymentTransactions`.

---

## 3. Firestore Migration & Rollback Procedures
- **Automatic Pre-Migration Backup**:
  - On startup, `StorageEngine` (`src/server/storage.ts`) computes the SHA-256 checksum of `aathirai_db.json` and writes a verified backup to `backups/aathirai_db.latest_backup.json`.
- **Normalized Firestore Collections Manifest**:
  - `StorageEngine` generates `firestore_collections/firestore_collections_manifest.json` containing normalized collections (`users`, `users_private`, `authorApplications`, `comics`, `chapters`, `episodes`, `comments`, `ratings`, `votes`, `purchases`, `paymentTransactions`, `notifications`, `reports`, `deleteRequests`, `copyrightDocs`, `platformSettings`, `activityLogs`) and a `MigrationAuditReport` (`migrationReport`).
- **Rollback Procedure**:
  - To roll back to the pre-migration snapshot at any time, copy `backups/aathirai_db.latest_backup.json` to `aathirai_db.json` and restart the server.

---

## 4. Build, Verification & Deployment Commands
```bash
# 1. Install dependencies
npm install

# 2. Run automated security, payment & migration verification tests
npx tsx tests/platform.test.ts

# 3. Type-check & lint
npm run lint

# 4. Build production frontend bundle
npm run build

# 5. Start production server (port 3000)
npm start
```
