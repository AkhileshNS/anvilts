# AnvilTS - Natural Language to Verified Concurrent Systems

A project to generate formally verified concurrent system specifications from natural language descriptions using LLMs and LTSA (Labeled Transition System Analyzer).

## Project Overview

This project bridges the gap between natural language descriptions of concurrent systems and formally verified specifications. It uses:

- **Large Language Models (LLMs)** to translate natural language into FSP (Finite State Processes) specifications
- **LTSA** to formally verify these specifications for safety, progress, and other properties
- **REST API** to make LTSA verification accessible via HTTP endpoints

## Project Structure

```
anvilts/
├── ltsp.jar              # LTSA CLI compiler
├── ltsp.README.md        # Documentation for ltsp.jar
├── api/                  # REST API service
│   ├── main.py          # FastAPI application
│   ├── requirements.txt # Python dependencies
│   ├── start.sh         # Linux/Mac start script
│   ├── start.bat        # Windows start script
│   └── README.md        # API documentation
├── examples/            # Example FSP specifications
│   ├── simple_switch.lts
│   ├── reader_writer.lts
│   └── deadlock_example.lts
└── README.md           # This file
```

## Quick Start

### Prerequisites

- **Python 3.8+** - For running the REST API
- **Java Runtime Environment** - For executing ltsp.jar
- **Node.js** (optional) - If you want to build a frontend

### 1. Start the REST API

**Windows:**
```bash
cd api
start.bat
```

**Linux/Mac:**
```bash
cd api
chmod +x start.sh
./start.sh
```

**Manual start:**
```bash
cd api
python -m venv venv
venv\Scripts\activate  # Windows
# source venv/bin/activate  # Linux/Mac
pip install -r requirements.txt
python main.py
```

The API will be available at `http://localhost:8000` with interactive documentation at `http://localhost:8000/docs`

### 2. Test the API

Run the example tests:

```bash
cd api
python test_examples.py
```

Or use curl:

```bash
curl -X POST http://localhost:8000/parse \
  -H "Content-Type: application/json" \
  -d "{\"content\": \"SWITCH = (on -> off -> SWITCH).\"}"
```

### 3. Try the Examples

The `examples/` directory contains sample FSP specifications:

- `simple_switch.lts` - Basic state machine
- `reader_writer.lts` - Classic reader-writer problem (deadlock-free)
- `deadlock_example.lts` - Dining philosophers with deadlock

You can verify these through the API or directly with ltsp.jar:

```bash
java -jar ltsp.jar examples/simple_switch.lts -b parse
java -jar ltsp.jar examples/reader_writer.lts -c safety -p READER_WRITER
```

## API Endpoints

The REST API provides six main endpoints corresponding to LTSA functions:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/parse` | POST | Validate FSP syntax |
| `/compile` | POST | Compile FSP specification |
| `/compose` | POST | Compose parallel processes |
| `/check/safety` | POST | Check for deadlocks |
| `/check/progress` | POST | Check for livelocks |
| `/check/ltl` | POST | Verify LTL properties |
| `/health` | GET | Service health check |

See `api/README.md` for detailed API documentation.

## Workflow

The intended workflow for this project:

1. **Describe** - User describes a concurrent system in natural language
   ```
   "I need a mutex that allows only one process to enter a critical section at a time"
   ```

2. **Generate** - LLM generates FSP specification
   ```fsp
   MUTEX = SEMAPHORE(1).
   SEMAPHORE(N=1) = SEMA[0],
   SEMA[i:0..N] = (when(i<N) acquire -> SEMA[i+1] 
                  |when(i>0) release -> SEMA[i-1]).
   ```

3. **Verify** - Send to LTSA API for verification
   ```bash
   POST /check/safety
   ```

4. **Iterate** - If verification fails, refine and retry

## LTSA Verification

LTSA provides three main types of verification:

### Safety
Ensures "bad things don't happen" - primarily checks for:
- **Deadlocks** - States where processes cannot progress
- **Invalid state transitions** - Transitions that shouldn't occur

### Progress  
Ensures "good things eventually happen" - checks for:
- **Livelocks** - Infinite loops without meaningful progress
- **Starvation** - Processes that never get to execute

### LTL Properties
Custom temporal logic assertions about system behavior:
- Eventually properties: `◇p` (eventually p)
- Always properties: `□p` (always p)
- Until properties: `p U q` (p until q)

## FSP Language Basics

FSP (Finite State Processes) is the specification language LTSA uses:

```fsp
// Simple process
SWITCH = (on -> off -> SWITCH).

// Process with choice
CHOICE = (left -> STOP | right -> STOP).

// Parameterized process
COUNT[i:0..3] = (when (i<3) inc -> COUNT[i+1]
                |when (i>0) dec -> COUNT[i-1]).

// Parallel composition
||SYSTEM = (P || Q).

// Shared actions (synchronization)
||SYSTEM = (p:P || q:Q) / {p.a/q.a}.
```

## Development

### Adding New Features

1. **API Extensions** - Add new endpoints in `api/main.py`
2. **LLM Integration** - Create a separate service that calls the API
3. **Frontend** - Build a web UI that interacts with the API
4. **Batch Processing** - Add endpoints for multiple file verification

### Testing

Manual testing:
```bash
cd api
python test_examples.py
```

API health check:
```bash
curl http://localhost:8000/health
```

## Future Enhancements

- [ ] LLM integration service (OpenAI, Anthropic, etc.)
- [ ] Web-based UI for interactive specification generation
- [ ] Feedback loop: use verification errors to improve LLM generation
- [ ] Support for larger FSP specifications
- [ ] Caching and optimization for repeated verifications
- [ ] Visualization of LTS state machines
- [ ] Multi-file project support
- [ ] Integration with CI/CD pipelines

## Resources

- [LTSA Tool Documentation](http://www.doc.ic.ac.uk/~jnm/book/ltsa/)
- [FSP Language Reference](http://www.doc.ic.ac.uk/ltsa/eclipse/help/FSPReference/index.html)
- [Concurrency: State Models & Java Programs](http://www.doc.ic.ac.uk/~jnm/book/) - Book by Jeff Magee and Jeff Kramer
- [FastAPI Documentation](https://fastapi.tiangolo.com/)

## License

This project wraps around LTSA, which has its own license. Please refer to the original LTSA licensing terms.

## Contributing

This is a research/development project. Contributions are welcome:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## Authors

Built for exploring LLM-based formal specification generation.

---

**Note**: This project is experimental and is designed to explore the intersection of natural language processing and formal verification. Generated specifications should always be reviewed by domain experts before use in production systems.
