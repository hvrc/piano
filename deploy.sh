#!/usr/bin/env bash
# Manual deploy of piano to Cloud Run `piano` in hvrc-web (us-east1). Normally you don't need
# this: pushing to the `release` branch deploys via GitHub Actions (.github/workflows/deploy.yml).
#
#   ./deploy.sh          build from source with Cloud Build and deploy
#   ./deploy.sh --map    also (re)create the piano.hvrc.place domain mapping
set -euo pipefail
cd "$(dirname "$0")"

PROJECT="${GCP_PROJECT:-hvrc-web}"
REGION="${REGION:-us-east1}"
SERVICE="${SERVICE:-piano}"
DOMAIN="${DOMAIN:-piano.hvrc.place}"
ACCOUNT="${GCP_ACCOUNT:-harshrajmachikar@gmail.com}"

echo "Deploying '$SERVICE' to '$PROJECT' ($REGION) as ${ACCOUNT}…"
gcloud run deploy "$SERVICE" \
  --source . --project "$PROJECT" --region "$REGION" --account "$ACCOUNT" \
  --allow-unauthenticated --port 8080 \
  --min-instances 0 --max-instances 3 \
  --memory 512Mi --cpu 1 --concurrency 80 \
  --set-env-vars "STORE=firestore,FIRESTORE_DATABASE=piano,GOOGLE_CLOUD_PROJECT=$PROJECT" \
  --quiet

URL="$(gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" --account "$ACCOUNT" --format='value(status.url)')"
echo "live: $URL"
curl -fsS "$URL/_healthz" && echo

if [ "${1:-}" = "--map" ]; then
  gcloud beta run domain-mappings create --service "$SERVICE" --domain "$DOMAIN" \
    --project "$PROJECT" --region "$REGION" --account "$ACCOUNT" --quiet || echo "(mapping exists already)"
fi
