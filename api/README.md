# LTSA REST API

A REST API wrapper for the LTSA (Labeled Transition System Analyzer) CLI, providing HTTP endpoints for parsing, compiling, and verifying concurrent systems specified in FSP (Finite State Processes).

## Prerequisites

- Python 3.8 or higher
- Java Runtime Environment (JRE) - required to run `ltsp.jar`
- The `ltsp.jar` file in the project root directory

## Installation

1. Navigate to the `api` directory:
```bash
cd api
```

2. Create a virtual environment (recommended):
```bash
python -m venv venv

# Windows
venv\Scripts\activate

# Linux/Mac
source venv/bin/activate
```

3. Install dependencies:
```bash
pip install -r requirements.txt
```

## Running the Service

Start the API server:

```bash
python main.py
```

Or use uvicorn directly:

```bash
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

The API will be available at: `http://localhost:8000`

Interactive API documentation (Swagger UI): `http://localhost:8000/docs`

Alternative API docs (ReDoc): `http://localhost:8000/redoc`

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
  "content": "MUTEX = SEMAPHORE(1).\nSEMAPHORE(N=1) = SEMA[0],\nSEMA[i:0..N] = (when(i<N) acquire -> SEMA[i+1] | when(i>0) release -> SEMA[i-1]).",
  "process": "MUTEX"
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
  "content": "P = (a -> b -> P).\nQ = (c -> Q).\n||SYSTEM = (P || Q).\nproperty SAFE = (a -> b -> SAFE).\nassert SAFE_HOLDS = SYSTEM |= SAFE.",
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

## Error Handling

The API returns appropriate HTTP status codes:

- `200 OK`: Request processed successfully
- `408 Request Timeout`: Command execution exceeded 30 seconds
- `422 Unprocessable Entity`: Invalid request body
- `500 Internal Server Error`: Server-side error (e.g., Java not found)

## Development

To run in development mode with auto-reload:

```bash
uvicorn main:app --reload
```

## Notes

- Temporary `.lts` files are created during execution and automatically cleaned up
- Command execution has a 30-second timeout to prevent hanging
- CORS is enabled for all origins (adjust in production as needed)
- All endpoints use POST requests to accept LTS content in the request body

## Project Structure

```
api/
├── main.py              # FastAPI application
├── requirements.txt     # Python dependencies
└── README.md           # This file
```

## Future Enhancements

Potential improvements:
- File upload support (in addition to content in JSON)
- Batch verification of multiple files
- WebSocket support for real-time streaming of long-running verifications
- Caching of compilation results
- Rate limiting and authentication
- Docker containerization
