# swaranidhi

Stream your own music library straight from Google Drive. Zero backend — a static PWA hosted on Firebase Hosting, authenticating client-side via Google Identity Services. See `PRD.md` for the full architecture.

## Setup

```sh
npm install
cp .env.example .env
```

Fill in `.env` with your OAuth Client ID (see PRD.md section 3.2 for GCP setup steps).

## Develop

```sh
npm run dev
```

## Build

```sh
npm run build
```

## Deploy

```sh
firebase deploy --only hosting
```

Requires the [Firebase CLI](https://firebase.google.com/docs/cli) installed and authenticated (`firebase login`), and `.firebaserc` pointing at your Firebase project.
