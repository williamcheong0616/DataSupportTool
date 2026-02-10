"""
Ollama Integration Setup for BR Pipeline

This script helps you set up Ollama with the BR Pipeline.
"""
import requests
import sys


def check_ollama_running():
    """Check if Ollama is running."""
    try:
        response = requests.get("http://localhost:11434/api/tags", timeout=5)
        response.raise_for_status()
        print("✅ Ollama is running")
        return True
    except Exception as e:
        print("❌ Ollama is not running")
        print(f"   Error: {e}")
        return False


def list_available_models():
    """List models currently available in Ollama."""
    try:
        response = requests.get("http://localhost:11434/api/tags", timeout=5)
        response.raise_for_status()
        models = response.json().get("models", [])
        
        if models:
            print(f"\n📦 Available models ({len(models)}):")
            for model in models:
                name = model.get("name", "unknown")
                size = model.get("size", 0) / (1024**3)  # Convert to GB
                print(f"   - {name} ({size:.1f} GB)")
        else:
            print("\n⚠️  No models found")
        
        return [m.get("name") for m in models]
    except Exception as e:
        print(f"❌ Failed to list models: {e}")
        return []


def check_model_availability(model_name: str):
    """Check if specific model is available."""
    models = list_available_models()
    is_available = model_name in models
    
    if is_available:
        print(f"\n✅ Model '{model_name}' is available")
    else:
        print(f"\n❌ Model '{model_name}' not found")
        print(f"\n💡 To install it, run:")
        print(f"   ollama pull {model_name}")
    
    return is_available


def main():
    print("=" * 60)
    print("Ollama Setup for BR Pipeline")
    print("=" * 60)
    
    # Check if Ollama is running
    if not check_ollama_running():
        print("\n💡 To start Ollama:")
        print("   1. Install: https://ollama.ai/download")
        print("   2. Run: ollama serve")
        sys.exit(1)
    
    # Check for required model
    model_name = "gemma3:4b"
    print(f"\n🔍 Checking for model: {model_name}")
    
    if not check_model_availability(model_name):
        print("\n⚠️  Required model not found")
        print("\nPlease pull the model:")
        print(f"   ollama pull {model_name}")
        print("\nThis may take a few minutes depending on your internet speed.")
        print(f"Model size: ~2.7 GB")
        sys.exit(1)
    
    print("\n" + "=" * 60)
    print("✅ Setup Complete!")
    print("=" * 60)
    print("\nYou can now use the BR Pipeline with Ollama.")
    print("\nNext steps:")
    print("1. Start the API server: python run_api.py")
    print("2. Navigate to Text Datasets page")
    print("3. Click 'Start BR Pipeline' on a dataset")
    print("\nThe pipeline will use Ollama for:")
    print("  • Bahasa Rojak detection")
    print("  • MCQ text restructuring")
    print("  • Question generation")


if __name__ == "__main__":
    main()
