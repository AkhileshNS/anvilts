@echo off
REM LTSA REST API Start Script for Windows

echo Starting LTSA REST API...
echo.

REM Check if node_modules exists
if not exist "node_modules\" (
    echo Installing dependencies...
    call npm install
    echo [OK] Dependencies installed
)

REM Check if Java is available
where java >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [WARNING] Java is not installed or not in PATH
    echo           Please install Java to use the LTSA functionality
)

REM Check if ltsp.jar exists
if not exist "..\ltsp.jar" (
    echo [WARNING] ltsp.jar not found in project root
)

echo.
echo Starting API server...
echo API will be available at: http://localhost:8000
echo.
echo Press Ctrl+C to stop the server
echo.

REM Start the server in dev mode
call npm run dev
