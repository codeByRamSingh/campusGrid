#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -f .env ]]; then
  echo "FAIL: .env is required. Copy .env.example to .env and set secure values."
  exit 1
fi

report_line() {
  local label="$1"
  local status="$2"
  local detail="$3"
  printf "%-28s %-6s %s\n" "$label" "$status" "$detail"
}

TMP_DIR="$(mktemp -d)"
FAILED=0
TOKEN=""

cleanup() {
  docker compose down >/dev/null 2>&1 || true
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

echo "==> Starting Docker stack"
docker compose up --build -d

echo "==> Waiting for backend health endpoint"
for _ in $(seq 1 90); do
  code="$(curl -s -o "$TMP_DIR/health.json" -w "%{http_code}" http://localhost:4000/api/health || true)"
  if [[ "$code" == "200" ]]; then
    break
  fi
  sleep 2
done

if [[ "${code:-000}" != "200" ]]; then
  report_line "backend-health" "FAIL" "GET /api/health returned ${code:-000}"
  exit 1
fi
report_line "backend-health" "PASS" "GET /api/health = 200"

echo "==> Running smoke test"
if (cd backend && API_BASE_URL=http://localhost:4000/api npm run test:smoke >/tmp/campusgrid-smoke.log 2>&1); then
  report_line "smoke-e2e" "PASS" "backend/scripts/smoke.e2e.ts"
else
  report_line "smoke-e2e" "FAIL" "See /tmp/campusgrid-smoke.log"
  cat /tmp/campusgrid-smoke.log
  exit 1
fi

echo "==> Authenticating"
LOGIN_PAYLOAD='{"email":"super_admin@campusgrid.local","password":"Admin@123"}'
TOKEN="$(curl -s -X POST http://localhost:4000/api/auth/login -H 'Content-Type: application/json' -d "$LOGIN_PAYLOAD" | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{const j=JSON.parse(d);if(!j.token){process.exit(1)}process.stdout.write(j.token)})' || true)"

if [[ -z "$TOKEN" ]]; then
  report_line "auth-login" "FAIL" "Unable to obtain JWT token"
  exit 1
fi
report_line "auth-login" "PASS" "Super admin token acquired"

probe() {
  local label="$1"
  local url="$2"
  local outfile="$3"
  local expected="${4:-200}"

  local code
  code="$(curl -s -o "$outfile" -w "%{http_code}" -H "Authorization: Bearer $TOKEN" "$url" || true)"
  if [[ "$code" == "$expected" ]]; then
    report_line "$label" "PASS" "${code} ${url}"
  else
    report_line "$label" "FAIL" "expected ${expected}, got ${code} ${url}"
    FAILED=1
  fi
}

probe "admin-structure" "http://localhost:4000/api/admin/academic-structure" "$TMP_DIR/admin.json"
probe "students-list" "http://localhost:4000/api/students?limit=5" "$TMP_DIR/students.json"
probe "finance-ledger" "http://localhost:4000/api/finance/ledger?period=monthly" "$TMP_DIR/ledger.json"
probe "workflow-inbox" "http://localhost:4000/api/workflow/inbox" "$TMP_DIR/workflow.json"
probe "hr-staff" "http://localhost:4000/api/hr/staff" "$TMP_DIR/hr.json"
probe "exceptions-metrics" "http://localhost:4000/api/exceptions/metrics" "$TMP_DIR/exceptions.json"
probe "reports-summary" "http://localhost:4000/api/reports/dashboard-summary" "$TMP_DIR/reports.json"
probe "settings" "http://localhost:4000/api/settings" "$TMP_DIR/settings.json"

if [[ "$FAILED" -eq 1 ]]; then
  echo "==> Runtime certification failed"
  exit 1
fi

echo "==> Evidence snapshot"
node -e '
const fs = require("fs");
const read = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const base = process.argv[1];
const health = read(`${base}/health.json`);
const students = read(`${base}/students.json`);
const ledger = read(`${base}/ledger.json`);
const workflow = read(`${base}/workflow.json`);
const hr = read(`${base}/hr.json`);
const exceptions = read(`${base}/exceptions.json`);
const reports = read(`${base}/reports.json`);
const settings = read(`${base}/settings.json`);
const summary = {
  healthStatus: health.status,
  studentsCount: students.data?.length ?? null,
  studentsHasMore: students.hasMore,
  ledgerPeriod: ledger.period,
  ledgerClosingBalance: ledger.closingBalance,
  workflowSummary: workflow.summary,
  hrStaffCount: Array.isArray(hr) ? hr.length : null,
  exceptionsTotal: exceptions.total,
  dashboardHasKpis: !!reports.kpis,
  trustName: settings.trust?.name ?? null,
};
console.log(JSON.stringify(summary, null, 2));
' "$TMP_DIR"

echo "==> Runtime certification PASSED"
