#!/bin/bash

# LTSA REST API Start Script

echo "Starting LTSA REST API..."
echo ""

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
    echo "✓ Dependencies installed"
fi

# Check if Java is available
if ! command -v java &> /dev/null; then
    echo "⚠️  Warning: Java is not installed or not in PATH"
    echo "   Please install Java to use the LTSA functionality"
fi

# Check if ltsp.jar exists
if [ ! -f "../ltsp.jar" ]; then
    echo "⚠️  Warning: ltsp.jar not found in project root"
fi

echo ""
echo "Starting API server..."
echo "API will be available at: http://localhost:8000"
echo ""
echo "Press Ctrl+C to stop the server"
echo ""

# Start the server in dev mode
npm run dev
