You are a Principal Software Architect and Technical Product Manager. Generate an exhaustive, implementation-ready Product Requirements Document (PRD) for a zero-backend, client-side static Progressive Web App (PWA) hosted on Firebase Hosting that streams music directly from a user's private Google Drive.

The PRD must be concrete, highly technical, and directly address the specific browser storage, network, and audio-streaming constraints outlined below.

---

### Core Context & Architectural Constraints
- **Hosting Platform:** Firebase Hosting (pure static distribution, zero custom backend, no Node.js/Cloud Functions runtime for audio proxying).
- **Target Storage Provider:** Google Drive API v3 (strictly Google Drive; not Microsoft OneDrive).
- **Auth Model:** Google Identity Services (GIS) Web SDK client-side OAuth 2.0 (`google.accounts.oauth2.initTokenClient`) requesting `https://www.googleapis.com/auth/drive.readonly`.

---

### Mandatory PRD Sections & Technical Requirements

#### 1. Executive Summary & Core Objectives
- Define the product vision, primary use cases, and strict non-goals (e.g., no server-side audio transcoding, no relational user database).

#### 2. Architecture & System Flow
- Provide an ASCII sequence diagram mapping interactions across the Browser Client, Google Identity Services, Google Drive API v3, and Firebase Hosting.
- Detail the end-to-end data lifecycle: authentication, audio discovery, audio retrieval/buffering, playback, and cache invalidation.

#### 3. Authentication & Session Resilience
- Detail the GIS initialization lifecycle: explicit user opt-in (`prompt: 'consent'`) vs. silent background token renewal (`prompt: ''`).
- Specify an automatic 401 interceptor pattern to handle the 60-minute Google OAuth access token TTL without interrupting active playback or clearing the user's playback queue.
- Address CORS, origin policies, and Firebase Hosting deployment domains (`*.web.app`, `*.firebaseapp.com`, and localhost emulators).

#### 4. Google Drive Ingestion & Metadata Pipeline
- API queries: query syntax for non-trashed audio formats (`mimeType contains 'audio/'`), pagination handling (`pageToken`, `pageSize`), and field filtering (`fields=nextPageToken, files(id, name, mimeType, size)`).
- Recursive directory scanning vs. flat file indexing trade-offs.
- In-browser metadata indexing: extract ID3 tags/embedded album art client-side without downloading entire multi-megabyte files (e.g., HTTP Range requests for tag headers vs. client-side ID3 parsers).

#### 5. Streaming Engine & Memory Architecture (Critical Bottlenecks)
- **Small Tracks (< 25–30 MB):** Direct `alt=media` fetch with Bearer token header, conversion to `Blob`, memory-managed `URL.createObjectURL(blob)`, and deterministic garbage collection via `URL.revokeObjectURL()` on track transitions.
- **Large Audio / Lossless (FLAC, DJ Sets, Audiobooks > 30 MB):** 
  - Evaluation and specification of `MediaSource` Extensions (MSE) vs. chunked `Range: bytes=start-end` fetching with Web Audio API / AudioWorklets.
  - Mitigate tab crashes and heap exhaustion on mobile browsers during extended listening sessions.
- **Offline & Local Caching:** IndexedDB schema for persistent track metadata, directory tree snapshots, and optional local LRU audio chunk/blob caching.

#### 6. Functional & UI/UX Requirements
- Media session management via Web MediaSession API (lock-screen controls, artwork, notification bar track changes).
- Core playback controls: continuous playback, queue reordering, shuffle/repeat, persistent volume, and buffered range visualization.
- Error states: handling file permission changes, rate limiting (Google Drive API 403 quota exhaustion), and network drops.

#### 7. Security, Privacy & PII Boundary
- Zero-leakage data governance: tokens, metadata, and cached audio data strictly restricted to browser storage (`IndexedDB` / in-memory).
- Scopes: enforce read-only boundary (`drive.readonly` or narrower `drive.file` / Google Picker integration where viable).
- Content Security Policy (CSP) headers required in `firebase.json` for GIS scripts, Drive API endpoints, and blob URI execution.

#### 8. Verification & Performance Acceptance Criteria
- Explicit benchmarks: Time to First Audio (TTFA) on 4G networks, memory ceiling under long queues (e.g., < 150 MB JS heap), and token renewal recovery latency (< 500 ms).
- Edge cases test matrix (e.g., token expiration mid-track, switching tracks during an active fetch, suspended tab backgrounding on iOS/Android).

---

### Tone & Output Expectations
- Write with architectural precision and production readiness.
- Provide explicit TypeScript interfaces for critical models (Track, PlaybackSession, AuthState, CacheEntry).
- Provide sample `firebase.json` security header configurations and Drive API endpoint contracts.
- Do not output generic placeholders, hand-waving summaries, or filler text.