"""
Example test cases for the LTSA REST API

Run the API server first, then run this script to test the endpoints.
"""

import requests
import json

BASE_URL = "http://localhost:8000"

def print_response(endpoint: str, response: dict):
    """Pretty print API response"""
    print(f"\n{'='*60}")
    print(f"Endpoint: {endpoint}")
    print(f"{'='*60}")
    print(json.dumps(response, indent=2))
    print(f"{'='*60}\n")

def test_health():
    """Test health check endpoint"""
    response = requests.get(f"{BASE_URL}/health")
    print_response("GET /health", response.json())

def test_parse_simple():
    """Test parsing a simple FSP specification"""
    data = {
        "content": "SWITCH = (on -> off -> SWITCH)."
    }
    response = requests.post(f"{BASE_URL}/parse", json=data)
    print_response("POST /parse (simple)", response.json())

def test_compile():
    """Test compiling an FSP specification"""
    data = {
        "content": """
SWITCH = (on -> off -> SWITCH).
USER = (on -> off -> USER).
||SYSTEM = (SWITCH || USER).
        """,
        "process": "SYSTEM"
    }
    response = requests.post(f"{BASE_URL}/compile", json=data)
    print_response("POST /compile", response.json())

def test_compose():
    """Test composing processes"""
    data = {
        "content": """
P = (a -> b -> P).
Q = (c -> d -> Q).
||SYSTEM = (P || Q).
        """,
        "process": "SYSTEM"
    }
    response = requests.post(f"{BASE_URL}/compose", json=data)
    print_response("POST /compose", response.json())

def test_safety_no_deadlock():
    """Test safety check on a deadlock-free system"""
    data = {
        "content": """
LOCK = (acquire -> release -> LOCK).
PROCESS = (acquire -> work -> release -> PROCESS).
||SYSTEM = (PROCESS || LOCK).
        """,
        "process": "SYSTEM"
    }
    response = requests.post(f"{BASE_URL}/check/safety", json=data)
    print_response("POST /check/safety (no deadlock)", response.json())

def test_safety_with_deadlock():
    """Test safety check on a system with potential deadlock"""
    data = {
        "content": """
P = (a -> b -> P).
Q = (b -> a -> Q).
||SYSTEM = (P || Q).
        """,
        "process": "SYSTEM"
    }
    response = requests.post(f"{BASE_URL}/check/safety", json=data)
    print_response("POST /check/safety (potential deadlock)", response.json())

def test_progress():
    """Test progress check"""
    data = {
        "content": """
COUNTER = COUNT[0],
COUNT[i:0..3] = (when (i<3) inc -> COUNT[i+1]
                |when (i>0) dec -> COUNT[i-1]).
progress INC = {inc}
        """,
        "process": "DEFAULT"
    }
    response = requests.post(f"{BASE_URL}/check/progress", json=data)
    print_response("POST /check/progress", response.json())

def test_parse_with_error():
    """Test parsing invalid FSP code"""
    data = {
        "content": "INVALID FSP CODE WITHOUT PROPER SYNTAX"
    }
    response = requests.post(f"{BASE_URL}/parse", json=data)
    print_response("POST /parse (with error)", response.json())

def run_all_tests():
    """Run all test cases"""
    try:
        print("\n" + "="*60)
        print("LTSA REST API - Test Suite")
        print("="*60)
        
        test_health()
        test_parse_simple()
        test_compile()
        test_compose()
        test_safety_no_deadlock()
        test_safety_with_deadlock()
        test_progress()
        test_parse_with_error()
        
        print("\n✓ All tests completed!")
        
    except requests.exceptions.ConnectionError:
        print("\n❌ Error: Could not connect to API server.")
        print("Please ensure the API server is running at", BASE_URL)
    except Exception as e:
        print(f"\n❌ Error: {str(e)}")

if __name__ == "__main__":
    run_all_tests()
