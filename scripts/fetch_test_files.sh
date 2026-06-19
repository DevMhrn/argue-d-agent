#!/usr/bin/env bash
#
# fetch_test_files.sh — download a curated set of real, public-domain
# subrogation evidence files into data/test-files/<category>/.
#
# 21 files across 7 formats, all directly downloadable, all under our
# per-file caps (docs/images 10 MB, audio 50 MB). Sources include
# Archive.org police-scanner collections, Wikimedia Commons crash photos,
# FHWA statistical exports, NTSB accident reports, NY/CA DMV forms,
# CA Courts demand-letter template, Cornell Law Wex statute pages.
#
# Idempotent — skips files that already exist locally and are non-empty.
# Run from repo root.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/data/test-files"
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"

mkdir -p "$DEST"/{audio,images,excel,csv,pdf,docx,html,md}

# Each row: "category|filename|url"
FILES=(
  # --- audio (5 × MP3, all Archive.org public-records collections) -----
  "audio|01-kathy-white-911.mp3|https://archive.org/download/911Call-KathyWhiteAccident/11200Montgomery111870241Ct410818To0822.mp3"
  "audio|02-i40-school-bus-911.mp3|https://archive.org/download/911FromSchoolBusChaseAndAccident/I40Eb98th120690184Ct480606To0608.mp3"
  "audio|03-citizen-app-collision.mp3|https://archive.org/download/citizen-MQS_bJNcMLzXfaOLjNX/1610035202000-b30d8d51-d96b-4fbe-8112-2d777870d567.mp3"
  "audio|04-stockton-pursuit-2009.mp3|https://archive.org/download/Stockton-CA-Police-Scanner-Recordings/10851pursuitspdmarch09.mp3"
  "audio|05-san-joaquin-pursuit-2011.mp3|https://archive.org/download/scanstockton51/San-Joaquin-SO-Pursuit-01-10-2011.mp3"

  # --- images (6 × JPEG, all Wikimedia CC) ----------------------------
  "images|01-tesla-rear-end-damage.jpg|https://upload.wikimedia.org/wikipedia/commons/7/71/Rear_End_Tesla_Model_X_Collision_Damage_Repair.jpg"
  "images|02-moscow-rear-end.jpg|https://upload.wikimedia.org/wikipedia/commons/5/55/Moscow%2C_Smolenskaya_Square%2C_rear-end_collision%2C_June_2026_07.jpg"
  "images|03-rock-quarry-two-car.jpg|https://upload.wikimedia.org/wikipedia/commons/a/ac/Two_car_accident_temporarily_closes_Rock_Quarry_Road_%2815468891310%29.jpg"
  "images|04-kent-police-scene.jpg|https://upload.wikimedia.org/wikipedia/commons/1/11/Kent_Police_Skoda_police_cars_on_scene_of_motor_vehicle_accident.jpg"
  "images|05-rollover-italy.jpg|https://upload.wikimedia.org/wikipedia/commons/b/be/Rollover%28it%29.JPG"
  "images|06-car-accident-generic.jpg|https://upload.wikimedia.org/wikipedia/commons/6/6b/Car_Accident_%2841823308%29.jpeg"

  # --- excel (3 × XLSX, FHWA Highway Statistics 2022) -----------------
  "excel|01-fhwa-vehicle-registrations.xlsx|https://www.fhwa.dot.gov/policyinformation/statistics/2022/xls/mv1.xlsx"
  "excel|02-fhwa-driver-licenses-3sheet.xlsx|https://www.fhwa.dot.gov/policyinformation/statistics/2022/xls/dl22.xlsx"
  "excel|03-fhwa-driver-vehicles-2sheet.xlsx|https://www.fhwa.dot.gov/policyinformation/statistics/2022/xls/dv1c.xlsx"

  # --- csv (2 files, state open data) ---------------------------------
  "csv|01-ny-dfs-auto-complaints.csv|https://data.ny.gov/api/views/h2wd-9xfe/rows.csv?accessType=DOWNLOAD"
  "csv|02-oregon-wc-cycle-times.csv|https://data.oregon.gov/api/views/p8ud-dzhp/rows.csv?accessType=DOWNLOAD"

  # --- pdf (3 files: 1 NTSB report + 2 state DMV accident forms) ------
  "pdf|01-ntsb-highway-accident-report.pdf|https://www.ntsb.gov/investigations/AccidentReports/Reports/HAR2102.pdf"
  "pdf|02-ca-dmv-sr1-accident.pdf|https://www.dmv.ca.gov/portal/file/report-of-traffic-accident-occurring-in-california-sr-1-pdf/"
  "pdf|03-ny-dmv-mv104-accident.pdf|https://dmv.ny.gov/forms/mv104.pdf"

  # --- docx (1 file, demand-letter template) --------------------------
  "docx|01-ca-courts-demand-letter.docx|https://selfhelp.courts.ca.gov/sites/default/files/2025-07/Sample%20Stop%20Payment%20Demand%20Letter.docx"

  # --- html (1 file, Cornell LII Wex on subrogation) ------------------
  "html|01-cornell-subrogation-wex.html|https://www.law.cornell.edu/wex/subrogation"
)

ok=0; skipped=0; failed=0
echo "Fetching ${#FILES[@]} test files into $DEST"
echo

for row in "${FILES[@]}"; do
  IFS='|' read -r category filename url <<<"$row"
  out="$DEST/$category/$filename"
  if [[ -s "$out" ]]; then
    bytes=$(stat -f%z "$out" 2>/dev/null || stat -c%s "$out")
    printf "  [skip] %-50s %10s bytes\n" "$category/$filename" "$bytes"
    skipped=$((skipped+1))
    continue
  fi
  if curl -fsSL -A "$UA" --max-time 120 "$url" -o "$out" 2>/dev/null; then
    bytes=$(stat -f%z "$out" 2>/dev/null || stat -c%s "$out")
    printf "  [ok]   %-50s %10s bytes\n" "$category/$filename" "$bytes"
    ok=$((ok+1))
  else
    printf "  [FAIL] %-50s — %s\n" "$category/$filename" "$url"
    rm -f "$out"
    failed=$((failed+1))
  fi
done

echo
echo "Summary: $ok downloaded · $skipped already present · $failed failed"
if [[ $failed -gt 0 ]]; then
  echo "Re-run the script to retry failed files (idempotent)."
  exit 1
fi
