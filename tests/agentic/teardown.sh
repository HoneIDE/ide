#!/bin/bash
# Kill IDE, external geisterhand server, and clean up temp project
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STATE_FILE="$SCRIPT_DIR/.test-state"

if [ ! -f "$STATE_FILE" ]; then
  echo "No .test-state file found — nothing to tear down"
  exit 0
fi

source "$STATE_FILE"

echo "=== Hone Agentic Test Teardown ==="

# Kill external geisterhand CLI server
if [ -n "$EXTERNAL_PID" ] && kill -0 "$EXTERNAL_PID" 2>/dev/null; then
  echo "Killing external geisterhand server (PID $EXTERNAL_PID)..."
  kill "$EXTERNAL_PID" 2>/dev/null || true
fi

# Kill IDE process (baked-in geisterhand dies with it)
if [ -n "$IDE_PID" ] && kill -0 "$IDE_PID" 2>/dev/null; then
  echo "Killing IDE (PID $IDE_PID)..."
  kill "$IDE_PID" 2>/dev/null || true
  sleep 0.5
  kill -9 "$IDE_PID" 2>/dev/null || true
fi

# Also kill any stray processes
pkill -f "hone-ide" 2>/dev/null || true

# Clean up temp project
if [ -n "$PROJECT_DIR" ] && [ -d "$PROJECT_DIR" ]; then
  echo "Removing temp project: $PROJECT_DIR"
  rm -rf "$PROJECT_DIR"
fi

# Remove state file
rm -f "$STATE_FILE"

echo ""
echo "=== Teardown Complete ==="
if [ -n "$RESULTS_DIR" ] && [ -d "$RESULTS_DIR" ]; then
  echo "Results preserved at: $RESULTS_DIR"
fi
