#!/usr/bin/env bash
# RevKlik resource monitor. Samples CPU/RAM of api+db containers + DB disk/rows.
#
# Usage:
#   ./monitor.sh sample [secs]   # sample docker stats every 2s for <secs> (default 60)
#   ./monitor.sh db              # snapshot db disk size + key row counts (before/after)
#
# Output: scripts/loadtest/stats.csv (append) and stdout.
set -euo pipefail
cd "$(dirname "$0")"
CSV="stats.csv"
API_C="${API_C:-revklik-app-api-1}"
DB_C="${DB_C:-revklik-app-db-1}"
DB_URL="postgres://revklik:revklik@localhost:15432/revklik"

snapshot_db() {
  echo "== DB snapshot $(date +%H:%M:%S) =="
  docker exec "$DB_C" psql -U revklik -d revklik -t -A -F',' -c "
    SELECT 'db_size_bytes', pg_database_size('revklik')::text
    UNION ALL SELECT 'events', COUNT(*)::text FROM events
    UNION ALL SELECT 'sessions', COUNT(*)::text FROM sessions
    UNION ALL SELECT 'visitor_profiles', COUNT(*)::text FROM visitor_profiles
    UNION ALL SELECT 'events_table_bytes', pg_total_relation_size('events')::text
    UNION ALL SELECT 'events_index_bytes', pg_indexes_size('events')::text
    UNION ALL SELECT 'cagg_events_hourly_bytes', COALESCE(pg_total_relation_size('events_hourly'),0)::text
    UNION ALL SELECT 'chunks_events', (SELECT count(*) FROM timescaledb_information.chunks WHERE hypertable_name='events')::text;"
}

case "${1:-}" in
  db) snapshot_db ;;
  sample)
    SECS="${2:-60}"
    echo "timestamp,container,cpuperc,mem_usage,mem_perc,netio,blockio" > "$CSV"
    echo "# sampling $API_C + $DB_C every 2s for ${SECS}s -> $CSV"
    end=$(( $(date +%s) + SECS ))
    while [ "$(date +%s)" -lt "$end" ]; do
      ts=$(date +%H:%M:%S)
      while IFS= read -r line; do
        # docker stats --format "name,cpu,mem,memp,net,blk"
        [ -z "$line" ] && continue
        echo "$ts,$line" >> "$CSV"
      done < <(docker stats --no-stream --format "{{.Name}},{{.CPUPerc}},{{.MemUsage}},{{.MemPerc}},{{.NetIO}},{{.BlockIO}}" "$API_C" "$DB_C" 2>/dev/null)
      echo "$ts api=$(docker stats --no-stream --format '{{.CPUPerc}} {{.MemUsage}}' "$API_C" 2>/dev/null | tr '\n' ' ')"
      sleep 2
    done
    echo "# done. peaks:"
    awk -F, 'NR>1 && $2 ~ /api/ {gsub("%","",$3); if($3+0>m){m=$3+0; mt=$1}} END{print "  api cpu peak " m "% @ " mt}' "$CSV"
    awk -F, 'NR>1 && $2 ~ /db/  {gsub("%","",$3); if($3+0>m){m=$3+0; mt=$1}} END{print "  db  cpu peak " m "% @ " mt}' "$CSV"
    ;;
  *) echo "usage: $0 {sample [secs]|db}"; exit 1 ;;
esac
