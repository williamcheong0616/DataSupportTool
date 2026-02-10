"""
Ollama Service for BR Pipeline
Handles communication with Ollama for BR detection, text restructuring, and question generation
"""
import requests
import logging
import json
from typing import List, Dict, Any, Optional

logger = logging.getLogger(__name__)


class OllamaService:
    """Service for interacting with Ollama API."""
    
    def __init__(self, base_url: str = "http://localhost:11434", model_name: str = "gemma3:4b"):
        self.base_url = base_url
        self.model_name = model_name
        self.generate_url = f"{base_url}/api/generate"
        self.chat_url = f"{base_url}/api/chat"
    
    def _call_generate(self, prompt: str, system: Optional[str] = None, temperature: float = 0.7) -> str:
        """Call Ollama generate API."""
        payload = {
            "model": self.model_name,
            "prompt": prompt,
            "stream": False,
            "options": {
                "temperature": temperature
            }
        }
        
        if system:
            payload["system"] = system
        
        try:
            response = requests.post(self.generate_url, json=payload, timeout=120)
            response.raise_for_status()
            result = response.json()
            return result.get("response", "").strip()
        except requests.exceptions.RequestException as e:
            logger.error(f"Ollama API error: {e}")
            raise Exception(f"Failed to call Ollama: {str(e)}")
    
    def detect_bahasa_rojak(self, text: str) -> tuple[bool, float]:
        """
        Detect if text contains Bahasa Rojak (code-mixing).
        Returns: (is_bahasa_rojak, confidence_score)
        """
        system = """You are a language expert specializing in Malaysian and Singaporean languages. 
Bahasa Rojak (code-mixing) is when a text mixes multiple languages, typically Malay, English, Chinese dialects, or Tamil.

Your task is to determine if the given text contains Bahasa Rojak.
Respond ONLY with a JSON object in this exact format:
{"is_bahasa_rojak": true/false, "confidence": 0.0-1.0, "explanation": "brief reason"}"""

        prompt = f"""Analyze this text for Bahasa Rojak (code-mixing):

Text: {text}

Respond with JSON only:"""

        try:
            response = self._call_generate(prompt, system=system, temperature=0.3)
            
            # Try to extract JSON from response
            json_start = response.find('{')
            json_end = response.rfind('}') + 1
            if json_start >= 0 and json_end > json_start:
                json_str = response[json_start:json_end]
                result = json.loads(json_str)
                
                is_br = result.get("is_bahasa_rojak", False)
                confidence = result.get("confidence", 0.5)
                
                logger.info(f"BR Detection: {is_br} (confidence: {confidence})")
                return is_br, confidence
            else:
                logger.warning(f"Could not parse JSON from response: {response}")
                return False, 0.5
                
        except Exception as e:
            logger.error(f"BR detection failed: {e}")
            return False, 0.5
    
    def restructure_mcq_text(self, text: str) -> str:
        """
        Restructure MCQ text into a consolidated, clean format.
        """
        system = """You are an expert at restructuring multiple-choice questions (MCQ).
Your task is to consolidate MCQ text into a single coherent passage that:
1. Combines the question stem and all options
2. Removes formatting artifacts (A), B), etc.)
3. Creates a natural, flowing text
4. Maintains all important information

Output ONLY the restructured text, nothing else."""

        prompt = f"""Restructure this MCQ text into a clean, consolidated format:

{text}

Restructured text:"""

        try:
            response = self._call_generate(prompt, system=system, temperature=0.5)
            
            if response and len(response) > 10:
                logger.info(f"Restructured text: {response[:100]}...")
                return response
            else:
                logger.warning("Restructuring returned empty/short response, using original")
                return text
                
        except Exception as e:
            logger.error(f"Text restructuring failed: {e}")
            return text
    
    def generate_questions(self, text: str, count: int = 3) -> List[str]:
        """
        Generate multiple questions from the given text.
        """
        system = f"""You are an expert question generator. 
Your task is to generate {count} diverse, thoughtful questions based on the given text.
Questions should:
- Be clear and specific
- Test different aspects of understanding
- Be answerable from the text
- Vary in difficulty and focus

Output ONLY a JSON array of {count} questions, nothing else.
Format: ["Question 1?", "Question 2?", "Question 3?"]"""

        prompt = f"""Generate {count} diverse questions from this text:

{text}

Output JSON array of questions:"""

        try:
            response = self._call_generate(prompt, system=system, temperature=0.8)
            
            # Try to extract JSON array from response
            json_start = response.find('[')
            json_end = response.rfind(']') + 1
            if json_start >= 0 and json_end > json_start:
                json_str = response[json_start:json_end]
                questions = json.loads(json_str)
                
                if isinstance(questions, list) and len(questions) >= count:
                    logger.info(f"Generated {len(questions)} questions")
                    return questions[:count]
            
            # Fallback: split by lines
            lines = [line.strip() for line in response.split('\n') if line.strip()]
            questions = []
            for line in lines:
                # Remove numbering and quotes
                clean = line.strip('0123456789. "\'').strip()
                if len(clean) > 10 and '?' in clean:
                    questions.append(clean)
            
            if len(questions) >= count:
                return questions[:count]
            
            # Last resort: generate generic questions
            logger.warning(f"Could not parse {count} questions, using fallback")
            return [
                f"What is the main topic of this text?",
                f"What are the key points mentioned in the text?",
                f"Can you explain the significance of the information in the text?"
            ][:count]
                
        except Exception as e:
            logger.error(f"Question generation failed: {e}")
            return [
                f"What is the main topic of this text?",
                f"What are the key points mentioned?",
                f"What is the significance of this information?"
            ][:count]
    
    def generate_model_response(
        self, 
        context: str, 
        question: str,
        detect_problems: bool = True
    ) -> tuple[str, List[str]]:
        """
        Generate a response to a question based on context.
        Optionally detect problems in the response (hallucinations, errors).
        """
        system = """You are a helpful AI assistant. Answer questions based on the provided context accurately and concisely."""

        prompt = f"""Context:
{context}

Question: {question}

Answer:"""

        try:
            response = self._call_generate(prompt, system=system, temperature=0.7)
            
            problems = []
            if detect_problems:
                # Simple problem detection (can be enhanced)
                if not response or len(response) < 10:
                    problems.append("Response too short or empty")
                
                # Check if response references the context
                if "I don't know" in response.lower() or "cannot answer" in response.lower():
                    problems.append("Model declined to answer")
            
            logger.info(f"Generated response: {response[:100]}...")
            return response, problems
                
        except Exception as e:
            logger.error(f"Response generation failed: {e}")
            return f"Error generating response: {str(e)}", ["API Error"]
    
    def check_model_available(self) -> bool:
        """Check if Ollama is running and model is available."""
        try:
            response = requests.get(f"{self.base_url}/api/tags", timeout=5)
            response.raise_for_status()
            models = response.json().get("models", [])
            model_names = [m.get("name") for m in models]
            
            is_available = self.model_name in model_names
            if is_available:
                logger.info(f"Ollama model {self.model_name} is available")
            else:
                logger.warning(f"Ollama model {self.model_name} not found. Available: {model_names}")
            
            return is_available
        except Exception as e:
            logger.error(f"Failed to check Ollama availability: {e}")
            return False


# Global instance
_ollama_service = None


def get_ollama_service(model_name: str = "gemma3:4b") -> OllamaService:
    """Get or create the global Ollama service instance."""
    global _ollama_service
    if _ollama_service is None or _ollama_service.model_name != model_name:
        _ollama_service = OllamaService(model_name=model_name)
    return _ollama_service
