from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Optional
import subprocess
import tempfile
import os
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="LTSA REST API",
    description="REST API wrapper for the LTSA (Labeled Transition System Analyzer) CLI",
    version="1.0.0"
)

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Path to the ltsp.jar file (relative to project root)
LTSP_JAR_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "ltsp.jar")

# Request/Response Models
class LTSRequest(BaseModel):
    content: str = Field(..., description="The content of the .lts file")
    process: Optional[str] = Field("DEFAULT", description="The composite process name")
    
class LTLRequest(LTSRequest):
    property: str = Field(..., description="The LTL property/assertion name to check")

class LTSResponse(BaseModel):
    success: bool
    output: str
    error: Optional[str] = None

# Helper function to execute ltsp.jar commands
def execute_ltsp_command(lts_content: str, args: list[str]) -> LTSResponse:
    """
    Execute a command on ltsp.jar with the given LTS content and arguments
    """
    # Create a temporary file for the LTS content
    with tempfile.NamedTemporaryFile(mode='w', suffix='.lts', delete=False, encoding='utf-8') as temp_file:
        temp_file.write(lts_content)
        temp_file_path = temp_file.name
    
    try:
        # Build the command
        command = ["java", "-jar", LTSP_JAR_PATH, temp_file_path] + args
        
        logger.info(f"Executing command: {' '.join(command)}")
        
        # Execute the command
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=30  # 30 second timeout
        )
        
        # Combine stdout and stderr for complete output
        output = result.stdout
        error = result.stderr if result.stderr else None
        
        # Check if the command was successful
        success = result.returncode == 0
        
        return LTSResponse(
            success=success,
            output=output,
            error=error
        )
        
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=408, detail="Command execution timed out")
    except FileNotFoundError:
        raise HTTPException(status_code=500, detail=f"Java or ltsp.jar not found. Please ensure Java is installed and ltsp.jar exists at {LTSP_JAR_PATH}")
    except Exception as e:
        logger.error(f"Error executing command: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")
    finally:
        # Clean up the temporary file
        try:
            os.unlink(temp_file_path)
        except Exception as e:
            logger.warning(f"Failed to delete temporary file {temp_file_path}: {str(e)}")

# API Endpoints
@app.get("/")
def root():
    """Root endpoint with API information"""
    return {
        "message": "LTSA REST API",
        "version": "1.0.0",
        "docs": "/docs",
        "endpoints": {
            "parse": "/parse",
            "compile": "/compile",
            "compose": "/compose",
            "safety": "/check/safety",
            "progress": "/check/progress",
            "ltl": "/check/ltl"
        }
    }

@app.post("/parse", response_model=LTSResponse)
def parse(request: LTSRequest):
    """
    Parse an LTS file to validate syntax
    
    Equivalent to LTSA: Build > Parse
    """
    return execute_ltsp_command(request.content, ["-b", "parse"])

@app.post("/compile", response_model=LTSResponse)
def compile(request: LTSRequest):
    """
    Compile an LTS file (also parses it)
    
    Equivalent to LTSA: Build > Compile
    """
    args = ["-b", "compile", "-p", request.process]
    return execute_ltsp_command(request.content, args)

@app.post("/compose", response_model=LTSResponse)
def compose(request: LTSRequest):
    """
    Compose (parallelize) the specified composite process
    
    Equivalent to LTSA: Build > Compose
    """
    args = ["-b", "compose", "-p", request.process]
    return execute_ltsp_command(request.content, args)

@app.post("/check/safety", response_model=LTSResponse)
def check_safety(request: LTSRequest):
    """
    Check if processes are deadlock-free
    
    Equivalent to LTSA: Check > Safety
    """
    args = ["-c", "safety", "-p", request.process]
    return execute_ltsp_command(request.content, args)

@app.post("/check/progress", response_model=LTSResponse)
def check_progress(request: LTSRequest):
    """
    Check for progress violations (livelocks)
    
    Equivalent to LTSA: Check > Progress
    """
    args = ["-c", "progress", "-p", request.process]
    return execute_ltsp_command(request.content, args)

@app.post("/check/ltl", response_model=LTSResponse)
def check_ltl(request: LTLRequest):
    """
    Check if a specified LTL property holds
    
    Equivalent to LTSA: Check > LTL Property
    """
    args = ["-c", "ltl_property", "-p", request.process, "-l", request.property]
    return execute_ltsp_command(request.content, args)

@app.get("/health")
def health_check():
    """Health check endpoint"""
    # Check if ltsp.jar exists
    jar_exists = os.path.exists(LTSP_JAR_PATH)
    
    # Check if Java is available
    java_available = False
    try:
        subprocess.run(["java", "-version"], capture_output=True, timeout=5)
        java_available = True
    except:
        pass
    
    return {
        "status": "healthy" if (jar_exists and java_available) else "unhealthy",
        "ltsp_jar_exists": jar_exists,
        "ltsp_jar_path": LTSP_JAR_PATH,
        "java_available": java_available
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
