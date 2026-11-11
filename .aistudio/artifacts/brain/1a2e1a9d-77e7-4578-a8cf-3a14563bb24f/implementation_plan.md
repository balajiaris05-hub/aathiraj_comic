# Implement "My Comic & Episode / Upload New Comic" Studio in Admin Portal

Port the complete comic series management, chapter & episode breakdown, multi-photo page attachments, cover page selector, and new comic creation studio from the Author Publishing Studio into a dedicated tab in the Platform Administration Console.

## User Review & Critical Decisions

> [!IMPORTANT]
> The new tab **"My Comic & Episode / Upload New Comic"** will be positioned directly adjacent to **Overview Metrics** in the Admin console navigation. It brings the full, battle-tested publishing suite from the Author Studio to administrators with full direct publishing privileges (bypassing approval queues).

- **Tab Position & Name**: Positioned directly next to Overview Metrics with label: `My Comic & Episode / Upload New Comic`.
- **Integrated Dual Sub-Modes**:
  1. **My Comics & Episodes**: Full series list, chapter hierarchy, inline chapter/episode editing, direct multi-photo episode page uploader, cover page picker, and interactive live reader preview modal.
  2. **Upload New Comic**: Full new comic series creator with metadata, genre selection, pricing controls, multi-photo manuscript upload, and cover page selection from attached artwork.
- **Direct Admin Publishing**: When admin creates a comic or publishes an episode through this studio, it is immediately marked as approved and live for readers.

---

## 1. Overview & Core Concept

- **What It Does**: Enables administrators to directly manage all comic series, chapters, and episodes, attach multiple page photos, choose custom episode covers from uploaded artwork, preview episodes in vertical or page-by-page reader mode, and publish new comic titles directly from the Admin console.
- **Target Audience**: Platform administrators managing editorial releases and original platform publications.

---

## 2. User Experience & Visual Design

### Tab Placement & Controls
- **Sub-Navigation**: Added right next to "Overview Metrics":
  ```
  [Overview Metrics] [My Comic & Episode / Upload New Comic] [Comic Approvals Queue] ...
  ```
- **Studio Sub-Switcher**: Toggle within the tab to seamlessly switch between:
  - 📚 **My Comics & Episodes Breakdown**
  - ✨ **Upload New Comic Series**

### Key User Flows in "My Comics & Episodes"
1. **Series Sidebar**: Browse all platform comics with cover art, status badge, chapter count, view counts, and rating metrics. Click any comic to activate it.
2. **Series Control Bar**: View selected comic title, status, and attached manuscript info. Actions:
   - ✏️ **Edit Comic Details**: Modal to update title, premise, genre tags, and pricing.
   - 🗑️ **Delete Manager**: Modal to delete an episode, a chapter, or the whole series.
3. **Chapter & Episode Hierarchy**:
   - Quick "Add Chapter" form.
   - Per-chapter listing with episode count and inline title editing.
   - Inline episode editing (title, synopsis, premium toggle, price).
4. **Episode & Page Upload Section**:
   - Target Chapter dropdown.
   - Episode Title & Synopsis inputs.
   - Premium episode toggle and INR pricing.
   - Multi-photo upload dropzone supporting 50+ comic artwork photos.
   - **Interactive Cover Page Picker**: Select any uploaded page to serve as the episode thumbnail.
   - Page re-ordering (Move Earlier / Move Later) and per-page deletion.
   - **Live Reader Preview Modal**: Preview before publishing with vertical webtoon scroll or page-by-page flip mode, zoom levels, and thumbnail navigation drawer.
   - **Publish Directly Button**: Instantly publishes the episode live to readers.

### Key User Flows in "Upload New Comic"
1. Input Series Title, Description, and Genre tags.
2. Select Access Type (100% Free vs Premium with full price & per-episode pricing).
3. Attach multiple high-resolution comic pages via dropzone.
4. Select the cover page directly from uploaded images.
5. Create comic: Instantly saved and live on the website catalog.

---

## 3. Technical Architecture & Implementation Steps

```
┌────────────────────────────────────────────────────────┐
│                   Admin Dashboard                      │
│        (src/pages/AdminDashboard.tsx)                  │
└──────────────────────────┬─────────────────────────────┘
                           │
    ┌──────────────────────┴──────────────────────┐
    ▼                                             ▼
[Tab Navigation]                          [Active Studio View]
 - Overview Metrics                         ├─ Mode 1: Comics & Episodes
 - My Comic & Episode / Upload New Comic ───┤   • Comic Sidebar List
 - Comic Approvals Queue                    │   • Chapter/Episode Hierarchy
 - Delete Requests                          │   • Episode Multi-Page Upload
 - Paywall & Catalog                        │   • Cover Selection Grid
                                            │   • Live Reader Preview Modal
                                            └─ Mode 2: Upload New Comic
                                                • Series Form & Metadata
                                                • Page Attachment Dropzone
                                                • Cover Page Picker
                                                • Direct Publish Action
```

### Execution Steps
1. **State Integration in `AdminDashboard.tsx`**:
   - Add tab ID `'my-comics-episodes-upload'` to `activeTab` union.
   - Port all needed state hooks from `AuthorDashboard.tsx` (selected comic, episode attached pages, cover page selection, editing modals, live preview modal state).
2. **Handlers & Endpoints**:
   - Use `/api/comics` for series creation and updates.
   - Use `/api/comics/:id/chapters` for chapter additions and edits.
   - Use `/api/comics/:comicId/chapters/:chapId/episodes` for multi-page episode publishing.
   - Connect live refresh (`onRefreshComics()` & `fetchAdminData()`).
3. **Template & UI Layout**:
   - Place the tab button immediately after "Overview Metrics".
   - Render the complete Author Studio layout with dual mode toggle.
   - Include both supporting modals: Edit Comic Modal and Live Reader Preview Modal.
4. **Build & Lint Verification**:
   - Execute `compile_applet` and `lint_applet` together to verify zero syntax and type errors.
