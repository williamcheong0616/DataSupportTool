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
    
    def detect_bahasa_rojak(self, text: str) -> tuple[bool, float, str]:
        """
        Detect if text contains Bahasa Rojak (code-mixing) and identify languages.
        Returns: (is_bahasa_rojak, confidence_score, detected_languages)
        """
        system = """You are a language expert specializing in Malaysian and Singaporean languages. 
Bahasa Rojak (code-mixing) is when a text mixes multiple languages, typically Malay, English, Chinese dialects, or Tamil.

Your task is to:
1. Determine if the text contains Bahasa Rojak (code-mixing)
2. Identify ALL languages used in the text (e.g., "Malay, English", "English, Mandarin, Malay", etc.)

Respond ONLY with a JSON object in this exact format:
{"is_bahasa_rojak": true/false, "confidence": 0.0-1.0, "languages": "comma-separated list of languages", "explanation": "brief reason"}"""

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
                languages = result.get("languages", "Unknown")
                
                logger.info(f"BR Detection: {is_br} (confidence: {confidence}, languages: {languages})")
                return is_br, confidence, languages
            else:
                logger.warning(f"Could not parse JSON from response: {response}")
                return False, 0.5, "Unknown"
                
        except Exception as e:
            logger.error(f"BR detection failed: {e}")
            return False, 0.5, "Unknown"
    
    def restructure_mcq_text(self, text: str, skip_restructure: bool = False) -> tuple[str, dict]:
        """
        Restructure MCQ text into a consolidated, clean format.
        If skip_restructure=True, returns original text with metadata.
        Returns: (restructured_text, metadata)
        """
        if skip_restructure:
            logger.info("Skipping restructure, keeping original text")
            return text, {
                "action": "skipped",
                "reason": "User chose to keep original text"
            }
        
        system = """You are an expert at restructuring multiple-choice questions (MCQ).
Your task is to consolidate MCQ text into a single coherent passage that:
1. Combines the question stem and all options
2. Removes formatting artifacts (A), B), etc.)
3. Creates a natural, flowing text
4. Maintains all important information
5. KEEP THE ORIGINAL LANGUAGE - Do NOT translate to English or any other language
6. Preserve all slang, shortforms, and code-mixed text exactly as they are

Output ONLY the restructured text in the SAME LANGUAGE(S) as the input, nothing else."""

        prompt = f"""Restructure this MCQ text into a clean, consolidated format.
IMPORTANT: Keep the SAME LANGUAGE(S) as the original. Do NOT translate.

{text}

Restructured text (in same language):"""

        try:
            response = self._call_generate(prompt, system=system, temperature=0.5)
            
            if response and len(response) > 10:
                logger.info(f"Restructured text: {response[:100]}...")
                return response, {
                    "action": "restructured",
                    "original_length": len(text),
                    "restructured_length": len(response)
                }
            else:
                logger.warning("Restructuring returned empty/short response, using original")
                return text, {
                    "action": "failed",
                    "reason": "Empty response from model"
                }
                
        except Exception as e:
            logger.error(f"Text restructuring failed: {e}")
            return text, {
                "action": "failed",
                "reason": str(e)
            }
    
    def generate_questions(self, text: str, count: int = 3) -> List[str]:
        """
        Generate multiple questions from the given text in Bahasa Rojak style.
        Questions should be in reverse (generated from responses/text).
        """
        system = f"""You are an expert at generating questions in Bahasa Rojak (Malaysian/Singaporean code-mixed style).

Bahasa Rojak characteristics:
- Mix of Malay and English (code-mixing)
- Use Malaysian/Singaporean slang and shortforms (lah, leh, meh, lor, kan, sikit, etc.)
- Natural conversational style
- Short, casual expressions

Your task: Generate {count} diverse questions based on the provided text/response.
The questions should:
- Be in Bahasa Rojak style (Malay-English code-mixed)
- Use slang and shortforms naturally
- Test different aspects of the text
- Sound like a natural Malaysian/Singaporean asking a question
- Be answerable from the text

Examples of Bahasa Rojak questions:
- "Apa benda yang dia cakap about the economy ah?"
- "Why lah the government buat macam tu?"
- "Can you explain sikit about this policy or not?"
- "Betul ke this thing effective meh?"

Output ONLY a JSON array of {count} questions in Bahasa Rojak, nothing else.
Format: ["Question 1?", "Question 2?", "Question 3?"]"""

        prompt = f"""Based on this text/response, generate {count} diverse questions in Bahasa Rojak style:

{text}

Remember: Use Malay-English code-mixing with slang/shortforms (lah, leh, meh, sikit, etc.)
Output JSON array of questions in Bahasa Rojak:"""

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
