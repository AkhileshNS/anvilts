import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { spawn } from 'child_process';
import { writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

const app = express();
const PORT = process.env.PORT || 8000;

// Path to ltsp.jar (relative to project root)
const LTSP_JAR_PATH = join(__dirname, '..', '..', 'ltsp.jar');

// Middleware
app.use(cors());
app.use(express.json());

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
    message: 'LTSA REST API',
    version: '1.0.0',
    docs: '/health for status',
    endpoints: {
      parse: 'POST /parse',
      compile: 'POST /compile',
      compose: 'POST /compose',
      safety: 'POST /check/safety',
      progress: 'POST /check/progress',
      ltl: 'POST /check/ltl'
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
  
  res.json({
    status: jarExists && javaAvailable ? 'healthy' : 'unhealthy',
    ltsp_jar_exists: jarExists,
    ltsp_jar_path: LTSP_JAR_PATH,
    java_available: javaAvailable
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
╔════════════════════════════════════════════════════════════╗
║                    LTSA REST API                           ║
╠════════════════════════════════════════════════════════════╣
║  Server running at: http://localhost:${PORT}                  ║
║  Health check:      http://localhost:${PORT}/health           ║
╚════════════════════════════════════════════════════════════╝
  `);
});

export default app;
