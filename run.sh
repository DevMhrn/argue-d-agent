#!/usr/bin/env bash
# =============================================================================
# Lumen — runner
# =============================================================================
# Single entry point for the day-to-day commands. Auto-creates the Python venv
# at .venv/ on first run, installs requirements.txt, then dispatches to the
# right sub-command.
#
# Usage:
#   ./run.sh setup       Create venv + install deps (idempotent)
#   ./run.sh server      Start the FastAPI server on :8000
#   ./run.sh worker      Start the arq extraction worker
#   ./run.sh frontend    Start the Next.js dev server on :3000 (HMR)
#   ./run.sh dev         Start server + worker + frontend together (3 panes)
#   ./run.sh demo        Run the CLI demo (offline mock)
#   ./run.sh seed        Load the synthetic case into Supabase
#   ./run.sh ingest      Start BOTH server and worker (foreground, side-by-side logs)
#   ./run.sh typecheck   Smoke-import test for the Python packages
#   ./run.sh clean       Wipe .venv/ (you almost never want this)
#
# Environment lives in backend/.env. Copy from .env.example and fill in.
# =============================================================================
set -euo pipefail

cd "$(dirname "$0")"

VENV=".venv"
VENV_BIN=""
PYTHON=""
PIP=""
ARQ=""

# Colors for the help / status output. Disable if not a tty.
if [[ -t 1 ]]; then
  C_GREEN='\033[0;32m'; C_YELLOW='\033[1;33m'; C_BLUE='\033[0;36m'; C_RESET='\033[0m'
else
  C_GREEN=''; C_YELLOW=''; C_BLUE=''; C_RESET=''
fi

configure_venv_paths() {
  local bin_dir="bin"
  local exe=""
  if [[ -x "${VENV}/Scripts/python.exe" || ( ! -x "${VENV}/bin/python" && ( "${OSTYPE:-}" == msys* || "${OSTYPE:-}" == cygwin* ) ) ]]; then
    bin_dir="Scripts"
    exe=".exe"
  fi
  VENV_BIN="${VENV}/${bin_dir}"
  PYTHON="${VENV_BIN}/python${exe}"
  PIP="${VENV_BIN}/pip${exe}"
  ARQ="${VENV_BIN}/arq${exe}"
}

ensure_venv() {
  if [[ ! -d "$VENV" ]]; then
    printf "${C_BLUE}→ Creating virtualenv at %s${C_RESET}\n" "$VENV"
    if command -v python3 >/dev/null 2>&1; then
      python3 -m venv "$VENV"
    else
      python -m venv "$VENV"
    fi
    configure_venv_paths
    "$PIP" install --upgrade pip --quiet
    printf "${C_BLUE}→ Installing requirements.txt${C_RESET}\n"
    "$PIP" install -r requirements.txt --quiet
    printf "${C_GREEN}✓ venv ready${C_RESET}\n"
  else
    configure_venv_paths
  fi
}

cmd_setup() {
  ensure_venv
  printf "${C_BLUE}→ Re-syncing requirements (idempotent)${C_RESET}\n"
  "$PIP" install -r requirements.txt --quiet
  printf "${C_GREEN}✓ setup complete${C_RESET}\n"
  printf "  python:      %s\n" "$("$PYTHON" --version)"
  printf "  venv path:   %s\n" "$VENV"
  printf "  env file:    backend/.env\n"
}

cmd_server() {
  ensure_venv
  ensure_env
  printf "${C_BLUE}→ Starting FastAPI server${C_RESET}\n"
  exec "$PYTHON" -m backend.app.run_server
}

cmd_worker() {
  ensure_venv
  ensure_env
  printf "${C_BLUE}→ Starting arq extraction worker${C_RESET}\n"
  exec "$ARQ" backend.ingestion.worker.WorkerSettings
}

cmd_demo() {
  ensure_venv
  export LUMEN_MOCK=1
  printf "${C_BLUE}→ Running CLI demo (mock mode)${C_RESET}\n"
  exec "$PYTHON" -m backend.app.run_demo
}

cmd_seed() {
  ensure_venv
  ensure_env
  printf "${C_BLUE}→ Seeding synthetic Alex/Jordan case into Supabase${C_RESET}\n"
  exec "$PYTHON" -m scripts.seed_synthetic
}

cmd_ingest() {
  # Start the server + worker side by side so logs interleave in one terminal.
  ensure_venv
  ensure_env
  printf "${C_BLUE}→ Starting server + worker (Ctrl-C kills both)${C_RESET}\n"
  trap 'kill 0' EXIT INT TERM
  "$PYTHON" -m backend.app.run_server &
  "$ARQ" backend.ingestion.worker.WorkerSettings &
  wait
}

cmd_frontend() {
  # Next.js dev server on :3000. The first run installs deps under frontend/node_modules.
  if [[ ! -d frontend/node_modules ]]; then
    printf "${C_BLUE}→ Installing frontend deps (first run)${C_RESET}\n"
    (cd frontend && pnpm install --silent)
  fi
  printf "${C_BLUE}→ Starting Next.js dev server on http://localhost:3000${C_RESET}\n"
  exec sh -c 'cd frontend && pnpm dev'
}

cmd_dev() {
  # Backend + worker + frontend in one terminal. Ctrl-C kills all three.
  ensure_venv
  ensure_env
  if [[ ! -d frontend/node_modules ]]; then
    printf "${C_BLUE}→ Installing frontend deps (first run)${C_RESET}\n"
    (cd frontend && pnpm install --silent)
  fi
  printf "${C_BLUE}→ Starting backend (:8000) + worker + Next.js (:3000). Ctrl-C kills all.${C_RESET}\n"
  trap 'kill 0' EXIT INT TERM
  "$PYTHON" -m backend.app.run_server &
  "$ARQ" backend.ingestion.worker.WorkerSettings &
  (cd frontend && pnpm dev) &
  wait
}

cmd_demo_band() {
  # CLI demo that posts to a REAL Band room. Content is LIVE (real models) when
  # provider keys are set; prepend LUMEN_MOCK=1 for a deterministic take.
  # Look for "Posted to real Band room" to confirm Band connectivity.
  ensure_venv
  ensure_band_config
  export LUMEN_BAND=1
  printf "${C_BLUE}→ CLI demo through REAL Band (LUMEN_BAND=1). Content: %s${C_RESET}\n" \
    "$([[ "${LUMEN_MOCK:-}" == "1" ]] && echo "deterministic (LUMEN_MOCK=1)" || echo "LIVE models")"
  exec "$PYTHON" -m backend.app.run_demo --band
}

cmd_dev_band() {
  # Full stack with Band ON. All 8 agents coordinate through a real Band room.
  # Content is LIVE by default; prepend LUMEN_MOCK=1 for a bulletproof recorded take.
  ensure_band_config
  export LUMEN_BAND=1
  printf "${C_GREEN}→ Band ENABLED (LUMEN_BAND=1). Content: %s${C_RESET}\n" \
    "$([[ "${LUMEN_MOCK:-}" == "1" ]] && echo "deterministic (LUMEN_MOCK=1)" || echo "LIVE models")"
  cmd_dev
}

cmd_typecheck() {
  ensure_venv
  printf "${C_BLUE}→ Smoke-importing backend packages${C_RESET}\n"
  "$PYTHON" -c "
import backend
import backend.app.server
import backend.app.pipeline
import backend.ingestion
import backend.ingestion.routes
import backend.ingestion.service
import backend.ingestion.worker
import backend.ingestion.adapters
import backend.schemas
print('imports OK')
"
}

cmd_clean() {
  printf "${C_YELLOW}⚠ Removing %s${C_RESET}\n" "$VENV"
  rm -rf "$VENV"
  printf "${C_GREEN}✓ clean${C_RESET}\n"
}

ensure_env() {
  if [[ ! -f backend/.env ]]; then
    printf "${C_YELLOW}⚠ backend/.env not found. Copy from .env.example and fill in.${C_RESET}\n"
    exit 1
  fi
}

ensure_band_config() {
  if [[ ! -f band_config.yaml ]]; then
    printf "${C_YELLOW}⚠ band_config.yaml not found at repo root.${C_RESET}\n"
    printf "  Band needs the 8 agents' credentials (agent_id + api_key from app.band.ai).\n"
    exit 1
  fi
}

usage() {
  cat <<EOF
${C_GREEN}Lumen — runner${C_RESET}

Usage: ./run.sh <command>

Commands:
  ${C_BLUE}setup${C_RESET}       Create venv (.venv/) and install requirements.txt
  ${C_BLUE}server${C_RESET}      Start the FastAPI server (uvicorn, on :8000)
  ${C_BLUE}worker${C_RESET}      Start the arq extraction worker
  ${C_BLUE}frontend${C_RESET}    Start the Next.js dev server on :3000
  ${C_BLUE}dev${C_RESET}         Start backend + worker + frontend together (one terminal)
  ${C_BLUE}dev-band${C_RESET}    Same as dev, but Band ON + deterministic content (demo config)
  ${C_BLUE}ingest${C_RESET}      Start BOTH server and worker (foreground, Ctrl-C kills both)
  ${C_BLUE}demo${C_RESET}        Run the CLI demo (offline mock mode, no keys needed)
  ${C_BLUE}demo-band${C_RESET}   Run the CLI demo through a REAL Band room (verify Band)
  ${C_BLUE}seed${C_RESET}        Load the synthetic Alex/Jordan case into Supabase
  ${C_BLUE}typecheck${C_RESET}   Smoke-import all packages
  ${C_BLUE}clean${C_RESET}       Wipe .venv/

Configuration: backend/.env (copy from .env.example).
EOF
}

case "${1:-help}" in
  setup)      cmd_setup ;;
  server)     cmd_server ;;
  worker)     cmd_worker ;;
  frontend)   cmd_frontend ;;
  dev)        cmd_dev ;;
  dev-band)   cmd_dev_band ;;
  ingest)     cmd_ingest ;;
  demo)       cmd_demo ;;
  demo-band)  cmd_demo_band ;;
  seed)       cmd_seed ;;
  typecheck)  cmd_typecheck ;;
  clean)      cmd_clean ;;
  help|-h|--help) usage ;;
  *) printf "${C_YELLOW}Unknown command: %s${C_RESET}\n\n" "$1"; usage; exit 1 ;;
esac
