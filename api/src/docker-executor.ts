// ═══════════════════════════════════════════════════════════════════════════
// Docker Executor - Run transpiled Go code in an isolated container
// ═══════════════════════════════════════════════════════════════════════════

import { spawn } from 'child_process';
import { writeFile, unlink, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir, platform } from 'os';
import { randomUUID } from 'crypto';

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

const DOCKER_IMAGE = 'golang:1.22-alpine';
const DEFAULT_TIMEOUT_MS = 30000; // 30 seconds
const MEMORY_LIMIT = '512m';  // Increased for Go compilation
const CPU_LIMIT = '2';        // Allow more CPU for faster compilation

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ExecutionResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  executionTimeMs: number;
  error?: string;
}

export interface ExecutionOptions {
  timeoutMs?: number;
  memoryLimit?: string;
  cpuLimit?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Docker Availability Check
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if Docker is available and running
 */
export async function isDockerAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn('docker', ['info'], { stdio: 'pipe' });
    
    proc.on('close', (code) => {
      resolve(code === 0);
    });
    
    proc.on('error', () => {
      resolve(false);
    });
    
    // Timeout after 5 seconds
    setTimeout(() => {
      proc.kill();
      resolve(false);
    }, 5000);
  });
}

/**
 * Check if the Go Docker image is available locally
 */
export async function isGoImageAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn('docker', ['image', 'inspect', DOCKER_IMAGE], { stdio: 'pipe' });
    
    proc.on('close', (code) => {
      resolve(code === 0);
    });
    
    proc.on('error', () => {
      resolve(false);
    });
    
    setTimeout(() => {
      proc.kill();
      resolve(false);
    }, 5000);
  });
}

/**
 * Pull the Go Docker image if not available
 */
export async function pullGoImage(): Promise<{ success: boolean; message: string }> {
  return new Promise((resolve) => {
    console.log(`Pulling Docker image: ${DOCKER_IMAGE}...`);
    
    const proc = spawn('docker', ['pull', DOCKER_IMAGE], { stdio: 'pipe' });
    
    let output = '';
    
    proc.stdout.on('data', (data) => {
      output += data.toString();
    });
    
    proc.stderr.on('data', (data) => {
      output += data.toString();
    });
    
    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ success: true, message: `Successfully pulled ${DOCKER_IMAGE}` });
      } else {
        resolve({ success: false, message: `Failed to pull image: ${output}` });
      }
    });
    
    proc.on('error', (err) => {
      resolve({ success: false, message: `Error pulling image: ${err.message}` });
    });
    
    // Timeout after 5 minutes for pull
    setTimeout(() => {
      proc.kill();
      resolve({ success: false, message: 'Image pull timed out' });
    }, 300000);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Go Code Execution
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Execute Go code in a Docker container
 */
/**
 * Convert Windows path to Docker-compatible path
 * Docker on Windows needs paths like /c/Users/... instead of C:\Users\...
 */
function toDockerPath(windowsPath: string): string {
  if (platform() !== 'win32') {
    return windowsPath;
  }
  // Convert C:\path\to\file to /c/path/to/file
  return windowsPath
    .replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`)
    .replace(/\\/g, '/');
}

export async function executeGoCode(
  goCode: string,
  options: ExecutionOptions = {}
): Promise<ExecutionResult> {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    memoryLimit = MEMORY_LIMIT,
    cpuLimit = CPU_LIMIT,
  } = options;

  const startTime = Date.now();
  const runId = randomUUID();
  const tempDir = join(tmpdir(), `anvilts-${runId}`);
  const goFilePath = join(tempDir, 'main.go');

  try {
    // Create temp directory and write Go file
    await mkdir(tempDir, { recursive: true });
    await writeFile(goFilePath, goCode, 'utf-8');

    // Convert path for Docker on Windows
    const dockerTempDir = toDockerPath(tempDir);

    // Generate a unique container name for proper cleanup
    const containerName = `anvilts-${runId}`;

    // Build Docker command
    // We use --rm to auto-remove container, mount the temp dir, and run go run
    const dockerArgs = [
      'run',
      '--rm',                          // Remove container after execution
      '--name', containerName,         // Named container for cleanup
      // Note: --network none removed due to Windows Docker issues
      '--memory', memoryLimit,         // Memory limit
      '--cpus', cpuLimit,              // CPU limit
      '-e', 'GOCACHE=/tmp/go-cache',   // Set Go cache to writable location
      '-e', 'HOME=/tmp',               // Set HOME to writable location
      '-v', `${dockerTempDir}:/app:ro`, // Mount Go file read-only (Docker path)
      '-w', '/app',                    // Working directory
      DOCKER_IMAGE,
      'go', 'run', 'main.go'
    ];

    console.log(`[Docker] Executing Go code (timeout: ${timeoutMs}ms, memory: ${memoryLimit})`);

    return await new Promise<ExecutionResult>((resolve) => {
      // On Windows, we need to use shell: true for Docker to work properly with spawn
      const isWindows = platform() === 'win32';
      const proc = spawn('docker', dockerArgs, { 
        stdio: ['ignore', 'pipe', 'pipe'],  // stdin ignored, stdout/stderr piped
        windowsHide: true,  // Hide console window on Windows
        shell: isWindows    // Use shell on Windows
      });
      
      let stdout = '';
      let stderr = '';
      let timedOut = false;

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      // Timeout handler - use docker kill to properly terminate the container
      const timeout = setTimeout(async () => {
        timedOut = true;
        
        // Use docker kill to forcefully stop the container
        spawn('docker', ['kill', containerName], { 
          stdio: 'ignore',
          shell: isWindows 
        });
        
        // Also try to kill the spawn process
        proc.kill('SIGKILL');
      }, timeoutMs);

      proc.on('close', (code) => {
        clearTimeout(timeout);
        const executionTimeMs = Date.now() - startTime;

        resolve({
          success: code === 0 && !timedOut,
          stdout,
          stderr,
          exitCode: code,
          timedOut,
          executionTimeMs,
        });
      });

      proc.on('error', (err) => {
        clearTimeout(timeout);
        const executionTimeMs = Date.now() - startTime;

        resolve({
          success: false,
          stdout,
          stderr,
          exitCode: null,
          timedOut: false,
          executionTimeMs,
          error: err.message,
        });
      });
    });

  } finally {
    // Cleanup temp files
    try {
      await unlink(goFilePath);
      const { rmdir } = await import('fs/promises');
      await rmdir(tempDir);
    } catch {
      // Ignore cleanup errors
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Format execution result for logging
 */
export function formatExecutionResult(result: ExecutionResult): string {
  const lines: string[] = [];
  
  lines.push(`═══════════════════════════════════════════════════════════════`);
  lines.push(`  Execution Result`);
  lines.push(`═══════════════════════════════════════════════════════════════`);
  lines.push(`  Status:    ${result.success ? '✓ SUCCESS' : '✗ FAILED'}`);
  lines.push(`  Exit Code: ${result.exitCode ?? 'N/A'}`);
  lines.push(`  Timed Out: ${result.timedOut ? 'YES' : 'No'}`);
  lines.push(`  Duration:  ${result.executionTimeMs}ms`);
  
  if (result.error) {
    lines.push(`  Error:     ${result.error}`);
  }
  
  lines.push(`───────────────────────────────────────────────────────────────`);
  
  if (result.stdout) {
    lines.push(`  STDOUT:`);
    lines.push(result.stdout.split('\n').map(l => `    ${l}`).join('\n'));
  }
  
  if (result.stderr) {
    lines.push(`  STDERR:`);
    lines.push(result.stderr.split('\n').map(l => `    ${l}`).join('\n'));
  }
  
  lines.push(`═══════════════════════════════════════════════════════════════`);
  
  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI Entry Point (for testing)
// ─────────────────────────────────────────────────────────────────────────────

if (require.main === module) {
  const testCode = `
package main

import (
    "fmt"
    "time"
)

func main() {
    fmt.Println("Hello from Docker!")
    fmt.Println("Starting countdown...")
    
    for i := 3; i > 0; i-- {
        fmt.Printf("%d...\\n", i)
        time.Sleep(500 * time.Millisecond)
    }
    
    fmt.Println("Done!")
}
`;

  (async () => {
    console.log('Checking Docker availability...');
    
    const dockerOk = await isDockerAvailable();
    if (!dockerOk) {
      console.error('Docker is not available. Please ensure Docker is installed and running.');
      process.exit(1);
    }
    console.log('✓ Docker is available');

    const imageOk = await isGoImageAvailable();
    if (!imageOk) {
      console.log('Go image not found locally, pulling...');
      const pullResult = await pullGoImage();
      if (!pullResult.success) {
        console.error(pullResult.message);
        process.exit(1);
      }
      console.log(pullResult.message);
    }
    console.log(`✓ Go image available: ${DOCKER_IMAGE}`);

    console.log('\nExecuting test Go code...\n');
    
    const result = await executeGoCode(testCode, { timeoutMs: 30000 });
    console.log(formatExecutionResult(result));
  })();
}
