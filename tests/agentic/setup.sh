#!/bin/bash
# Create temp project with realistic git state, launch IDE with dual geisterhand
#
# Two geisterhand modes run simultaneously:
#   Port 7676 — Baked-in API (widget callbacks, handles, screenshot)
#   Port 7677 — External CLI server (accessibility tree, /key, /scroll, /wait)
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HONE_IDE_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
TMPDIR="/tmp/hone-agentic-$(date +%s)"
BAKED_IN_PORT=7676
EXTERNAL_PORT=7677

echo "=== Hone Agentic Test Setup ==="
echo "Creating temp project at: $TMPDIR"

# Copy seed files
mkdir -p "$TMPDIR"
cp -r "$SCRIPT_DIR/setup/seed-files/"* "$TMPDIR/"
cp "$SCRIPT_DIR/setup/seed-files/.gitignore" "$TMPDIR/" 2>/dev/null || true

# Init git with realistic mixed state
cd "$TMPDIR"
git init -q
git add .
git commit -q -m "Initial commit"

# Create mixed git state for testing
echo "// modified line added for testing" >> src/main.ts          # → modified
echo "export const NEW_FEATURE = true;" > src/new-feature.ts      # → untracked
echo "// staged change for review" >> src/utils.ts && git add src/utils.ts  # → staged

echo "Git state created:"
echo "  Modified:  src/main.ts"
echo "  Staged:    src/utils.ts"
echo "  Untracked: src/new-feature.ts"

# Create results directory for this run
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
RESULTS_DIR="$SCRIPT_DIR/results/$TIMESTAMP"
mkdir -p "$RESULTS_DIR/screenshots"

# Kill any existing hone-ide and geisterhand
pkill -f "hone-ide" 2>/dev/null || true
pkill -f "geisterhand" 2>/dev/null || true
sleep 0.5

# Verify IDE binary was built with --enable-geisterhand
IDE_BIN="$HONE_IDE_DIR/hone-ide"
if [ ! -f "$IDE_BIN" ]; then
  echo "ERROR: IDE binary not found at $IDE_BIN"
  echo "Build it with: cd ../perry && perry compile ../hone/hone-ide/src/app.ts --output ../hone/hone-ide/hone-ide --enable-geisterhand"
  exit 1
fi

# --- Launch IDE (baked-in geisterhand on port $BAKED_IN_PORT) ---
echo ""
echo "Launching IDE (baked-in API on port $BAKED_IN_PORT)..."
cd "$HONE_IDE_DIR"
./hone-ide "$TMPDIR" &
IDE_PID=$!

# Wait for baked-in API
echo "Waiting for baked-in API..."
for i in $(seq 1 30); do
  if curl -sf http://127.0.0.1:$BAKED_IN_PORT/health > /dev/null 2>&1; then
    echo "Baked-in API ready on port $BAKED_IN_PORT"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "ERROR: Baked-in API did not start within 15 seconds"
    echo "Was the binary built with --enable-geisterhand?"
    kill "$IDE_PID" 2>/dev/null || true
    exit 1
  fi
  sleep 0.5
done

# --- Launch external geisterhand CLI server (port $EXTERNAL_PORT) ---
echo "Launching external geisterhand server on port $EXTERNAL_PORT..."
geisterhand server --port $EXTERNAL_PORT &
EXTERNAL_PID=$!

# Wait for external API
for i in $(seq 1 30); do
  if curl -sf http://127.0.0.1:$EXTERNAL_PORT/health > /dev/null 2>&1; then
    echo "External CLI server ready on port $EXTERNAL_PORT"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "WARNING: External CLI server did not start (non-fatal, baked-in still works)"
    EXTERNAL_PID=""
  fi
  sleep 0.5
done

# Wait a bit more for IDE to fully render
sleep 2

# Write state file for teardown and scenarios
cat > "$SCRIPT_DIR/.test-state" << EOF
IDE_PID=$IDE_PID
EXTERNAL_PID=$EXTERNAL_PID
PROJECT_DIR=$TMPDIR
RESULTS_DIR=$RESULTS_DIR
TIMESTAMP=$TIMESTAMP
BAKED_IN_PORT=$BAKED_IN_PORT
EXTERNAL_PORT=$EXTERNAL_PORT
EOF

echo ""
echo "=== Setup Complete ==="
echo "  Project:     $TMPDIR"
echo "  Results:     $RESULTS_DIR"
echo "  IDE:         PID $IDE_PID (baked-in API on :$BAKED_IN_PORT)"
echo "  External:    PID $EXTERNAL_PID (CLI server on :$EXTERNAL_PORT)"
echo ""
echo "See tests/agentic/API.md for endpoint routing guide."
echo "State saved to $SCRIPT_DIR/.test-state"
