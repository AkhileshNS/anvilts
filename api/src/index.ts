import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { spawn } from 'child_process';
import { writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

// Transpiler and Docker executor imports
import { transpile, transpileFlat, LTSSpec, FlatTransition } from './transpiler';
import { 
  executeGoCode, 
  isDockerAvailable, 
  isGoImageAvailable, 
  pullGoImage,
  ExecutionOptions 
} from './docker-executor';

const app = express();
const PORT = process.env.PORT || 8000;

// Path to ltsp.jar (relative to project root)
const LTSP_JAR_PATH = join(__dirname, '..', '..', 'ltsp.jar');

// Middleware
app.use(cors());
app.use(express.json({ limit: '1mb' })); // Increased limit for larger specs

// Types
interface LTSRequest {
  content: string;
  process?: string;
}

interface LTLRequest extends LTSRequest {
  property: string;
}

interface LTSResponse {
  success: boolean;
  output: string;
  error: string | null;
}

// Transpiler request types
interface TranspileRequest {
  spec: LTSSpec | FlatTransition[];
}

interface TranspileAndRunRequest extends TranspileRequest {
  timeoutMs?: number;
  memoryLimit?: string;
  cpuLimit?: string;
}

// Helper function to execute ltsp.jar commands
async function executeLtspCommand(ltsContent: string, args: string[]): Promise<LTSResponse> {
  // Create a temporary file for the LTS content
  const tempFilePath = join(tmpdir(), `ltsp-${randomUUID()}.lts`);
  
  try {
    // Write content to temp file
    await writeFile(tempFilePath, ltsContent, 'utf-8');
    
    // Build the command arguments
    const fullArgs = ['-jar', LTSP_JAR_PATH, tempFilePath, ...args];
    
    console.log(`Executing: java ${fullArgs.join(' ')}`);
    
    return await new Promise<LTSResponse>((resolve, reject) => {
      const process = spawn('java', fullArgs);
      
      let stdout = '';
      let stderr = '';
      
      process.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      
      process.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      // Timeout after 30 seconds
      const timeout = setTimeout(() => {
        process.kill();
        reject(new Error('Command execution timed out'));
      }, 30000);
      
      process.on('close', (code) => {
        clearTimeout(timeout);
        resolve({
          success: code === 0,
          output: stdout,
          error: stderr || null
        });
      });
      
      process.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  } finally {
    // Clean up temp file
    try {
      await unlink(tempFilePath);
    } catch (e) {
      console.warn(`Failed to delete temp file: ${tempFilePath}`);
    }
  }
}

// Error handling middleware
function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// Routes

// Root endpoint
app.get('/', (req: Request, res: Response) => {
  res.json({
    message: 'AnvilTS - LTS Verification & Transpilation API',
    version: '2.0.0',
    docs: '/health for status',
    endpoints: {
      // LTSA verification endpoints
      parse: 'POST /parse',
      compile: 'POST /compile',
      compose: 'POST /compose',
      safety: 'POST /check/safety',
      progress: 'POST /check/progress',
      ltl: 'POST /check/ltl',
      // Transpiler endpoints
      transpile: 'POST /transpile',
      transpileAndRun: 'POST /transpile-and-run',
      dockerStatus: 'GET /docker/status'
    }
  });
});

// Health check
app.get('/health', asyncHandler(async (req: Request, res: Response) => {
  const { existsSync } = await import('fs');
  
  // Check if ltsp.jar exists
  const jarExists = existsSync(LTSP_JAR_PATH);
  
  // Check if Java is available
  let javaAvailable = false;
  try {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn('java', ['-version']);
      proc.on('close', (code) => {
        javaAvailable = code === 0;
        resolve();
      });
      proc.on('error', () => resolve());
      setTimeout(() => {
        proc.kill();
        resolve();
      }, 5000);
    });
  } catch {
    javaAvailable = false;
  }

  // Check Docker status
  const dockerAvailable = await isDockerAvailable();
  const goImageAvailable = dockerAvailable ? await isGoImageAvailable() : false;
  
  res.json({
    status: jarExists && javaAvailable ? 'healthy' : 'unhealthy',
    ltsa: {
      ltsp_jar_exists: jarExists,
      ltsp_jar_path: LTSP_JAR_PATH,
      java_available: javaAvailable
    },
    docker: {
      available: dockerAvailable,
      go_image_available: goImageAvailable
    }
  });
}));

// Parse endpoint
app.post('/parse', asyncHandler(async (req: Request, res: Response) => {
  const { content } = req.body as LTSRequest;
  
  if (!content) {
    res.status(400).json({ error: 'content is required' });
    return;
  }
  
  const result = await executeLtspCommand(content, ['-b', 'parse']);
  res.json(result);
}));

// Compile endpoint
app.post('/compile', asyncHandler(async (req: Request, res: Response) => {
  const { content, process: processName = 'DEFAULT' } = req.body as LTSRequest;
  
  if (!content) {
    res.status(400).json({ error: 'content is required' });
    return;
  }
  
  const result = await executeLtspCommand(content, ['-b', 'compile', '-p', processName]);
  res.json(result);
}));

// Compose endpoint
app.post('/compose', asyncHandler(async (req: Request, res: Response) => {
  const { content, process: processName = 'DEFAULT' } = req.body as LTSRequest;
  
  if (!content) {
    res.status(400).json({ error: 'content is required' });
    return;
  }
  
  const result = await executeLtspCommand(content, ['-b', 'compose', '-p', processName]);
  res.json(result);
}));

// Safety check endpoint
app.post('/check/safety', asyncHandler(async (req: Request, res: Response) => {
  const { content, process: processName = 'DEFAULT' } = req.body as LTSRequest;
  
  if (!content) {
    res.status(400).json({ error: 'content is required' });
    return;
  }
  
  const result = await executeLtspCommand(content, ['-c', 'safety', '-p', processName]);
  res.json(result);
}));

// Progress check endpoint
app.post('/check/progress', asyncHandler(async (req: Request, res: Response) => {
  const { content, process: processName = 'DEFAULT' } = req.body as LTSRequest;
  
  if (!content) {
    res.status(400).json({ error: 'content is required' });
    return;
  }
  
  const result = await executeLtspCommand(content, ['-c', 'progress', '-p', processName]);
  res.json(result);
}));

// LTL property check endpoint
app.post('/check/ltl', asyncHandler(async (req: Request, res: Response) => {
  const { content, process: processName = 'DEFAULT', property } = req.body as LTLRequest;
  
  if (!content) {
    res.status(400).json({ error: 'content is required' });
    return;
  }
  
  if (!property) {
    res.status(400).json({ error: 'property is required' });
    return;
  }
  
  const result = await executeLtspCommand(content, ['-c', 'ltl_property', '-p', processName, '-l', property]);
  res.json(result);
}));

// ═══════════════════════════════════════════════════════════════════════════
// Transpiler Endpoints
// ═══════════════════════════════════════════════════════════════════════════

// Docker status endpoint
app.get('/docker/status', asyncHandler(async (req: Request, res: Response) => {
  const dockerAvailable = await isDockerAvailable();
  
  if (!dockerAvailable) {
    res.json({
      available: false,
      go_image_available: false,
      message: 'Docker is not available. Please ensure Docker is installed and running.'
    });
    return;
  }

  const goImageAvailable = await isGoImageAvailable();
  
  res.json({
    available: true,
    go_image_available: goImageAvailable,
    message: goImageAvailable 
      ? 'Docker and Go image are ready' 
      : 'Docker available but Go image needs to be pulled. POST to /docker/pull to download.'
  });
}));

// Pull Go Docker image
app.post('/docker/pull', asyncHandler(async (req: Request, res: Response) => {
  const dockerAvailable = await isDockerAvailable();
  
  if (!dockerAvailable) {
    res.status(503).json({
      success: false,
      error: 'Docker is not available. Please ensure Docker is installed and running.'
    });
    return;
  }

  const result = await pullGoImage();
  
  res.json({
    success: result.success,
    message: result.message
  });
}));

// Transpile LTS spec to Go code
app.post('/transpile', asyncHandler(async (req: Request, res: Response) => {
  const { spec } = req.body as TranspileRequest;
  
  if (!spec) {
    res.status(400).json({ error: 'spec is required' });
    return;
  }

  try {
    let goCode: string;
    
    // Detect format: flat array or structured spec
    if (Array.isArray(spec)) {
      goCode = transpileFlat(spec as FlatTransition[]);
    } else if ((spec as LTSSpec).processes) {
      goCode = transpile(spec as LTSSpec);
    } else {
      res.status(400).json({ 
        error: 'Invalid spec format. Expected either an array of flat transitions or an object with "processes" property.' 
      });
      return;
    }

    res.json({
      success: true,
      goCode,
      lineCount: goCode.split('\n').length
    });
  } catch (err) {
    res.status(400).json({
      success: false,
      error: err instanceof Error ? err.message : 'Transpilation failed'
    });
  }
}));

// Transpile and run in Docker
app.post('/transpile-and-run', asyncHandler(async (req: Request, res: Response) => {
  const { spec, timeoutMs, memoryLimit, cpuLimit } = req.body as TranspileAndRunRequest;
  
  if (!spec) {
    res.status(400).json({ error: 'spec is required' });
    return;
  }

  // Check Docker availability
  const dockerAvailable = await isDockerAvailable();
  if (!dockerAvailable) {
    res.status(503).json({
      success: false,
      error: 'Docker is not available. Please ensure Docker is installed and running.',
      goCode: null,
      execution: null
    });
    return;
  }

  // Check if Go image is available
  const goImageAvailable = await isGoImageAvailable();
  if (!goImageAvailable) {
    res.status(503).json({
      success: false,
      error: 'Go Docker image not available. POST to /docker/pull first to download the image.',
      goCode: null,
      execution: null
    });
    return;
  }

  // Transpile
  let goCode: string;
  try {
    if (Array.isArray(spec)) {
      goCode = transpileFlat(spec as FlatTransition[]);
    } else if ((spec as LTSSpec).processes) {
      goCode = transpile(spec as LTSSpec);
    } else {
      res.status(400).json({ 
        success: false,
        error: 'Invalid spec format. Expected either an array of flat transitions or an object with "processes" property.',
        goCode: null,
        execution: null
      });
      return;
    }
  } catch (err) {
    res.status(400).json({
      success: false,
      error: err instanceof Error ? err.message : 'Transpilation failed',
      goCode: null,
      execution: null
    });
    return;
  }

  // Execute in Docker
  const executionOptions: ExecutionOptions = {};
  if (timeoutMs) executionOptions.timeoutMs = timeoutMs;
  if (memoryLimit) executionOptions.memoryLimit = memoryLimit;
  if (cpuLimit) executionOptions.cpuLimit = cpuLimit;

  const execution = await executeGoCode(goCode, executionOptions);

  res.json({
    success: execution.success,
    goCode,
    execution: {
      stdout: execution.stdout,
      stderr: execution.stderr,
      exitCode: execution.exitCode,
      timedOut: execution.timedOut,
      executionTimeMs: execution.executionTimeMs,
      error: execution.error
    }
  });
}));

// Error handling middleware
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('Error:', err.message);
  
  if (err.message === 'Command execution timed out') {
    res.status(408).json({ error: 'Command execution timed out' });
    return;
  }
  
  res.status(500).json({ error: `Internal server error: ${err.message}` });
});

// Start server
app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════════════════════╗
║                                                                           ║
║     ⚒️  AnvilTS - LTS Verification & Go Transpilation API  ⚒️            ║
║                                                                           ║
╠═══════════════════════════════════════════════════════════════════════════╣
║  Server:          http://localhost:${PORT}                                   ║
║  Health check:    http://localhost:${PORT}/health                            ║
╠═══════════════════════════════════════════════════════════════════════════╣
║  LTSA Endpoints:                                                          ║
║    POST /parse           - Validate FSP syntax                            ║
║    POST /compile         - Compile FSP specification                      ║
║    POST /compose         - Compose parallel processes                     ║
║    POST /check/safety    - Check for deadlocks                            ║
║    POST /check/progress  - Check for livelocks                            ║
║    POST /check/ltl       - Verify LTL properties                          ║
╠═══════════════════════════════════════════════════════════════════════════╣
║  Transpiler Endpoints:                                                    ║
║    POST /transpile       - Convert LTS spec to Go code                    ║
║    POST /transpile-and-run - Transpile & execute in Docker               ║
║    GET  /docker/status   - Check Docker availability                      ║
║    POST /docker/pull     - Pull Go Docker image                           ║
╚═══════════════════════════════════════════════════════════════════════════╝
  `);
});

export default app;
