# swaranidhi — Product Requirements Document

**Status:** v1 — implementation-ready
**Owner:** shankotai@gmail.com
**Date:** 2026-10-04

---

## 0. Resolved Design Decisions (reference table)

| Axis | Decision | Rationale (short) |
|---|---|---|
| Audience | Personal / trusted-few, manually added as OAuth test users | Avoids Google app-verification entirely |
| Drive scope | `https://www.googleapis.com/auth/drive.readonly` | Enables automatic recursive discovery; risk acceptable for trusted-few, single-token-per-browser model |
| Discovery | User-designated root folder(s), recursive BFS scan | Folder hierarchy becomes free album/artist structure; avoids indexing unrelated audio (voice memos, etc.) |
| Root folder selection | Manual paste of Drive folder URL/ID | One-time action per folder; avoids a second API key + Picker JS integration for a rare action |
| Metadata | Range-fetch + client-side ID3v2 parse (title/artist/album/embedded art) | Needed for a real library browser and for MediaSession lock-screen artwork on mobile |
| Streaming (v1) | Whole-file `fetch` → `Blob` → `URL.createObjectURL`; no MSE | Actual library tops out at ~50–100MB (MP3/AAC); MSE complexity not justified |
| Large-file threshold | 30MB (`LARGE_FILE_THRESHOLD_BYTES`) | Matches point at which prefetch-induced double-blob memory becomes a concern |
| Prefetch | Gapless prefetch of next track, skipped when current or next exceeds threshold | Gapless UX for common case; bounds worst-case peak memory |
| Offline audio caching | Deferred (v2); metadata-only caching in v1 | Core use case is online streaming; full LRU blob cache deferred behind a stable interface (`CacheProvider`) |
| Platforms | Desktop + mobile (iOS/Android), MediaSession required | Stated use case: desk + commute listening |
| Settings sync | Per-device (`localStorage`), no `drive.appdata` | Re-pasting a folder URL on a new device is trivial; avoids a second OAuth scope |
| Playback session | Persisted across reloads (queue, position, volume, shuffle, repeat) | Mobile tabs get reclaimed; instant resume from `localStorage` matters |
| Token storage | In-memory only, never persisted | Matches "zero-leakage" security posture; silent renewal cost is sub-second |
| Stack | React + Vite | Mature PWA tooling (`vite-plugin-pwa`), component model fits queue/player UI complexity |

---

## 1. Executive Summary & Core Objectives

**Vision.** swaranidhi turns one or more folders in a user's private Google Drive into a personal, cross-device streaming music player — installable as a PWA, with no server component anywhere in the request path. The user's Drive *is* the backend: there is no media server, no user database, no analytics pipeline, and no third-party storage of any kind. All state that must persist (library index, playback queue, settings) lives in the user's own browser (`localStorage` / `IndexedDB`); all state that must stay secret (the OAuth access token) lives only in JS memory and never touches disk.

**Primary use cases:**
1. **Desk listening** — desktop browser, stable network, long sessions (multi-hour), queue built from one or more full albums.
2. **On-the-go listening** — mobile browser (iOS Safari / Android Chrome), intermittent network, lock-screen/notification playback controls, app backgrounded for most of the session.
3. **Library curation** — user adds a new Drive folder (album, artist directory, compilation) as a root; swaranidhi recursively indexes it and the new tracks appear in the browsable library with correct metadata and artwork.

**Strict non-goals (v1):**
- No server-side audio transcoding, proxying, or any compute in the request path — Firebase Hosting serves only static assets (HTML/JS/CSS/manifest/service worker); no Cloud Functions, no Cloud Run.
- No relational or document database of any kind; no user accounts beyond individually Google-OAuth-granted access; no analytics/telemetry backend.
- No public or anonymous access. The OAuth consent screen remains in **Testing** publishing status with a manually curated list of test users (≤100). This is a product decision, not just a configuration default — it is what allows `drive.readonly` (a restricted scope) to be used without triggering Google's verification/CASA process.
- No MediaSource Extensions / chunked-Range streaming engine in v1. The library's largest files (~50–100MB MP3/AAC) are handled by the simple blob-fetch path; true lossless/FLAC support is explicitly deferred (see §5.5).
- No offline audio caching in v1 — only library *metadata* (not audio bytes) is cached locally for fast reload.
- No Google Picker integration — root folder selection is a manual paste-and-parse of a Drive folder URL.
- No cross-device settings sync — root folder configuration lives in each browser's `localStorage` independently.

---

## 2. Architecture & System Flow

### 2.1 System components

```
┌─────────────────┐    ┌──────────────────────┐    ┌────────────────────┐    ┌─────────────────────┐
│ Firebase Hosting │    │   Browser Client     │    │ Google Identity     │    │  Google Drive API    │
│ (static only)    │    │   (swaranidhi SPA)   │    │ Services (GIS)      │    │  v3 (REST)           │
└────────┬─────────┘    └──────────┬───────────┘    └──────────┬──────────┘    └──────────┬───────────┘
         │                         │                            │                           │
         │  GET / (index.html,     │                            │                           │
         │  JS/CSS bundle,         │                            │                           │
         │  manifest, sw.js)       │                            │                           │
         │────────────────────────>│                            │                           │
         │                         │                            │                           │
         │                         │  load gsi/client script    │                           │
         │                         │───────────────────────────>│                           │
         │                         │                            │                           │
         │                         │  initTokenClient(...)      │                           │
         │                         │───────────────────────────>│                           │
         │                         │                            │                           │
         │                         │  requestAccessToken        │                           │
         │                         │  ({prompt:'consent'})      │                           │
         │                         │  [first run only]          │                           │
         │                         │───────────────────────────>│                           │
         │                         │                            │  user consent popup       │
         │                         │                            │  (one-time, out of band)  │
         │                         │  access_token (TTL 3600s)  │                           │
         │                         │<───────────────────────────│                           │
         │                         │  [held in-memory only]     │                           │
         │                         │                            │                           │
         │                         │  restore PlaybackSession   │                           │
         │                         │  + library index from      │                           │
         │                         │  localStorage/IndexedDB    │                           │
         │                         │  (instant, no network)     │                           │
         │                         │                            │                           │
         │                         │  files.list (recursive BFS scan of root folder(s))      │
         │                         │─────────────────────────────────────────────────────────>│
         │                         │  {nextPageToken, files[]}                               │
         │                         │<─────────────────────────────────────────────────────────│
         │                         │                            │                           │
         │                         │  files.get?alt=media        │                           │
         │                         │  Range: bytes=0-1048575     │                           │
         │                         │  (per-track ID3 tag fetch) │                           │
         │                         │─────────────────────────────────────────────────────────>│
         │                         │  206 Partial Content         │                           │
         │                         │<─────────────────────────────────────────────────────────│
         │                         │  parse ID3v2 → Track.tags   │                           │
         │                         │  persist to IndexedDB       │                           │
         │                         │                            │                           │
         │                         │  [user presses Play]       │                           │
         │                         │  files.get?alt=media         │                           │
         │                         │  (full track fetch)         │                           │
         │                         │─────────────────────────────────────────────────────────>│
         │                         │  200 OK, streamed bytes      │                           │
         │                         │<─────────────────────────────────────────────────────────│
         │                         │  Blob → createObjectURL     │                           │
         │                         │  → <audio>.src = blob:...   │                           │
         │                         │  → playback starts          │                           │
         │                         │                            │                           │
         │                         │  [token nears/past 3600s TTL on NEXT Drive call]          │
         │                         │  requestAccessToken({prompt:''})                         │
         │                         │───────────────────────────>│                           │
         │                         │  new access_token (silent, no UI) [in-memory swap]       │
         │                         │<───────────────────────────│                           │
         │                         │  retry original 401'd request transparently              │
         │                         │─────────────────────────────────────────────────────────>│
         │                         │                            │                           │
         │                         │  [track ends / user skips → revoke old blob URL,        │
         │                         │   advance queue, repeat full-track-fetch step]           │
```

### 2.2 Key architectural insight: playback is immune to token expiry

Once a track's bytes are fetched into a `Blob` and assigned via `URL.createObjectURL`, the `<audio>` element plays entirely from local memory — **no further network or Drive API calls occur for a track that has already finished downloading**, including seeking within it. This means the 60-minute OAuth token TTL can *only* ever surface as a 401 on:
1. A library-scan `files.list` call (paginating through folders), or
2. A `files.get?alt=media` call for the *next* track (prefetch or on-demand).

It can never interrupt audio that is already playing. The 401 interceptor (§3.3) therefore only needs to guard Drive API calls, not the `<audio>` element itself — this materially simplifies the "critical bottleneck" framing of token renewal vs. active playback.

### 2.3 End-to-end data lifecycle

1. **Boot** — Firebase Hosting serves the static SPA bundle (cached by the service worker after first load). App reads `localStorage` (`PlaybackSession`, root folder list) and `IndexedDB` (track/folder metadata index) synchronously-ish on startup — the UI renders the full library and the last queue/position **before** any network call completes.
2. **Authentication** — GIS `initTokenClient` is initialized with the OAuth client ID and `drive.readonly` scope. First-ever use triggers `prompt: 'consent'` (one-time Google popup). Subsequent app loads attempt `prompt: ''` (silent) the first time a Drive API call is actually needed (not eagerly on boot, since the user may just be browsing a cached library view).
3. **Discovery** — For each configured root folder, a BFS walk of the folder tree runs via paginated `files.list` calls, collecting both subfolders (to continue the walk) and audio files (to index). Results merge into the IndexedDB track/folder store, diffed against the previous scan by `modifiedTime` and file ID presence.
4. **Metadata extraction** — For every newly discovered (or changed) audio file, a single `Range: bytes=0-1048575` request pulls the leading 1MB, which is parsed client-side for ID3v2 tags and embedded album art. Extraction never blocks discovery of subsequent files — it runs as a background queue.
5. **Playback** — On Play, the engine resolves the current track to a full `files.get?alt=media` fetch (or reuses a prefetched `Blob` if one exists), creates an object URL, assigns it to the `<audio>` element, and starts playback. The previous track's object URL is revoked on transition (never before the new one is playing, to avoid any audible gap from premature GC).
6. **Cache invalidation** — Library metadata is invalidated per-root-folder on explicit user-triggered "Rescan" (not polled automatically, to conserve the Drive API quota and avoid surprising background network activity on mobile). A track whose `modifiedTime` changed is re-fetched for tags; a track no longer returned by the scan is removed from the index; a track that 403/404s at *playback* time (not just scan time) is marked unavailable immediately and skipped, independent of the next rescan.

---

## 3. Authentication & Session Resilience

### 3.1 GIS initialization lifecycle

```ts
const tokenClient = google.accounts.oauth2.initTokenClient({
  client_id: import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID,
  scope: 'https://www.googleapis.com/auth/drive.readonly',
  callback: (response) => { /* resolves a pending Promise<AuthState> */ },
  error_callback: (error) => { /* surfaces to AuthState.lastError */ },
});
```

- **First-ever sign-in** (no prior grant in this browser profile): `tokenClient.requestAccessToken({ prompt: 'consent' })`. Shows Google's account chooser + consent screen once.
- **Every subsequent app load**: `tokenClient.requestAccessToken({ prompt: '' })`. Succeeds silently (no popup, no visible UI) as long as the user has an active Google session in that browser and has not revoked the grant. This typically resolves in 200–500ms.
- **Silent renewal failure** (grant revoked, third-party cookies blocked, no active Google session): falls back to `prompt: 'consent'`, surfacing a visible "Sign in to Drive" action to the user. `AuthState.status` transitions to `'expired'` in this case so the UI can show an explicit re-auth prompt rather than silently failing.

### 3.2 Google Cloud Console configuration

- **OAuth consent screen**: External, **Testing** publishing status. Test users: the manually curated allowlist (`shankotai@gmail.com` + trusted few). This status never triggers Google's verification review regardless of scope sensitivity, provided the test-user list stays ≤100.
- **OAuth 2.0 Client ID**: type "Web application". Authorized JavaScript origins:
  - `https://swaranidhi.web.app`
  - `https://swaranidhi.firebaseapp.com`
  - `http://localhost:5173` (Vite dev server)
  - `http://localhost:5000` (Firebase Hosting emulator)
- No authorized redirect URIs are needed — `initTokenClient` uses the implicit/token flow entirely in-page, no redirect round-trip.

### 3.3 401 interceptor pattern

All Drive API calls go through a single wrapper:

```ts
async function driveFetch(input: RequestInfo, init: RequestInit): Promise<Response> {
  const attempt = async () => fetch(input, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${authState.accessToken}` },
  });

  let response = await attempt();
  if (response.status === 401) {
    await renewTokenSilently(); // requestAccessToken({ prompt: '' }), updates authState.accessToken in place
    response = await attempt(); // retried exactly once
  }
  return response;
}
```

Because of §2.2, this retry is invisible to playback — it only delays a scan page or a next-track prefetch by the renewal round-trip (~200–500ms), never the currently-playing audio.

### 3.4 CORS and origin policy

Google Drive API v3 and GIS both support CORS natively for browser-based clients from the authorized origins listed in §3.2 — no proxy or CORS workaround is required. Firebase Hosting serves the SPA itself with no CORS concerns (same-origin asset loading); cross-origin requests are strictly outbound to `accounts.google.com` and `www.googleapis.com`, both of which are GIS/Drive-API-sanctioned CORS origins when the calling origin is registered on the OAuth client.

---

## 4. Google Drive Ingestion & Metadata Pipeline

### 4.1 Root folder registration (manual paste)

User pastes a Drive folder URL (e.g., `https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp...`) into a settings field. Client-side regex extracts the folder ID:

```ts
const FOLDER_ID_PATTERN = /\/folders\/([a-zA-Z0-9_-]{10,})/;
function extractFolderId(input: string): string | null {
  const trimmed = input.trim();
  if (/^[a-zA-Z0-9_-]{10,}$/.test(trimmed)) return trimmed; // raw ID pasted directly
  return trimmed.match(FOLDER_ID_PATTERN)?.[1] ?? null;
}
```

A lightweight `files.get` call (`fields=id,name,mimeType`) validates the ID resolves to an accessible folder before it's added to the root list, surfacing a clear error ("not found or not accessible") otherwise.

### 4.2 Recursive discovery: BFS scan

Recursive scanning (chosen over flat whole-Drive indexing, per §0) requires explicit tree traversal — Drive API's `q` parameter only supports direct-parent matching (`'<folderId>' in parents`), not "anywhere under this subtree." The scan therefore maintains an explicit worklist:

```ts
async function scanRootFolder(rootFolderId: string): Promise<{ folders: DriveFolderNode[]; tracks: Track[] }> {
  const worklist: string[] = [rootFolderId];
  const folders: DriveFolderNode[] = [];
  const tracks: Track[] = [];

  while (worklist.length > 0) {
    const folderId = worklist.shift()!;
    let pageToken: string | undefined;
    do {
      const url = new URL('https://www.googleapis.com/drive/v3/files');
      url.searchParams.set('q',
        `'${folderId}' in parents and trashed = false and ` +
        `(mimeType = 'application/vnd.google-apps.folder' or mimeType contains 'audio/')`);
      url.searchParams.set('fields', 'nextPageToken,files(id,name,mimeType,size,parents,modifiedTime)');
      url.searchParams.set('pageSize', '1000');
      if (pageToken) url.searchParams.set('pageToken', pageToken);

      const res = await driveFetch(url.toString(), { method: 'GET' });
      if (!res.ok) throw await DriveApiError.fromResponse(res);
      const body = await res.json();

      for (const f of body.files) {
        if (f.mimeType === 'application/vnd.google-apps.folder') {
          folders.push({ id: f.id, name: f.name, parentId: folderId, isRoot: false, modifiedTime: f.modifiedTime });
          worklist.push(f.id);
        } else {
          tracks.push(toTrack(f, folderId));
        }
      }
      pageToken = body.nextPageToken;
    } while (pageToken);
  }
  return { folders, tracks };
}
```

`pageSize: 1000` (API maximum) minimizes round-trips; `fields` filtering keeps each response small. `orderBy=folder,name` is intentionally **not** used here since it does not affect correctness and adds server-side sort cost for a client that reorders in-memory anyway.

### 4.3 Metadata (ID3) extraction — Range-based, non-blocking

For each newly discovered or `modifiedTime`-changed track, a background worker queue (concurrency-limited to 4 in-flight requests, to stay well under Drive's per-user QPS burst limits) issues:

```
GET https://www.googleapis.com/drive/v3/files/{fileId}?alt=media
Authorization: Bearer {accessToken}
Range: bytes=0-1048575
```

The first 1MB covers the vast majority of ID3v2 tag blocks including embedded album art (APIC frames larger than this are rare for typical rips). The response (206 Partial Content) is parsed with `music-metadata-browser`'s buffer parser. Embedded art is downscaled client-side (max 512×512, canvas-based resize) and stored as a `data:` URI directly on the `Track` record — this keeps artwork available for MediaSession without a second fetch at playback time and without needing Blob storage/revocation bookkeeping for something that's reused across the whole app lifetime.

If parsing fails or no ID3v2 header is found (`tagExtractionStatus: 'no-tags-found'`), the UI falls back to displaying the raw filename and folder breadcrumb as title/artist/album — never a blank entry.

### 4.4 IndexedDB schema (metadata only — no audio bytes in v1)

| Object store | Key | Value | Purpose |
|---|---|---|---|
| `tracks` | `id` (Drive file ID) | `IndexedDBTrackRecord` | Full track + tag metadata, keyed for instant lookup |
| `folders` | `id` (Drive folder ID) | `DriveFolderNode` | Folder tree snapshot, used for breadcrumb rendering and rescans |
| `scanState` | `rootFolderId` | `ScanState` | Last-scanned timestamp and status per configured root |

This store is intentionally schema-versioned (`IDBOpenDBRequest.onupgradeneeded`) from day one so the v2 offline blob cache (§5.6) can add an additional `blobCache` object store without a destructive migration of existing data.

### 4.5 Rescan / cache invalidation

Rescanning is **user-triggered only** (an explicit "Rescan library" action per root folder), not polled in the background — this avoids surprising mobile data usage and keeps Drive API quota consumption predictable. A rescan re-walks the tree (§4.2), then reconciles:
- New file IDs → inserted, tags extracted.
- Existing file IDs with changed `modifiedTime` → tags re-extracted (file content may have changed).
- Previously-indexed file IDs no longer returned → removed from `tracks` and purged from any active queue.
- A **playback-time** 403/404 (not just scan-time) immediately marks that specific track `tagExtractionStatus`-independent as unavailable and skips it in the queue, without waiting for the next full rescan.

---

## 5. Streaming Engine & Memory Architecture

### 5.1 Why blob-fetch-only is sufficient for this library

The original architectural question (MSE vs. chunked-Range streaming for "large audio") is resolved by the actual library composition: the longest files are ~1-hour MP3/AAC recordings, which land at roughly 50–100MB — well within what a modern browser tab can hold as a single in-memory `Blob` without heap exhaustion risk, even on mid-range mobile devices. MediaSource Extensions, AudioWorklet-based chunked decoding, and resumable partial-range reconstruction are **not implemented in v1** and are documented as future work (§5.5), gated on the library ever acquiring genuinely large (FLAC/lossless, multi-hundred-MB) files.

### 5.2 Core streaming pipeline

```ts
const LARGE_FILE_THRESHOLD_BYTES = 30 * 1024 * 1024; // 30MB

async function fetchTrackBlob(track: Track, signal: AbortSignal): Promise<Blob> {
  const url = `https://www.googleapis.com/drive/v3/files/${track.id}?alt=media`;
  const res = await driveFetch(url, { method: 'GET', signal });
  if (!res.ok) throw await DriveApiError.fromResponse(res);
  return res.blob();
}

async function playTrack(track: Track) {
  revokeCurrentObjectUrlAfterPlaybackStarts(); // old URL revoked only once the new one is actually playing
  const blob = prefetchedBlobs.get(track.id) ?? await fetchTrackBlob(track, currentAbortController.signal);
  const objectUrl = URL.createObjectURL(blob);
  audioElement.src = objectUrl;
  audioElement.addEventListener('loadedmetadata', () => {
    audioElement.currentTime = restoredPositionForTrack(track.id) ?? 0;
  }, { once: true });
  await audioElement.play();
  maybePrefetchNext();
}
```

### 5.3 Threshold-gated gapless prefetch

```ts
function maybePrefetchNext() {
  const current = getCurrentTrack();
  const next = getNextTrackInQueue();
  if (!next || prefetchedBlobs.has(next.id)) return;
  if (current.sizeBytes > LARGE_FILE_THRESHOLD_BYTES || next.sizeBytes > LARGE_FILE_THRESHOLD_BYTES) {
    return; // skip prefetch: avoid holding two large blobs simultaneously; accept a transition gap instead
  }
  fetchTrackBlob(next, prefetchAbortController.signal).then(blob => prefetchedBlobs.set(next.id, blob));
}
```

This bounds worst-case concurrent blob memory to `2 × 30MB = 60MB` for the prefetch-active case, while the rare >30MB file is always fetched on-demand alone (peak ~100MB for that single track, never doubled).

Switching tracks while a prefetch is in-flight aborts it via `AbortController` and discards the partial fetch — no orphaned blobs or dangling object URLs accumulate.

### 5.4 Memory ceiling targets

| Scenario | Target peak JS heap |
|---|---|
| Normal queue (all tracks < 30MB), prefetch active | < 120MB |
| Playing one of the rare ~100MB large files | < 180MB (single blob + library index + UI) |
| Library index in memory (thousands of tracks, each with a downscaled `data:` URI album art thumbnail) | < 40MB, independent of playback state |

### 5.5 Explicitly out of scope for v1 (future work)

MediaSource Extensions / chunked `Range`-fetch streaming becomes necessary only if the library acquires files that make whole-blob loading impractical (roughly: lossless FLAC rips, or anything approaching/exceeding ~300MB). If that happens, the extension point is the `fetchTrackBlob` call site in §5.2 — it would be replaced by a `MediaSource`/`SourceBuffer`-backed progressive loader without touching the queue, prefetch, or UI logic around it.

### 5.6 Offline / local caching — deferred, interface reserved now

v1 ships **metadata-only** caching (§4.4). Full audio blob LRU caching is deferred, but the streaming pipeline is written against a `CacheProvider` interface (Appendix A) from day one:

```ts
const cacheProvider: CacheProvider = {
  async getTrackBlob() { return null; },   // v1: always miss
  async putTrackBlob() {},                  // v1: no-op
  async evictLeastRecentlyUsed() {},        // v1: no-op
};
```

`fetchTrackBlob` checks `cacheProvider.getTrackBlob(track.id)` before hitting the network. Introducing the v2 IndexedDB-backed LRU cache means implementing this interface for real and adding a `blobCache` object store (§4.4) — no call site elsewhere in the app changes.

---

## 6. Functional & UI/UX Requirements

### 6.1 Media Session integration (mobile-critical)

```ts
navigator.mediaSession.metadata = new MediaMetadata({
  title: track.tags.title ?? track.name,
  artist: track.tags.artist ?? 'Unknown Artist',
  album: track.tags.album ?? track.folderPath.at(-1) ?? '',
  artwork: track.tags.albumArtDataUrl
    ? [{ src: track.tags.albumArtDataUrl, sizes: '512x512', type: 'image/png' }]
    : [],
});
navigator.mediaSession.setActionHandler('play', () => audioElement.play());
navigator.mediaSession.setActionHandler('pause', () => audioElement.pause());
navigator.mediaSession.setActionHandler('previoustrack', () => queue.skipPrevious());
navigator.mediaSession.setActionHandler('nexttrack', () => queue.skipNext());
navigator.mediaSession.setActionHandler('seekto', (details) => { audioElement.currentTime = details.seekTime ?? 0; });
```

Lock-screen/notification controls are a v1 requirement (not optional) given the confirmed mobile use case.

### 6.2 Core playback controls

- Continuous queue playback with automatic advance on `ended`.
- Drag-to-reorder queue (pointer + touch), persisted immediately to `PlaybackSession.queue`.
- Shuffle: Fisher-Yates-shuffled `shuffledOrder` computed once on toggle-on, persisted so a reload doesn't re-shuffle; toggling off restores original `queue` order from `queuePosition`.
- Repeat: `'off' | 'one' | 'all'`.
- Persistent volume, restored from `PlaybackSession.volume` on load.
- **Progress indicator semantics**: because playback is blob-based, the standard "network-buffered ranges" concept (`HTMLMediaElement.buffered`) is not meaningful post-load (the whole file is already local once playback starts). Instead, the UI shows a distinct **download progress bar** (bytes received / `Content-Length`) while the `fetchTrackBlob` request is in flight, which disappears once the blob is ready and normal playback-position scrubbing takes over.

### 6.3 Persisted PlaybackSession

Written to `localStorage` under key `swaranidhi:playbackSession:v1`:
- On every track change (immediate).
- On pause (immediate).
- On `visibilitychange`/`pagehide` (immediate — catches mobile backgrounding before possible tab reclaim).
- Throttled to once per 5 seconds during active playback (position updates only).

On load, the UI restores the full queue and shows the last track/position **instantly** (no network dependency) in a paused state; pressing Play triggers silent token renewal (if needed) followed by the normal fetch-and-play flow (§2.3 step 5), seeking to the restored position once `loadedmetadata` fires (free, local-blob seek — no re-fetch required).

### 6.4 Error states

| Condition | UI behavior |
|---|---|
| 403 quota exhaustion during scan | Scan pauses, shows "Retrying in Ns…" with exponential backoff + jitter |
| 403 insufficient permissions on a specific file (revoked share, moved out of folder) | Track marked unavailable in library + auto-skipped if in queue; toast notification |
| Network drop mid-fetch | Retry banner with manual "Retry" button; no partial-blob resumption in v1 (whole fetch restarts) |
| Silent token renewal fails (grant revoked / no Google session) | `AuthState.status = 'expired'`; visible "Sign in to Drive" banner, playback of already-loaded blobs unaffected |

---

## 7. Security, Privacy & PII Boundary

### 7.1 Data residency map

| Data | Storage location | Persisted across reload? |
|---|---|---|
| OAuth access token | JS memory (`AuthState.accessToken`) only | No — silently re-acquired via `prompt: ''` |
| Track/folder metadata index | `IndexedDB` | Yes |
| Root folder list | `localStorage` | Yes |
| Playback queue/position/volume | `localStorage` | Yes |
| Audio bytes | In-memory `Blob` (current ± prefetched-next track only) | No (never written to disk in v1) |

No data of any kind leaves the browser except outbound calls to `accounts.google.com` (auth) and `www.googleapis.com` (Drive API) — there is no first-party backend to send data to.

### 7.2 Scope enforcement

`drive.readonly` is the narrowest scope that supports unattended recursive folder scanning without a Picker round-trip per session; it carries no write capability. Combined with the Testing-mode consent screen (§3.2), a leaked token is bounded to: read-only access to one trusted individual's Drive, for up to 60 minutes (token TTL), from whatever origin the token was issued to (not replayable cross-origin due to CORS + origin-bound GIS client config).

### 7.3 Content Security Policy

See Appendix B (`firebase.json`) for the full header block. Key directives:
- `script-src 'self' https://accounts.google.com` — only the GIS client script is allowed as a third-party script source (no Picker/`apis.google.com`, since Picker was ruled out).
- `connect-src 'self' https://www.googleapis.com https://oauth2.googleapis.com blob:` — Drive API, GIS token endpoints, and blob-URL internal fetches.
- `media-src 'self' blob:` — required for `<audio src="blob:...">` playback.
- `img-src 'self' data:` — album art is stored as downscaled `data:` URIs, not separate image requests.
- `frame-src https://accounts.google.com` — GIS may use a hidden iframe for silent-auth checks.
- No `unsafe-inline` for `script-src` (Vite production build emits no inline scripts); styling ships as a compiled stylesheet to avoid needing `style-src 'unsafe-inline'`.

### 7.4 Blob URL lifecycle discipline

Every `URL.createObjectURL(blob)` has an explicit paired `URL.revokeObjectURL(url)` once that URL is no longer the active `<audio>` source **and** playback has transitioned away from it (never revoked preemptively, to avoid audible cutoffs) — this is enforced by routing all object-URL creation/revocation through a single `BlobUrlManager` module rather than ad hoc calls scattered through playback code, so there is one place to audit for leaks.

---

## 8. Verification & Performance Acceptance Criteria

### 8.1 Benchmarks

| Metric | Target | Notes |
|---|---|---|
| Time to First Audio (TTFA), normal track (<5MB), 4G | < 800ms | Dominated by Drive API latency, not client processing |
| TTFA, large file (~100MB), 4G | 15–30s (accepted, documented) | Explicit consequence of the blob-only v1 decision; shown via download-progress UI (§6.2), not a silent stall |
| Silent token renewal round-trip | < 500ms | Measured from `requestAccessToken({prompt:''})` call to resolved callback |
| Peak JS heap, normal queue w/ prefetch | < 120MB | Per §5.4 |
| Peak JS heap, large-file playback | < 180MB | Per §5.4 |

### 8.2 Edge case test matrix

| # | Scenario | Expected behavior |
|---|---|---|
| 1 | Token expires while current track is mid-playback, no prefetch pending | No visible impact — already-fetched blob plays uninterrupted (§2.2) |
| 2 | Token expires during an in-flight next-track prefetch | 401 → silent renew → retry same request; current track unaffected |
| 3 | User skips tracks while a prefetch for a different track is in-flight | In-flight fetch aborted via `AbortController`; new fetch started for the actually-needed track |
| 4 | Network drop mid-fetch (any size) | Fetch rejects; retry banner shown; no partial-blob resume (full restart) |
| 5 | 403 quota exhaustion during library scan | Exponential backoff + jitter; visible "retrying" state; scan resumes from the paginated point it was interrupted at |
| 6 | File permission revoked / moved out of root folder after indexing | 403/404 at next access (scan or playback) marks it unavailable immediately; auto-skip if queued; fully reconciled on next manual rescan |
| 7 | iOS Safari backgrounds tab during active playback | Native `<audio>` element continues playing in background (iOS permits this for an element already playing from a user gesture); MediaSession lock-screen controls remain responsive |
| 8 | iOS reclaims a long-backgrounded, paused (non-playing) tab | On relaunch, `PlaybackSession` restores queue/position instantly from `localStorage`; user must tap Play to resume (silent token re-acquisition happens at that point) |
| 9 | Multiple tabs open simultaneously, same account | Each tab holds its own in-memory token and `<audio>` element; `localStorage` writes are last-write-wins across tabs — **documented v1 limitation**, no `BroadcastChannel` coordination |
| 10 | Switching tracks during an active full-track fetch (not just prefetch) | Abandoned fetch aborted; its blob (if any partial data arrived) is discarded, never assigned to the audio element |

---

## Appendix A — TypeScript Interfaces

```ts
interface AuthState {
  status: 'signed-out' | 'authenticating' | 'signed-in' | 'expired';
  accessToken: string | null; // in-memory only — never persisted to localStorage/IndexedDB/sessionStorage
  tokenExpiresAtEpochMs: number | null;
  scope: 'https://www.googleapis.com/auth/drive.readonly';
  lastError: { code: number; message: string } | null;
}

interface DriveFolderNode {
  id: string;
  name: string;
  parentId: string | null;
  isRoot: boolean;
  modifiedTime: string; // RFC3339
}

interface TrackTags {
  title: string | null;
  artist: string | null;
  album: string | null;
  durationSeconds: number | null;
  albumArtDataUrl: string | null; // downscaled (<=512x512) data: URI, extracted from ID3v2 APIC frame
  tagExtractionStatus: 'pending' | 'success' | 'no-tags-found' | 'failed';
}

interface Track {
  id: string; // Drive file ID
  name: string; // raw Drive filename, used as fallback display
  mimeType: string;
  sizeBytes: number;
  parentFolderId: string;
  folderPath: string[]; // breadcrumb from root to file, used for album/artist grouping fallback
  modifiedTime: string; // RFC3339 — drives rescan staleness detection
  isLargeFile: boolean; // sizeBytes > LARGE_FILE_THRESHOLD_BYTES
  availability: 'available' | 'unavailable'; // set 'unavailable' on 403/404 at scan or playback time
  tags: TrackTags;
}

interface QueueEntry {
  trackId: string;
  queuePosition: number; // stable original (non-shuffled) order
}

type RepeatMode = 'off' | 'one' | 'all';

interface PlaybackSession {
  version: 1;
  queue: QueueEntry[];
  shuffledOrder: string[] | null; // non-null only while shuffle is active
  currentTrackId: string | null;
  positionSeconds: number;
  volume: number; // 0.0–1.0
  shuffle: boolean;
  repeatMode: RepeatMode;
  updatedAtEpochMs: number;
}

interface IndexedDBTrackRecord extends Track {
  rootFolderId: string;
}

interface ScanState {
  rootFolderId: string;
  rootFolderName: string;
  lastScannedAtEpochMs: number | null;
  status: 'idle' | 'scanning' | 'error';
  lastError?: string;
}

// Reserved extension point for the deferred (v2) offline LRU blob cache.
// v1 call sites are written against this interface so introducing real
// caching later requires no changes outside the implementing module.
interface CacheEntry {
  key: string; // trackId
  blob: Blob;
  sizeBytes: number;
  lastAccessedEpochMs: number;
  sourceModifiedTime: string; // Track.modifiedTime at fetch time, for staleness checks
}

interface CacheProvider {
  getTrackBlob(trackId: string): Promise<Blob | null>;
  putTrackBlob(trackId: string, blob: Blob, sourceModifiedTime: string): Promise<void>;
  evictLeastRecentlyUsed(targetFreeBytes: number): Promise<void>;
}
```

---

## Appendix B — `firebase.json`

```json
{
  "hosting": {
    "public": "dist",
    "ignore": ["firebase.json", "**/.*", "**/node_modules/**"],
    "rewrites": [
      { "source": "**", "destination": "/index.html" }
    ],
    "headers": [
      {
        "source": "/index.html",
        "headers": [
          { "key": "Cache-Control", "value": "no-cache" },
          {
            "key": "Content-Security-Policy",
            "value": "default-src 'self'; script-src 'self' https://accounts.google.com; connect-src 'self' https://www.googleapis.com https://oauth2.googleapis.com blob:; img-src 'self' data:; media-src 'self' blob:; frame-src https://accounts.google.com; style-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
          },
          { "key": "X-Content-Type-Options", "value": "nosniff" },
          { "key": "X-Frame-Options", "value": "DENY" },
          { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" }
        ]
      },
      {
        "source": "/assets/**",
        "headers": [
          { "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }
        ]
      },
      {
        "source": "/service-worker.js",
        "headers": [
          { "key": "Cache-Control", "value": "no-cache" }
        ]
      }
    ]
  }
}
```

---

## Appendix C — Drive API v3 Endpoint Contracts

### C.1 Folder-children listing (recursive scan step)

```
GET https://www.googleapis.com/drive/v3/files
    ?q='{folderId}' in parents and trashed = false and
       (mimeType = 'application/vnd.google-apps.folder' or mimeType contains 'audio/')
    &fields=nextPageToken,files(id,name,mimeType,size,parents,modifiedTime)
    &pageSize=1000
    &pageToken={token}        // omitted on first page
Authorization: Bearer {accessToken}
```

200 response:
```json
{
  "nextPageToken": "optional-opaque-token",
  "files": [
    { "id": "1AbC...", "name": "01 Track.mp3", "mimeType": "audio/mpeg", "size": "6291456",
      "parents": ["folderId"], "modifiedTime": "2025-11-02T10:15:00.000Z" },
    { "id": "2DeF...", "name": "Disc 2", "mimeType": "application/vnd.google-apps.folder",
      "parents": ["folderId"], "modifiedTime": "2025-10-01T08:00:00.000Z" }
  ]
}
```
Note: `size` is absent on folder entries — must be read as optional.

### C.2 ID3 Range-fetch (metadata extraction)

```
GET https://www.googleapis.com/drive/v3/files/{fileId}?alt=media
Authorization: Bearer {accessToken}
Range: bytes=0-1048575
```
206 response: `Content-Range: bytes 0-1048575/{totalSize}`, raw bytes parsed via `music-metadata-browser`.

### C.3 Full track fetch (playback)

```
GET https://www.googleapis.com/drive/v3/files/{fileId}?alt=media
Authorization: Bearer {accessToken}
```
200 response: full byte stream → `Response.blob()`. Request is issued with an `AbortController` signal so an in-flight fetch can be cancelled on track-skip.

### C.4 Error response shape (all endpoints)

```json
{
  "error": {
    "code": 401,
    "message": "Invalid Credentials",
    "errors": [{ "domain": "global", "reason": "authError", "message": "Invalid Credentials" }]
  }
}
```
`code: 401` → interceptor renews + retries once (§3.3). `code: 403` with `reason: "userRateLimitExceeded"` or `"rateLimitExceeded"` → exponential backoff retry. `code: 403` with `reason: "insufficientFilePermissions"`, or `code: 404` → mark the specific file/folder unavailable (§4.5).
