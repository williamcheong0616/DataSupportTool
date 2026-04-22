"""Script to run the FastAPI backend server."""
import uvicorn
import sys
import os
from pathlib import Path
from config import API_HOST, API_PORT

# Add the project root to sys.path to ensure 'backend' module is findable
project_root = str(Path(__file__).parent.absolute())
if project_root not in sys.path:
    sys.path.insert(0, project_root)

if __name__ == "__main__":
    uvicorn.run(
        "backend.api:app",
        host=API_HOST,
        port=API_PORT,
        reload=True,
        reload_dirs=["backend", "config.py"],
        reload_excludes=[".conda", "node_modules", "data", "logs", "__pycache__"],
    )
