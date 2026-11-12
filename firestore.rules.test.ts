/**
 * Firestore Security Rules Verification Suite (Dirty Dozen Payloads)
 * Verifies that all 12 adversarial payloads defined in security_spec.md return PERMISSION_DENIED.
 */

export interface SecurityPayloadTest {
  id: number;
  name: string;
  collectionPath: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  auth: { uid: string; email?: string; email_verified?: boolean } | null;
  payload?: Record<string, unknown>;
  expectedOutcome: 'PERMISSION_DENIED';
}

export const DIRTY_DOZEN_TESTS: SecurityPayloadTest[] = [
  {
    id: 1,
    name: 'Shadow Field Injection on /users/{userId}',
    collectionPath: '/users/uid_1',
    operation: 'create',
    auth: { uid: 'uid_1', email: 'reader@gmail.com', email_verified: true },
    payload: {
      userId: 'uid_1',
      name: 'Ravi',
      role: 'reader',
      isSuperAdmin: true,
      createdAt: 'SERVER_TIME',
      updatedAt: 'SERVER_TIME',
    },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 2,
    name: 'Self-Assigned Admin Role Escalation on /users/{userId}',
    collectionPath: '/users/uid_attacker',
    operation: 'create',
    auth: { uid: 'uid_attacker', email: 'attacker@gmail.com', email_verified: true },
    payload: {
      userId: 'uid_attacker',
      name: 'Attacker',
      role: 'admin',
      createdAt: 'SERVER_TIME',
      updatedAt: 'SERVER_TIME',
    },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 3,
    name: 'Unverified Email Spoofing of Bootstrapped Admin',
    collectionPath: '/admins/uid_spoof',
    operation: 'create',
    auth: { uid: 'uid_spoof', email: 'balajiaris05@gmail.com', email_verified: false },
    payload: {
      adminId: 'uid_spoof',
      email: 'balajiaris05@gmail.com',
      createdAt: 'SERVER_TIME',
    },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 4,
    name: 'Cross-User PII Read on /users/uid_victim/private/info',
    collectionPath: '/users/uid_victim/private/info',
    operation: 'get',
    auth: { uid: 'uid_other', email: 'other@gmail.com', email_verified: true },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 5,
    name: 'Orphaned Subcollection Write on /users/uid_no_parent/private/info',
    collectionPath: '/users/uid_no_parent/private/info',
    operation: 'create',
    auth: { uid: 'uid_no_parent', email: 'reader@gmail.com', email_verified: true },
    payload: {
      userId: 'uid_no_parent',
      email: 'reader@gmail.com',
      phone: '+919876543210',
      upiId: 'reader@okaxis',
      age: 24,
      premiumPlan: '1_month',
      paymentMethod: 'UPI',
      transactionId: 'UPI-12345',
      amountPaidInr: 49,
      createdAt: 'SERVER_TIME',
      updatedAt: 'SERVER_TIME',
    },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 6,
    name: 'ID Poisoning with Invalid Characters',
    collectionPath: '/comics/invalid$id!@#',
    operation: 'create',
    auth: { uid: 'uid_admin', email: 'balajiaris05@gmail.com', email_verified: true },
    payload: {},
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 7,
    name: 'Value Poisoning on Update (Oversized Name String)',
    collectionPath: '/users/uid_1',
    operation: 'update',
    auth: { uid: 'uid_1', email: 'reader@gmail.com', email_verified: true },
    payload: {
      userId: 'uid_1',
      name: 'A'.repeat(500),
      role: 'reader',
      createdAt: 'SERVER_TIME',
      updatedAt: 'SERVER_TIME',
    },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 8,
    name: 'Immutable Field Mutation (Changing createdAt)',
    collectionPath: '/users/uid_1',
    operation: 'update',
    auth: { uid: 'uid_1', email: 'reader@gmail.com', email_verified: true },
    payload: {
      userId: 'uid_1',
      name: 'Updated Name',
      role: 'reader',
      createdAt: '2099-01-01T00:00:00Z',
      updatedAt: 'SERVER_TIME',
    },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 9,
    name: 'Client-Forged Timestamp on Purchase Create',
    collectionPath: '/purchases/pur_1',
    operation: 'create',
    auth: { uid: 'uid_1', email: 'reader@gmail.com', email_verified: true },
    payload: {
      purchaseId: 'pur_1',
      userId: 'uid_1',
      comicId: 'premium_pass',
      itemTitle: '1 Month Pass',
      planType: '1_month',
      amountInr: 49,
      upiId: 'reader@okaxis',
      paymentMethod: 'UPI',
      receiptNumber: 'INV-1001',
      status: 'success',
      createdAt: '2020-01-01T00:00:00Z',
      updatedAt: '2020-01-01T00:00:00Z',
    },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 10,
    name: 'Unauthorized Blanket List Query on /purchases by Other User',
    collectionPath: '/purchases',
    operation: 'list',
    auth: { uid: 'uid_other', email: 'other@gmail.com', email_verified: true },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 11,
    name: 'Terminal State Re-Opening on Approved /deleteRequests/{requestId}',
    collectionPath: '/deleteRequests/req_approved',
    operation: 'update',
    auth: { uid: 'uid_author', email: 'author@gmail.com', email_verified: true },
    payload: {
      status: 'pending',
    },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 12,
    name: 'Orphaned Purchase Creation for Non-Existent User',
    collectionPath: '/purchases/pur_orphan',
    operation: 'create',
    auth: { uid: 'uid_missing', email: 'missing@gmail.com', email_verified: true },
    payload: {
      purchaseId: 'pur_orphan',
      userId: 'uid_missing',
      comicId: 'premium_pass',
      itemTitle: '1 Month Pass',
      planType: '1_month',
      amountInr: 49,
      upiId: 'missing@okaxis',
      paymentMethod: 'UPI',
      receiptNumber: 'INV-9999',
      status: 'success',
      createdAt: 'SERVER_TIME',
      updatedAt: 'SERVER_TIME',
    },
    expectedOutcome: 'PERMISSION_DENIED',
  },
];
