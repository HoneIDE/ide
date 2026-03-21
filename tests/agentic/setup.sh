#!/bin/bash
# Create temp project with realistic git state, launch IDE with geisterhand
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HONE_IDE_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
TMPDIR="/tmp/hone-agentic-$(date +%s)"

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

# Launch IDE with geisterhand
echo ""
echo "Launching IDE..."
cd "$HONE_IDE_DIR"
geisterhand ./hone-ide "$TMPDIR" &
GEISTERHAND_PID=$!

# Wait for geisterhand health endpoint
echo "Waiting for geisterhand API..."
for i in $(seq 1 30); do
  if curl -s http://127.0.0.1:7676/health > /dev/null 2>&1; then
    echo "Geisterhand ready on port 7676"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "ERROR: Geisterhand did not start within 15 seconds"
    exit 1
  fi
  sleep 0.5
done

# Wait a bit more for IDE to fully render
sleep 2

# Write state file for teardown and scenarios
cat > "$SCRIPT_DIR/.test-state" << EOF
GEISTERHAND_PID=$GEISTERHAND_PID
PROJECT_DIR=$TMPDIR
RESULTS_DIR=$RESULTS_DIR
TIMESTAMP=$TIMESTAMP
EOF

echo ""
echo "=== Setup Complete ==="
echo "  Project:     $TMPDIR"
echo "  Results:     $RESULTS_DIR"
echo "  Geisterhand: PID $GEISTERHAND_PID"
echo ""
echo "State saved to $SCRIPT_DIR/.test-state"
