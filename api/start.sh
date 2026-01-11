#!/bin/bash

# LTSA REST API Start Script

echo "Starting LTSA REST API..."
echo ""

# Check if virtual environment exists
if [ ! -d "venv" ]; then
    echo "Virtual environment not found. Creating one..."
    python -m venv venv
    echo "✓ Virtual environment created"
fi

# Activate virtual environment
echo "Activating virtual environment..."
source venv/bin/activate

# Install/update dependencies
echo "Installing dependencies..."
pip install -q -r requirements.txt
echo "✓ Dependencies installed"

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
echo "API documentation at: http://localhost:8000/docs"
echo ""
echo "Press Ctrl+C to stop the server"
echo ""

# Start the server
python main.py
