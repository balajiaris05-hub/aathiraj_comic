# Security Specification (`security_spec.md`) — Aathirai_Comic Firestore Architecture

## 1. Data Invariants & Collection Architecture (15 Collections)
1. **Default-Deny Catch-All**: All paths under `/databases/{database}/documents/{document=**}` are denied by default unless explicitly matched.
2. **Email Verification & Bootstrapped Admin**: All client mutations require `isSignedIn() && request.auth.token.email_verified == true` (`isVerifiedUser()`). Admin status (`isAdmin()`) requires either an existing `/admins/$(request.auth.uid)` document OR the bootstrapped verified runtime owner email (`request.auth.token.email == 'balajiaris05@gmail.com' && request.auth.token.email_verified == true`).
3. **Split-Collection PII Isolation**: Public non-PII user profiles (`userId`, `name`, `role`, `createdAt`, `updatedAt`) live at `/users/{userId}`, while customer PII and payment details (`email`, `phone`, `upiId`, `age`, `premiumPlan`, `paymentMethod`, `transactionId`, `amountPaidInr`) are strictly isolated in `/users/{userId}/private/{infoId}`, readable/writable only by `isOwner(userId)` or `isAdmin()`, guarded by parent `/users/{userId}` Master Gate (`get()`).
4. **Catalog & Hierarchical Episodes**: `/comics/{comicId}` and `/comics/{comicId}/episodes/{episodeId}` allow public reads strictly when `status == 'published'` (enforced at both `get` and `list` levels via `resource.data.status == 'published'`), while drafts/pending submissions are visible only to the owning author or `isAdmin()`.
5. **Community Engagement (`/comments`, `/ratings`, `/votes`, `/reports`)**: Protected with `isVerifiedUser()`, strict parent `/comics/{comicId}` & `/users/{userId}` existence checks on creation, `userId == request.auth.uid` anti-spoofing, and action-scoped `affectedKeys().hasOnly(...)` updates.
6. **Monetization & Administration (`/purchases`, `/notifications`, `/authorApplications`, `/deleteRequests`, `/gstSettings`, `/platformSettings`)**: Relational existence checks (`exists(...)`), terminal state locks on refunded purchases and decided applications/delete requests, and admin-only mutations on GST/Platform settings.

---

## 2. The "Dirty Dozen" Payloads (Adversarial Hardening)

1. **Shadow Field Injection on `/users/{userId}`**: Injecting `"isSuperAdmin": true` -> Blocked by `data.keys().hasOnly(...)`.
2. **Self-Assigned Admin Role Escalation on `/users/{userId}`**: Setting `"role": "admin"` on registration -> Blocked by `incoming().role == 'reader' || isAdmin()`.
3. **Unverified Email Spoofing of Bootstrapped Admin**: Token with `email: "balajiaris05@gmail.com", email_verified: false` -> Blocked by `isVerifiedUser()`.
4. **Cross-User PII Read on `/users/{uid}/private/info`**: Non-owner reads private doc -> Blocked by `isOwner(userId) || isAdmin()`.
5. **Orphaned Subcollection Write on `/users/{uid}/private/info`**: Creating private doc without `/users/{uid}` -> Blocked by Master Gate `get(/databases/$(database)/documents/users/$(userId)).data.userId == userId`.
6. **ID Poisoning**: Non-alphanumeric or oversized (>128 char) IDs -> Blocked by `isValidId(id)`.
7. **Value Poisoning on Update**: Oversized/wrong-type fields on update -> Blocked because every `allow update` starts with `isValid[Entity](incoming())`.
8. **Immutable Field Mutation**: Changing `createdAt`, `userId`, `authorId`, or `comicId` on update -> Blocked by equality assertions (`incoming().field == existing().field`).
9. **Client-Forged Timestamp on Create**: Backdating `createdAt` -> Blocked by `incoming().createdAt == request.time`.
10. **Unauthorized Blanket List Query on `/purchases`**: Querying `/purchases` without `userId == request.auth.uid` -> Blocked by `allow list: if isVerifiedUser() && (resource.data.userId == request.auth.uid || isAdmin())`.
11. **Terminal State Re-Opening on `/deleteRequests` or `/authorApplications`**: Author mutating an approved/rejected record -> Blocked by `existing().status == 'pending'`.
12. **Privilege Escalation on `/gstSettings` or `/platformSettings`**: Non-admin creating/updating GSTIN or Razorpay URLs -> Blocked by `isAdmin()`.

---

## 3. Red Team Conflict Report
- **Identity Spoofing**: Mitigated on every user-authored collection (`userId == request.auth.uid` / `authorId == request.auth.uid` / `reporterId == request.auth.uid`).
- **State Shortcutting & Terminal Locking**: Enforced on `/purchases` (`success -> refunded` admin-only), `/authorApplications` (`pending` only for owner), `/deleteRequests` (`pending` only for author), `/reports` (admin moderation only), `/comics` & `/episodes` (moderation `status` changes restricted to `isAdmin()`).
- **Resource & Value Poisoning**: All 14 rule blocks enforce explicit `.size()` bounds and `isValid[Entity](incoming())` on both create and update.
