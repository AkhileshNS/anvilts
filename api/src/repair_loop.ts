import { readFile, writeFile } from 'fs/promises';
import { GoogleGenerativeAI } from '@google/generative-ai';

// ═══════════════════════════════════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════════════════════════════════

const API_BASE_URL = 'http://localhost:8000';
const MAX_RETRIES = 3;
const GEMINI_MODEL = 'gemini-2.5-flash';

// ═══════════════════════════════════════════════════════════════════════════
// Styled Console Logging
// ═══════════════════════════════════════════════════════════════════════════

const styles = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  
  // Colors
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  
  // Backgrounds
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
};

function log(message: string) {
  console.log(message);
}

function logStep(step: number, message: string, color: string = styles.cyan) {
  console.log(`\n${color}${styles.bright}⚒️  Step ${step}: ${message}${styles.reset}`);
}

function logSuccess(message: string) {
  console.log(`${styles.green}${styles.bright}✓ ${message}${styles.reset}`);
}

function logError(message: string) {
  console.log(`${styles.red}${styles.bright}✗ ${message}${styles.reset}`);
}

function logWarning(message: string) {
  console.log(`${styles.yellow}⚠ ${message}${styles.reset}`);
}

function logInfo(message: string) {
  console.log(`${styles.blue}ℹ ${message}${styles.reset}`);
}

function printBanner() {
  console.log(`
${styles.magenta}${styles.bright}
╔═══════════════════════════════════════════════════════════════════════════╗
║                                                                           ║
║     ⚒️  AnviLTS - Self-Healing Concurrent System Forge  ⚒️                ║
║                                                                           ║
╚═══════════════════════════════════════════════════════════════════════════╝
${styles.reset}`);
}

function printVictory() {
  console.log(`
${styles.green}${styles.bright}
╔═══════════════════════════════════════════════════════════════════════════╗
║                                                                           ║
║     🎉  VERIFICATION PASSED - Your system is DEADLOCK-FREE!  🎉          ║
║                                                                           ║
╚═══════════════════════════════════════════════════════════════════════════╝
${styles.reset}`);
}

function printFailure() {
  console.log(`
${styles.red}${styles.bright}
╔═══════════════════════════════════════════════════════════════════════════╗
║                                                                           ║
║     💔  MAX RETRIES REACHED - Could not heal the system  💔              ║
║                                                                           ║
╚═══════════════════════════════════════════════════════════════════════════╝
${styles.reset}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// API Interaction
// ═══════════════════════════════════════════════════════════════════════════

interface VerificationResult {
  success: boolean;
  output: string;
  error: string | null;
}

async function verifyLTS(content: string, processName: string): Promise<VerificationResult> {
  const response = await fetch(`${API_BASE_URL}/check/safety`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, process: processName })
  });
  
  if (!response.ok) {
    throw new Error(`API request failed: ${response.statusText}`);
  }
  
  return response.json();
}

// ═══════════════════════════════════════════════════════════════════════════
// Gemini AI Interaction
// ═══════════════════════════════════════════════════════════════════════════

async function healWithGemini(
  originalCode: string,
  errorOutput: string,
  apiKey: string
): Promise<string> {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });
  
  const prompt = `You are the AnviLTS Architect. The following LTS code failed verification with a deadlock error.

Here is the original code:
\`\`\`
${originalCode}
\`\`\`

Here is the error/trace from LTSA:
\`\`\`
${errorOutput}
\`\`\`

Re-write the code to fix the issue (e.g., using an asymmetric approach for philosophers where one philosopher picks up forks in opposite order to break the circular wait) while maintaining the same process names (PHIL, FORK, DINERS).

Output ONLY the corrected LTS code block, no explanations or markdown formatting.`;

  const result = await model.generateContent(prompt);
  const response = await result.response;
  let text = response.text();
  
  // Clean up the response - remove markdown code blocks if present
  text = text.replace(/```(?:lts|fsp)?\n?/g, '').replace(/```$/g, '').trim();
  
  return text;
}

// ═══════════════════════════════════════════════════════════════════════════
// Main Repair Loop
// ═══════════════════════════════════════════════════════════════════════════

async function repairLoop(filePath: string, processName: string) {
  printBanner();
  
  // Check for Gemini API key
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    logError('GEMINI_API_KEY environment variable is not set!');
    logInfo('Set it with: $env:GEMINI_API_KEY = "your-api-key"  (PowerShell)');
    logInfo('         or: set GEMINI_API_KEY=your-api-key       (CMD)');
    process.exit(1);
  }
  
  logInfo(`Target file: ${filePath}`);
  logInfo(`Process to verify: ${processName}`);
  logInfo(`Max retries: ${MAX_RETRIES}`);
  
  let iteration = 0;
  
  while (iteration < MAX_RETRIES) {
    iteration++;
    
    console.log(`\n${styles.dim}${'─'.repeat(75)}${styles.reset}`);
    console.log(`${styles.bright}${styles.magenta}                         ITERATION ${iteration}/${MAX_RETRIES}${styles.reset}`);
    console.log(`${styles.dim}${'─'.repeat(75)}${styles.reset}`);
    
    // Step 1: Read and Forge
    logStep(1, 'Forging... Reading LTS specification', styles.cyan);
    
    let ltsContent: string;
    try {
      ltsContent = await readFile(filePath, 'utf-8');
      logSuccess(`Loaded ${ltsContent.split('\n').length} lines from ${filePath}`);
    } catch (err) {
      logError(`Failed to read file: ${err}`);
      process.exit(1);
    }
    
    // Step 2: Verify on the Anvil
    logStep(2, 'Striking the Anvil... Verifying with LTSA', styles.yellow);
    
    let result: VerificationResult;
    try {
      result = await verifyLTS(ltsContent, processName);
    } catch (err) {
      logError(`Failed to connect to LTSA API: ${err}`);
      logInfo('Make sure the API is running: npm run dev');
      process.exit(1);
    }
    
    // Check if verification passed
    if (result.success && !result.output.toLowerCase().includes('deadlock')) {
      printVictory();
      logSuccess('The concurrent system has been forged to perfection!');
      logInfo(`Final specification saved in: ${filePath}`);
      
      console.log(`\n${styles.dim}Final LTS Code:${styles.reset}`);
      console.log(`${styles.green}${ltsContent}${styles.reset}`);
      
      process.exit(0);
    }
    
    // Step 3: Detected a crack (failure)
    logStep(3, 'Anvil detected a crack! (Deadlock Found)', styles.red);
    
    const errorTrace = result.output || result.error || 'Unknown error';
    console.log(`${styles.dim}Error trace:${styles.reset}`);
    console.log(`${styles.red}${errorTrace.substring(0, 500)}${result.output.length > 500 ? '...' : ''}${styles.reset}`);
    
    if (iteration >= MAX_RETRIES) {
      break;
    }
    
    // Step 4: Healing with Gemini
    logStep(4, 'Calling the AnviLTS Architect (Gemini AI) for repairs...', styles.magenta);
    
    try {
      const healedCode = await healWithGemini(ltsContent, errorTrace, apiKey);
      
      logSuccess('Received healed code from Gemini');
      
      // Step 5: Update the file
      logStep(5, 'Reforging... Writing healed code to file', styles.blue);
      
      await writeFile(filePath, healedCode, 'utf-8');
      logSuccess(`Updated ${filePath} with healed specification`);
      
      console.log(`\n${styles.dim}New LTS Code:${styles.reset}`);
      console.log(`${styles.cyan}${healedCode.substring(0, 300)}${healedCode.length > 300 ? '\n...' : ''}${styles.reset}`);
      
    } catch (err) {
      logError(`Gemini healing failed: ${err}`);
      
      if (iteration >= MAX_RETRIES) {
        break;
      }
      
      logWarning('Retrying with the same code...');
    }
    
    // Brief pause before next iteration
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  // Max retries reached
  printFailure();
  logError(`Could not fix the specification after ${MAX_RETRIES} attempts.`);
  logInfo('Consider manually reviewing the specification or adjusting the prompt.');
  process.exit(1);
}

// ═══════════════════════════════════════════════════════════════════════════
// Entry Point
// ═══════════════════════════════════════════════════════════════════════════

const args = process.argv.slice(2);

if (args.length < 1) {
  console.log(`
${styles.bright}Usage:${styles.reset} npx tsx src/repair_loop.ts <lts-file> [process-name]

${styles.bright}Arguments:${styles.reset}
  lts-file      Path to the .lts file to verify and heal
  process-name  Name of the composite process to check (default: DINERS)

${styles.bright}Environment:${styles.reset}
  GEMINI_API_KEY  Your Google Gemini API key (required)

${styles.bright}Example:${styles.reset}
  $env:GEMINI_API_KEY = "your-api-key"
  npx tsx src/repair_loop.ts ../examples/deadlock_dining_philosaphers.lts DINERS
`);
  process.exit(1);
}

const filePath = args[0];
const processName = args[1] || 'DINERS';

repairLoop(filePath, processName).catch((err) => {
  logError(`Unexpected error: ${err}`);
  process.exit(1);
});
