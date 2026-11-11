# Implementation Plan: Fix Edit Episode Button & Author Deletion Requests Queue

Fix the non-working **Edit Episode** button in the Admin Publishing Studio and resolve the issue where **Author Deletion Requests** (series, chapter, and episode) fail to submit or display in the Admin Portal's Delete Requests tab.

---

## 1. Problem Diagnosis & Root Causes

1. **Edit Episode Button Ineffective (CSS Selector 1)**:
   - In `src/components/AdminPublishingStudio.tsx`, clicking the Edit Episode button (`button:nth-of-type(1)` with `<Edit3>`) invokes `handleStartEditEpisode(ep, ch.id)`.
   - While state values (`editingEpisode`, `editEpisodeTitle`, `editEpisodeSynopsis`, `editEpisodeIsPremium`, `editEpisodePrice`) are set, **no modal or UI is rendered for `editingEpisode` in the JSX**. As a result, clicking the button produces no visual feedback or editable interface.

2. **Author Deletion Requests Not Reaching Admin (CSS Selector 2)**:
   - In `src/pages/AuthorDashboard.tsx`, functions `handleSubmitDeleteRequestToAdmin` and `handleSendEpisodeDeleteRequest` rely on `window.prompt(...)` to capture the deletion reason.
   - In browser iframe sandboxes, `window.prompt` is blocked or returns `null`, aborting `if (note === null) return;` before calling `POST /api/author/comics/request-delete`.
   - In addition, there was no dedicated UI modal for authors to confirm and type deletion request reasons for chapters and series.
   - In `server.ts`, the `deleteRequests` collection starts empty with no initial seed requests, meaning the Admin Portal had no sample requests to review.

---

## 2. Proposed Changes

### Component 1: `src/components/AdminPublishingStudio.tsx`
- **Render Dedicated Edit Episode Modal**:
  - Implement a popup modal when `editingEpisode !== null`.
  - Fields included:
    - **Episode Title** (text input with auto-focus).
    - **Episode Synopsis** (textarea).
    - **Access Model**: Toggle between **Free** and **Premium**.
    - **Episode Price (₹ INR)**: Visible and editable when marked Premium.
    - Attached pages count preview & cover thumbnail.
    - **Buttons**: "Cancel" (`setEditingEpisode(null)`) and "Save Changes" (`handleSaveEpisodeEdit`).
  - Wire to `handleSaveEpisodeEdit` which sends `PUT /api/comics/:comicId/chapters/:chapId/episodes/:epId`, triggers `onRefreshComics()`, `fetchAdminData()`, and displays a toast confirmation.

### Component 2: `src/pages/AuthorDashboard.tsx`
- **Replace Blocked `prompt()` with In-App Deletion Request Modal**:
  - Introduce an interactive modal state `authorDeleteRequestTarget: { type: 'series' | 'chapter' | 'episode'; comicId: string; comicTitle: string; chapterId?: string; chapterTitle?: string; episodeId?: string; episodeTitle?: string } | null`.
  - Add an input for optional author notes/reasons directly in the modal.
  - Add "Send Request to Admin" button next to chapters in the chapter header so authors can request chapter deletion without relying on prompt.
  - Successfully submitting sends `POST /api/author/comics/request-delete`, updates comic status to `delete_requested`, updates author feedback banner, and triggers `onRefreshComics()`.

### Backend: `server.ts`
- **Seed Initial Pending Author Deletion Requests**:
  - Seed initial pending requests for series, chapter, and episode in `server.ts` so the Admin Portal's Delete Requests tab (`button:nth-of-type(4)`) immediately displays actionable items.
  - Ensure `GET /api/admin/delete-requests` correctly synchronizes any comics with `moderationStatus === 'delete_requested'`.
  - Ensure `POST /api/admin/delete-requests/:id/action` correctly handles `approve` (executes deletion) and `reject` with logging.

### Component 3: `src/pages/AdminDashboard.tsx`
- **Refine Delete Requests Tab (CSS Selector 2)**:
  - Ensure the tab badge correctly reflects pending delete requests.
  - Provide clear action cards with comic covers, target type chips (Series, Chapter, Episode), author info, submission time, reason, and one-click "Approve & Execute Deletion" and "Reject Request" actions.
  - Immediately refresh admin metrics and catalogue on approval/rejection.

---

## 3. Verification Plan

1. **Edit Episode Modal**:
   - Go to Admin Publishing Studio (`My Comic & Episode / Upload New Comic`).
   - Select any comic and expand a chapter.
   - Click the pencil icon (`Edit Episode`) on an episode.
   - Verify the Edit Episode modal appears with title, synopsis, and price fields.
   - Edit the title, toggle to Free/Premium, click Save, and verify the episode updates in the UI and server.

2. **Author Deletion Request Flow**:
   - As an author in Author Dashboard, select a comic, chapter, or episode and click "Request Admin Delete".
   - Verify the in-app modal opens without browser `prompt()` blocking.
   - Submit the deletion request with a note.
   - Verify the submission feedback banner appears.

3. **Admin Delete Requests Tab**:
   - Switch to Admin Dashboard and click the **🗑️ Delete Requests** tab (`button:nth-of-type(4)`).
   - Verify all pending requests (series, chapter, episode) are displayed with full details.
   - Click "Approve & Execute Deletion" on an item and verify it is permanently deleted from the database and removed from the queue.
   - Click "Reject Request" and verify the item status updates to rejected.

4. **Applet Compilation & Linting**:
   - Run `compile_applet` and `lint_applet` to verify clean build with zero TypeScript or ESLint errors.
