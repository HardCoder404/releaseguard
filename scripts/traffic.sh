#!/usr/bin/env bash
# Fake users: hits products + checkout forever. Ctrl+C to stop.
URL="${1:-http://localhost:3001}"
echo "sending traffic to $URL (Ctrl+C to stop)"
while true; do
  curl -s -o /dev/null "$URL/products"
  curl -s -o /dev/null -X POST "$URL/checkout" -H 'content-type: application/json' -d '{"productId":1,"qty":2}'
  sleep 0.2
done
