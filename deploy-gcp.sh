#!/usr/bin/env bash
# One-time project setup, then build & deploy backend and frontend with Cloud Build.
#   ./deploy-gcp.sh            setup + deploy both
#   ./deploy-gcp.sh be | fe    deploy just one (skips setup)
# Each service can also be deployed on its own:
#   gcloud builds submit . --config backend/cloudbuild.yaml
#   gcloud builds submit . --config frontend/cloudbuild.yaml
set -euo pipefail
cd "$(dirname "$0")"

# ====== PROJECT ======
export PROJECT_ID="railsimulator-190291"
export REGION="asia-south1"                             # Mumbai
export SQL_INSTANCE="${SQL_INSTANCE:-rail-simulator}"   # existing Cloud SQL instance (db-f1-micro)
export DB_NAME="${DB_NAME:-railsim}"                    # database inside it (Liquibase creates the tables)
export DB_SECRET="${DB_SECRET:-railsim-db-password}"    # Secret Manager secret with the DB password
export REPO_NAME="railsim-repo"                         # Artifact Registry (docker)
# identity of both Cloud Run services; Cloud Build also runs as it in newer projects
export SA_EMAIL="${SA_EMAIL:-744714946530-compute@developer.gserviceaccount.com}"
# =====================

gcloud config set project "$PROJECT_ID" >/dev/null
TARGET="${1:-all}"

if [[ "$TARGET" == "all" ]]; then
  echo "1. Enabling APIs..."
  gcloud services enable sqladmin.googleapis.com run.googleapis.com artifactregistry.googleapis.com \
    cloudbuild.googleapis.com texttospeech.googleapis.com secretmanager.googleapis.com

  echo "2. Checking Cloud SQL instance '${SQL_INSTANCE}' and secret '${DB_SECRET}'..."
  if ! gcloud sql instances describe "$SQL_INSTANCE" --format="value(name)" >/dev/null 2>&1; then
    echo "ERROR: Cloud SQL instance '${SQL_INSTANCE}' not found. Set SQL_INSTANCE=<instance id> and re-run."
    exit 1   # never create a new (billable) instance by accident
  fi
  echo "   connection name: $(gcloud sql instances describe "$SQL_INSTANCE" --format="value(connectionName)")"
  gcloud sql instances patch "$SQL_INSTANCE" --activation-policy=ALWAYS --quiet >/dev/null  # must run for Liquibase
  gcloud sql databases create "$DB_NAME" --instance="$SQL_INSTANCE" 2>/dev/null || true
  if ! gcloud secrets describe "$DB_SECRET" >/dev/null 2>&1; then
    echo "ERROR: secret '${DB_SECRET}' not found in Secret Manager."
    exit 1
  fi

  echo "3. Granting roles to ${SA_EMAIL}..."
  bind() { gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:${SA_EMAIL}" --role="$1" --condition=None >/dev/null; }
  bind roles/cloudsql.client                     # runtime: connect to Cloud SQL
  bind roles/serviceusage.serviceUsageConsumer   # runtime: bill Text-to-Speech to this project
  gcloud secrets add-iam-policy-binding "$DB_SECRET" --member="serviceAccount:${SA_EMAIL}" \
    --role=roles/secretmanager.secretAccessor >/dev/null   # runtime: read the DB password
  bind roles/artifactregistry.writer             # build: push images
  bind roles/logging.logWriter                   # build: write logs
  bind roles/storage.objectViewer                # build: read the uploaded source
  bind roles/run.admin                           # build: deploy the Cloud Run services
  gcloud iam service-accounts add-iam-policy-binding "$SA_EMAIL" --member="serviceAccount:${SA_EMAIL}" \
    --role=roles/iam.serviceAccountUser >/dev/null  # build: deploy services that run as this account

  echo "4. Artifact Registry repository..."
  gcloud artifacts repositories describe "$REPO_NAME" --location="$REGION" >/dev/null 2>&1 || \
    gcloud artifacts repositories create "$REPO_NAME" --repository-format=docker --location="$REGION"
  # keep only the 3 newest images per service (stays inside the free 0.5 GB)
  POLICY=$(mktemp)
  cat > "$POLICY" <<'JSON'
[{"name":"keep-3","action":{"type":"Keep"},"mostRecentVersions":{"keepCount":3}},
 {"name":"delete-old","action":{"type":"Delete"},"condition":{"olderThan":"86400s"}}]
JSON
  gcloud artifacts repositories set-cleanup-policies "$REPO_NAME" --location="$REGION" \
    --policy="$POLICY" --no-dry-run >/dev/null
  rm -f "$POLICY"
fi

if [[ "$TARGET" == "all" || "$TARGET" == "be" ]]; then
  echo "5. Backend: Cloud Build -> rail-simulator-be"
  gcloud builds submit . --config backend/cloudbuild.yaml
fi

if [[ "$TARGET" == "all" || "$TARGET" == "fe" ]]; then
  echo "6. Frontend: Cloud Build -> rail-simulator-fe"
  gcloud builds submit . --config frontend/cloudbuild.yaml
fi

echo "============================================================"
echo "Backend:  $(gcloud run services describe rail-simulator-be --region="$REGION" --format='value(status.url)' 2>/dev/null)/api/hubs"
echo "Frontend: $(gcloud run services describe rail-simulator-fe --region="$REGION" --format='value(status.url)' 2>/dev/null)"
echo "============================================================"
