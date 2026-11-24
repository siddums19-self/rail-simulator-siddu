#!/usr/bin/env bash
set -euo pipefail

# ====== CONFIGURE YOUR GCP PROJECT ======
export PROJECT_ID="your-gcp-project-id"
export REGION="asia-south1"                  # Mumbai region for low latency in India
export SQL_INSTANCE="railsim-pg-instance"
export DB_NAME="railsim"
export DB_USER="railsim_user"
export DB_PASS="ChangeThisStrongPassword!"
export REPO_NAME="railsim-repo"
export SERVICE_NAME="railsim-api"
export WEB_BUCKET="${PROJECT_ID}-railsim-web"
export SA_NAME="railsim-run-sa"
# ========================================

if [[ "$PROJECT_ID" == "your-gcp-project-id" ]]; then
  echo "ERROR: Please edit deploy-gcp.sh and set PROJECT_ID and DB_PASS before running."
  exit 1
fi

gcloud config set project "$PROJECT_ID"

echo "1. Enabling required GCP APIs..."
gcloud services enable   sqladmin.googleapis.com   run.googleapis.com   artifactregistry.googleapis.com   cloudbuild.googleapis.com   storage.googleapis.com

echo "2. Creating Cloud SQL PostgreSQL 16 instance..."
gcloud sql instances create "$SQL_INSTANCE"   --database-version=POSTGRES_16   --tier=db-f1-micro   --region="$REGION"   --storage-auto-increase || true

gcloud sql databases create "$DB_NAME" --instance="$SQL_INSTANCE" || true
gcloud sql users create "$DB_USER" --instance="$SQL_INSTANCE" --password="$DB_PASS" || true

INSTANCE_CONN_NAME=$(gcloud sql instances describe "$SQL_INSTANCE" --format="value(connectionName)")

echo "3. Creating Service Account with Cloud SQL Client & Storage Viewer roles..."
gcloud iam service-accounts create "$SA_NAME" --display-name="RailSim Cloud Run SA" || true
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

gcloud projects add-iam-policy-binding "$PROJECT_ID"   --member="serviceAccount:${SA_EMAIL}"   --role="roles/cloudsql.client"

gcloud projects add-iam-policy-binding "$PROJECT_ID"   --member="serviceAccount:${SA_EMAIL}"   --role="roles/storage.objectViewer"

echo "4. Building & Pushing Spring Boot Backend to Artifact Registry..."
gcloud artifacts repositories create "$REPO_NAME"   --repository-format=docker --location="$REGION" || true

IMAGE_URI="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO_NAME}/${SERVICE_NAME}:latest"
gcloud builds submit ./backend --tag "$IMAGE_URI"

echo "5. Deploying Backend to Cloud Run (connected to Cloud SQL)..."
JDBC_URL="jdbc:postgresql:///${DB_NAME}?cloudSqlInstance=${INSTANCE_CONN_NAME}&socketFactory=com.google.cloud.sql.postgres.SocketFactory"

gcloud run deploy "$SERVICE_NAME"   --image="$IMAGE_URI"   --region="$REGION"   --platform=managed   --allow-unauthenticated   --service-account="$SA_EMAIL"   --add-cloudsql-instances="$INSTANCE_CONN_NAME"   --set-env-vars="DB_URL=${JDBC_URL},DB_USER=${DB_USER},DB_PASS=${DB_PASS}"   --min-instances=0   --max-instances=5

API_URL=$(gcloud run services describe "$SERVICE_NAME" --region="$REGION" --format="value(status.url)")
echo "Backend live at: ${API_URL}/api/hubs"

echo "6. Creating Cloud Storage Bucket & Deploying High-Graphics WebGPU Frontend..."
gcloud storage buckets create "gs://${WEB_BUCKET}" --location="$REGION" --uniform-bucket-level-access || true
gcloud storage buckets add-iam-policy-binding "gs://${WEB_BUCKET}"   --member="allUsers" --role="roles/storage.objectViewer"
gcloud storage buckets update "gs://${WEB_BUCKET}" --web-main-page-suffix=index.html --web-error-page=index.html

pushd frontend
npm install
VITE_API_BASE="${API_URL}/api" VITE_ASSETS_BASE="https://storage.googleapis.com/${WEB_BUCKET}" npm run build
popd

gcloud storage cp -r frontend/dist/* "gs://${WEB_BUCKET}/"

echo "============================================================"
echo "DEPLOYMENT COMPLETE (v5 High-Graphics)!"
echo "Backend API:   ${API_URL}/api/hubs"
echo "WebGPU Client: https://storage.googleapis.com/${WEB_BUCKET}/index.html"
echo "Optional photorealistic .glb/.hdr upgrade paths:"
echo "  gs://${WEB_BUCKET}/models/lhb.glb"
echo "  gs://${WEB_BUCKET}/models/vande_bharat.glb"
echo "  gs://${WEB_BUCKET}/models/icf.glb"
echo "  gs://${WEB_BUCKET}/models/demu_passenger.glb"
echo "  gs://${WEB_BUCKET}/models/boxn_goods.glb"
echo "  gs://${WEB_BUCKET}/models/passenger.glb"
echo "  gs://${WEB_BUCKET}/env/sky.hdr"
echo "============================================================"
