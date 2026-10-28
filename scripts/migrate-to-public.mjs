// One-off: copy tracks saved under the old per-browser libraries (libraries/{hash}/tracks/{id})
// into the public list (tracks/{id}) in Firestore database `piano`. Idempotent: an id that already
// exists in `tracks` is left alone. Uses your gcloud login; nothing is deleted.
//
//   node scripts/migrate-to-public.mjs            # dry run: list what would be copied
//   node scripts/migrate-to-public.mjs --apply    # copy
import { execFileSync } from 'node:child_process';

const PROJECT = 'hvrc-web';
const DB = `projects/${PROJECT}/databases/piano`;
const BASE = `https://firestore.googleapis.com/v1/${DB}/documents`;
const apply = process.argv.includes('--apply');
const token = execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8' }).trim();
const headers = { Authorization: `Bearer ${token}`, 'x-goog-user-project': PROJECT, 'Content-Type': 'application/json' };

async function call(url, body) {
  const res = await fetch(url, { method: body ? 'POST' : 'GET', headers, body: body && JSON.stringify(body) });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

// Every track in every old library.
const rows = await call(`${BASE}:runQuery`, {
  structuredQuery: { from: [{ collectionId: 'tracks', allDescendants: true }] },
});
const old = rows.filter((r) => r.document && r.document.name.includes('/libraries/')).map((r) => r.document);
const existing = new Set(
  rows.filter((r) => r.document && !r.document.name.includes('/libraries/')).map((r) => r.document.name.split('/').pop()),
);

const todo = old.filter((d) => !existing.has(d.name.split('/').pop()));
for (const d of todo) console.log(`${apply ? 'copy' : 'would copy'}: ${d.fields?.name?.stringValue ?? '?'} (${d.name.split('/').pop()})`);
console.log(`${old.length} old-library tracks, ${todo.length} to copy, ${existing.size} already public.`);

if (apply && todo.length) {
  await call(`${BASE}:commit`, {
    writes: todo.map((d) => ({
      update: { name: `${DB}/documents/tracks/${d.name.split('/').pop()}`, fields: d.fields },
      currentDocument: { exists: false },
    })),
  });
  console.log('done.');
}
