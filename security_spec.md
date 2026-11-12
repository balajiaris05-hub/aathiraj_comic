# Security Specification (`security_spec.md`) — Aathirai_Comic Firestore Architecture

## 1. Data Invariants
1. **Default-Deny Catch-All**: All paths under `/databases/{database}/documents/{document=**}` are denied by default unless explicitly matched.
2. **Email Verification & Bootstrapped Admin**: All writes require `isSignedIn() && request.auth.token.email_verified == true`. Admin status (`isAdmin()`) requires either an existing `/admins/$(request.auth.uid)` document OR the bootstrapped verified runtime owner email (`request.auth.token.email == 'balajiaris05@gmail.com' && request.auth.token.email_verified == true`).
3. **Split-Collection PII Isolation**: Public user profile fields (`userId`, `name`, `role`, `createdAt`, `updatedAt`) live at `/users/{userId}`, while customer PII and payment details (`email`, `phone`, `upiId`, `age`, `premiumPlan`, `paymentMethod`, `transactionId`, `amountPaidInr`) are strictly isolated in `/users/{userId}/private/{infoId}`, readable and writable only by `isOwner(userId)` or `isAdmin()`, and requiring parent `/users/{userId}` existence (`get()` Master Gate).
4. **Prevent Self-Assigned Roles**: On `/users/{userId}` creation, non-admins can only set `role == 'reader'`. Furthermore, `userId` and `createdAt` are immutable on updates.
5. **Relational Existence & Terminal State Locking**:
   - Creating a `/purchases/{purchaseId}` requires `exists(/databases/$(database)/documents/users/$(incoming().userId))`. Once a purchase reaches `status == 'refunded'`, further updates are locked unless `isAdmin()`.
   - Creating a `/deleteRequests/{requestId}` requires `exists(/databases/$(database)/documents/comics/$(incoming().comicId))` and `incoming().authorId == request.auth.uid`. Once a delete request reaches terminal status (`approved` or `rejected`), non-admin updates are blocked.

---

## 2. The "Dirty Dozen" Payloads (Designed to Break Identity, Integrity & State)

1. **Payload 1 — Shadow Field Injection on `/users/{userId}`**:
   ```json
   { "userId": "uid_1", "name": "Ravi", "role": "reader", "isSuperAdmin": true, "createdAt": "SERVER_TIME", "updatedAt": "SERVER_TIME" }
   ```
   *Blocked by*: `data.keys().hasOnly(['userId', 'name', 'role', 'createdAt', 'updatedAt'])`.

2. **Payload 2 — Self-Assigned Admin Role Escalation on `/users/{userId}`**:
   ```json
   { "userId": "uid_attacker", "name": "Attacker", "role": "admin", "createdAt": "SERVER_TIME", "updatedAt": "SERVER_TIME" }
   ```
   *Blocked by*: `incoming().role == 'reader' || isAdmin()`.

3. **Payload 3 — Unverified Email Spoofing of Bootstrapped Admin**:
   ```json
   { "auth": { "uid": "uid_spoof", "token": { "email": "balajiaris05@gmail.com", "email_verified": false } } }
   ```
   *Blocked by*: `isVerifiedUser()` checking `request.auth.token.email_verified == true`.

4. **Payload 4 — Cross-User PII Read on `/users/uid_victim/private/info`**:
   Authenticated as `uid_other` attempting `get` on `/users/uid_victim/private/info`.
   *Blocked by*: `allow get: if isValidId(userId) && isValidId(infoId) && (isOwner(userId) || isAdmin());`.

5. **Payload 5 — Orphaned Subcollection Write on `/users/uid_1/private/info` Without Parent `/users/uid_1`**:
   ```json
   { "userId": "uid_1", "email": "a@gmail.com", "phone": "+919999999999", "upiId": "a@okaxis", "age": 24, "premiumPlan": "1_month", "paymentMethod": "UPI", "transactionId": "TX1", "amountPaidInr": 49, "createdAt": "SERVER_TIME", "updatedAt": "SERVER_TIME" }
   ```
   *Blocked by*: Master Gate `get(/databases/$(database)/documents/users/$(userId)).data.userId == userId`.

6. **Payload 6 — ID Poisoning (2KB Document ID)**:
   Path `/comics/aaaa...2000_chars`
   *Blocked by*: `isValidId(comicId)` checking `id.size() >= 1 && id.size() <= 128 && id.matches('^[a-zA-Z0-9_\\-]+$')`.

7. **Payload 7 — Value Poisoning on Update (Invalid Type / Oversized String)**:
   Updating `/users/uid_1` with `name` set to a 5,000-character string or boolean.
   *Blocked by*: `isValidUserPublicProfile(incoming())` wrapping the `allow update` block and checking `data.name is string && data.name.size() >= 1 && data.name.size() <= 80`.

8. **Payload 8 — Immutable Field Mutation (`createdAt` or `userId` Modification)**:
   Updating `/users/uid_1` where `incoming().createdAt != existing().createdAt`.
   *Blocked by*: `incoming().createdAt == existing().createdAt && incoming().userId == existing().userId`.

9. **Payload 9 — Client-Forged Timestamp on Create**:
   Creating `/purchases/pur_1` with `createdAt` in the past (`2020-01-01T00:00:00Z`).
   *Blocked by*: `incoming().createdAt == request.time && incoming().updatedAt == request.time`.

10. **Payload 10 — Unauthorized Blanket List Query on `/purchases`**:
    Client queries `/purchases` without filtering `resource.data.userId == request.auth.uid`.
    *Blocked by*: `allow list: if isVerifiedUser() && (resource.data.userId == request.auth.uid || isAdmin());`.

11. **Payload 11 — Terminal State Re-Opening on `/deleteRequests/{requestId}`**:
    Author attempts to update a delete request whose `existing().status` is already `'approved'` or `'rejected'`.
    *Blocked by*: Terminal state gate `existing().status == 'pending'`.

12. **Payload 12 — Orphaned Purchase Creation for Non-Existent User**:
    Creating `/purchases/pur_99` with `userId: 'usr_nonexistent'`.
    *Blocked by*: `exists(/databases/$(database)/documents/users/$(incoming().userId))`.

---

## 3. Red Team Conflict Report
- **Identity Spoofing**: Blocked on every collection (`incoming().userId == request.auth.uid` / `incoming().authorId == request.auth.uid`).
- **State Shortcutting & Terminal Locking**: Enforced on `/purchases` (`existing().status == 'success'`) and `/deleteRequests` (`existing().status == 'pending'`).
- **Resource & Value Poisoning**: Every string has explicit `.size() >= min && .size() <= max` bounds matching `firebase-blueprint.json`, and every `allow update` starts with `isValid[Entity](incoming())`.
