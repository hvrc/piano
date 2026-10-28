# Plan: tracks, MIDI, keyboard mode, cloud deploy (2026-10-28)

## Decisions

- **Where tracks are saved:** server-side, in Firestore database `piano` (hvrc-web, us-east1), behind a small API on the same Cloud Run service. There are no accounts, so each browser gets a random, unguessable **library key**. Every track belongs to the library whose key created it. Opening a "library link" (`/#library=…`) on another device shares that library. The server stores only a SHA-256 hash of the key, so the database never contains the key itself.
- **Track format at rest:** JSON (`name`, `bpm`, `notes[]`) is lossless and quick to list. MIDI (`.mid`, SMF format 0) is the import/export format.
- **Server:** Node 24 with native TypeScript type stripping and no framework (`node:http`). It serves `dist/` and `/api/*`. In dev, the same server hosts Vite in middleware mode, so one `pnpm dev` runs everything. Locally it uses a JSON file store; in production it uses Firestore.
- **Auto-deploy:** GitHub Actions + Workload Identity Federation instead of a Cloud Build GitHub trigger. A first-gen Cloud Build trigger needs a manual "connect repository" click in the Console for every new repo, and there is no public API for it. WIF can be set up entirely with `gcloud` and `gh`. Pushing to `release` builds the image on GitHub, pushes it to Artifact Registry and deploys to Cloud Run.

## Phases

1. **Client features.** Computer-keyboard mode (M; A–' keys; Z/X octave; C/V velocity), MIDI encode/decode, a file bar (name, Save, Open, Download), and a sidebar of tracks.
   *Test:* MIDI round-trip (encode → decode equals the input), plus a browser check of every control.
2. **Server and persistence.** `/api/tracks` (list, put, delete) scoped by library key, with input validation, size limits and per-IP rate limits. File store for dev, Firestore store for production.
   *Test:* API tests against the file store and against the real Firestore emulator. Browser: save, reload, open, delete, library link.
3. **Repo.** git init with the repo-local email set to the gmail address, public `hvrc/piano`, branches `main` + `release`.
4. **Cloud.** Firestore DB `piano` (delete protection, PITR), Cloud Run `piano` (us-east1, public, max 3 instances), and a manual `deploy.sh`.
   *Test:* hit the live run.app URL: health check, API, UI.
5. **Auto-deploy.** WIF pool/provider restricted to `hvrc/piano`, a deployer service account with least privilege, and `.github/workflows/deploy.yml`.
   *Test:* push to `release`, then watch the Actions run and the new Cloud Run revision.
6. **Domain.** Cloud Run domain mapping `piano.hvrc.place` (DNS already CNAMEs to ghs.googlehosted.com).
   *Test:* HTTPS loads and the API works on the domain.
7. **Wrap-up.** README and ops notes, a live browser pass, memory.

## Outcome (2026-10-28)

All phases are done.
- Tests: 9 local tests pass (MIDI codec + API); the API suite also passes against the Firestore emulator and against the live service. An exported MIDI file was checked with mido. Browser checks covered keyboard mode, save/open/new/delete, the unsaved-changes dialog, MIDI download → import round trip, bad-file errors and library links.
- Deploy: the first release push failed at auth because it ran before WIF existed. The second failed at `docker push`: gcloud's credential helper didn't pick up the federated credentials, so the workflow now logs Docker in with a short-lived WIF access token. The third run deployed revision `piano-00002`, built from the exact commit.
