#!/bin/bash

# Sutra IDE Quick Development Script
# For when you just want to run the app quickly (assumes build is already done)

echo "⚡ Quick starting Sutra IDE..."

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo "❌ Error: Run this script from the ainative-studio directory"
    exit 1
fi

# Check if main.js exists
if [ ! -f "out/main.js" ]; then
    echo "❌ Error: Project not built yet. Run './dev-start.sh' first for initial build"
    exit 1
fi

# Function to cleanup on exit
cleanup() {
    echo "🛑 Stopping application..."
    pkill -f "electron.*code-oss-dev" 2>/dev/null || true
}

trap cleanup EXIT INT TERM

# Start the application directly
echo "🚀 Starting application..."
./scripts/code.sh