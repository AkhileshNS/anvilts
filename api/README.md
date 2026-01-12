# LTSA REST API

A REST API wrapper for the LTSA (Labeled Transition System Analyzer) CLI, providing HTTP endpoints for parsing, compiling, and verifying concurrent systems specified in FSP (Finite State Processes).

## Prerequisites

- Node.js 18 or higher
- Java Runtime Environment (JRE) - required to run `ltsp.jar`
- The `ltsp.jar` file in the project root directory

## Installation

1. Navigate to the `api` directory:
```bash
cd api
```

2. Install dependencies:
```bash
npm install
```

## Running the Service

**Development mode (with hot reload):**
```bash
npm run dev
```

**Production mode:**
```bash
npm run build
npm start
```

**Quick start (Windows):**
```bash
start.bat
```

**Quick start (Linux/Mac):**
```bash
chmod +x start.sh
./start.sh
```

The API will be available at: `http://localhost:8000`

## API Endpoints

### Health Check
```
GET /health
```
Check if the service is running and if ltsp.jar and Java are available.

### 1. Parse
```
POST /parse
```
Validates the syntax of an LTS file.

**Request Body:**
```json
{
  "content": "SWITCH = (on -> off -> SWITCH)."
}
```

### 2. Compile
```
POST /compile
```
Compiles an LTS file (also parses it).

**Request Body:**
```json
{
  "content": "SWITCH = (on -> off -> SWITCH).",
  "process": "DEFAULT"
}
```

### 3. Compose
```
POST /compose
```
Composes (parallelizes) the specified composite process.

**Request Body:**
```json
{
  "content": "P = (a -> STOP).\nQ = (b -> STOP).\n||SYSTEM = (P || Q).",
  "process": "SYSTEM"
}
```

### 4. Check Safety
```
POST /check/safety
```
Checks if processes are deadlock-free.

**Request Body:**
```json
{
  "content": "LOCK = (acquire -> release -> LOCK).\nPROCESS = (acquire -> work -> release -> PROCESS).\n||SYSTEM = (PROCESS || LOCK).",
  "process": "SYSTEM"
}
```

### 5. Check Progress
```
POST /check/progress
```
Checks for progress violations (livelocks).

**Request Body:**
```json
{
  "content": "P = (a -> P).\nprogress A = {a}",
  "process": "DEFAULT"
}
```

### 6. Check LTL Property
```
POST /check/ltl
```
Verifies if a specified LTL (Linear Temporal Logic) property holds.

**Request Body:**
```json
{
  "content": "P = (a -> b -> P).\n||SYSTEM = P.\nassert SAFE_HOLDS = ...",
  "process": "SYSTEM",
  "property": "SAFE_HOLDS"
}
```

## Response Format

All endpoints return a consistent response format:

```json
{
  "success": true,
  "output": "Parsing completed successfully...",
  "error": null
}
```

- `success`: Boolean indicating if the operation succeeded
- `output`: Standard output from the LTSP CLI
- `error`: Error message if any (null on success)

## Example Usage

### Using cURL

```bash
# Parse
curl -X POST http://localhost:8000/parse \
  -H "Content-Type: application/json" \
  -d '{
    "content": "SWITCH = (on -> off -> SWITCH)."
  }'

# Check Safety
curl -X POST http://localhost:8000/check/safety \
  -H "Content-Type: application/json" \
  -d '{
    "content": "P = (a -> b -> STOP).\nQ = (c -> STOP).\n||SYSTEM = (P || Q).",
    "process": "SYSTEM"
  }'
```

### Using JavaScript fetch

```javascript
const response = await fetch('http://localhost:8000/parse', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    content: 'SWITCH = (on -> off -> SWITCH).'
  })
});

const result = await response.json();
console.log(result);
```

### Using Python requests

```python
import requests

url = "http://localhost:8000/parse"
data = {
    "content": "SWITCH = (on -> off -> SWITCH)."
}

response = requests.post(url, json=data)
print(response.json())
```

## Error Handling

The API returns appropriate HTTP status codes:

- `200 OK`: Request processed successfully
- `400 Bad Request`: Missing required fields
- `408 Request Timeout`: Command execution exceeded 30 seconds
- `500 Internal Server Error`: Server-side error (e.g., Java not found)

## Development

### Scripts

- `npm run dev` - Start in development mode with hot reload
- `npm run build` - Compile TypeScript to JavaScript
- `npm start` - Run the compiled JavaScript
- `npm run typecheck` - Type-check without building

### Project Structure

```
api/
├── src/
│   └── index.ts       # Express application
├── dist/              # Compiled JavaScript (generated)
├── package.json       # Dependencies and scripts
├── tsconfig.json      # TypeScript configuration
├── start.bat          # Windows start script
├── start.sh           # Linux/Mac start script
└── README.md          # This file
```

## Notes

- Temporary `.lts` files are created during execution and automatically cleaned up
- Command execution has a 30-second timeout to prevent hanging
- CORS is enabled for all origins (adjust in production as needed)
- All endpoints use POST requests to accept LTS content in the request body
