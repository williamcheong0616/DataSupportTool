"""
Ollama Service for BR Pipeline
Handles communication with Ollama for BR detection, text restructuring, and question generation
"""
import os
from itertools import count

import requests
import logging
import json
import time
import gc
from typing import List, Dict, Any, Optional
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

OLLAMA_BASE_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")

logger = logging.getLogger(__name__)

# Throttle: minimum seconds between consecutive Ollama API calls
OLLAMA_CALL_DELAY = 0.3
# After this many calls, force a longer pause to let Ollama GC/recover
OLLAMA_BATCH_PAUSE_EVERY = 25
OLLAMA_BATCH_PAUSE_SECS = 5.0


def _create_http_session() -> requests.Session:
    """Create an HTTP session with connection pooling and automatic retries."""
    session = requests.Session()
    retry_strategy = Retry(
        total=3,
        backoff_factor=1,
        status_forcelist=[502, 503, 504],
        allowed_methods=["POST", "GET"],
    )
    adapter = HTTPAdapter(
        max_retries=retry_strategy,
        pool_connections=1,
        pool_maxsize=2,
    )
    session.mount("http://", adapter)
    session.mount("https://", adapter)
    return session


class OllamaService:
    """Service for interacting with Ollama API."""
    
    def __init__(self, base_url: str = OLLAMA_BASE_URL, model_name: str = "gemma3:4b"):
        self.base_url = base_url
        self.model_name = model_name
        self.generate_url = f"{base_url}/api/generate"
        self.chat_url = f"{base_url}/api/chat"
        self._session = _create_http_session()
        self._call_count = 0
        self._last_call_time = 0.0
    
    def _throttle(self):
        """Rate-limit calls to prevent Ollama from freezing under sustained load."""
        now = time.monotonic()
        elapsed = now - self._last_call_time
        if elapsed < OLLAMA_CALL_DELAY:
            time.sleep(OLLAMA_CALL_DELAY - elapsed)
        
        self._call_count += 1
        
        # Periodic longer pause to let Ollama free GPU/CPU resources
        if self._call_count > 0 and self._call_count % OLLAMA_BATCH_PAUSE_EVERY == 0:
            logger.info(f"Ollama throttle: {self._call_count} calls done. Flushing model from memory and pausing {OLLAMA_BATCH_PAUSE_SECS}s")
            
            # Explicitly drop the model from VRAM/RAM immediately
            try:
                flush_payload = {"model": self.model_name, "keep_alive": 0}
                self._session.post(self.generate_url, json=flush_payload, timeout=10)
            except Exception as e:
                logger.warning(f"Failed to send flush request to Ollama: {e}")
                
            gc.collect()
            time.sleep(OLLAMA_BATCH_PAUSE_SECS)
        
        self._last_call_time = time.monotonic()
    
    def _call_generate(self, prompt: str, system: Optional[str] = None, temperature: float = 0.7) -> str:
        """Call Ollama generate API with throttling and connection reuse."""
        self._throttle()
        
        payload = {
            "model": self.model_name,
            "prompt": prompt,
            "stream": False,
            "keep_alive": "10m",
            "options": {
                "temperature": temperature,
                "num_predict": 300,
                "num_ctx": 4096
            }
        }
        
        if system:
            payload["system"] = system
        
        try:
            response = self._session.post(self.generate_url, json=payload, timeout=120)
            response.raise_for_status()
            result = response.json()
            return result.get("response", "").strip()
        except requests.exceptions.RequestException as e:
            logger.error(f"Ollama API error (call #{self._call_count}): {e}")
            # Retry after a cooldown — Ollama may be recovering from resource pressure
            logger.info("Retrying after 5s cooldown...")
            time.sleep(5)
            try:
                response = self._session.post(self.generate_url, json=payload, timeout=180)
                response.raise_for_status()
                result = response.json()
                return result.get("response", "").strip()
            except requests.exceptions.RequestException as e2:
                logger.error(f"Ollama API retry also failed: {e2}")
                raise Exception(f"Failed to call Ollama after retry: {str(e2)}")
    
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
        system = f"""You are an expert Dataset Engineer and Malaysian Linguistics Specialist tasked with generating grounded QA (Question-Answering) pairs for a conversational retail SLM training dataset.

THE CONVERSATIONAL PARADIGM:
You must generate questions from the perspective of a PROSPECTIVE BUYER asking the ASSISTANT about a specific product. 
•⁠  ⁠The user is a curious potential customer seeking advice or clarification before making a purchase.
•⁠  ⁠The assistant serves as the source of truth based on the provided review text.
•⁠  ⁠The generated question must naturally prompt the provided text as the logical reply from the assistant.

BAHASA ROJAK CHARACTERISTICS:
•⁠  ⁠Mix of Malay (majority) and English (code-mixing).
•⁠  ⁠Use casual but respectful local community terms (e.g., boss, sis, bang, bro, you, I, awak, nak tanya sikit).
•⁠  ⁠Natural, conversational Q&A style typical of Malaysian e-commerce inquiries.

NEGATIVE CONSTRAINTS (FORBIDDEN PATTERNS - DO NOT DO THIS):
1.⁠ ⁠NO REDUPLICATION FOR FILLERS: STRICTLY DO NOT use "sikit-sikit" as a question tag or filler. "Sikit-sikit" means "little by little" and is grammatically incorrect in this context. You may only use "sikit" (singular) as a polite softener (e.g., "Nak tanya sikit").
2.⁠ ⁠NO AWKWARD PARTICLES: DO NOT place the particle "eh" at the end of a question (e.g., "sesuai tak, eh?"). For direct questions, use "ke", "kan", or "tak" (e.g., "sesuai ke tak?", "laju kan?").
3.⁠ ⁠NO DIRECT TRANSLATION GIBBERISH: DO NOT invent nonsensical phrases like "sikit-sikit mana". Ensure the Malay sentence structure remains grammatically sound even when code-mixing.
4.⁠ ⁠NO SLANG SPAMMING: Use slang naturally. Do not force unnatural amounts of slang into a single sentence just to meet the dialect requirement.

YOUR TASK: Generate {count} diverse, DETAILED questions based STRICTLY on the provided text/response.

CRITICAL ANTI-HALLUCINATION RULES:
1.⁠ ⁠STRICT GROUNDING: You MUST ONLY ask questions that can be 100% answered using the facts explicitly stated in the provided text. 
2.⁠ ⁠NO ASSUMPTIONS: Do not ask about external factors (e.g., delivery time, warranty, stitching quality) UNLESS the text explicitly mentions them. 
3.⁠ ⁠If the text only discusses 'packaging' and 'shipping speed', your questions must ONLY be about 'packaging' and 'shipping speed'.
4.⁠ ⁠If a human cannot find the answer to your generated question within the provided text, your question is invalid.

REQUIREMENTS:
•⁠  ⁠MUST be in Bahasa Rojak style with MALAY as the MAJORITY language.
•⁠  ⁠Combine multiple facts from the text into a single detailed question.

EXAMPLE OF A PERFECT PROSPECTIVE BUYER GROUNDED QUESTION:
Provided Text: "Barang sampai safely. Wrapping pun mantap giler, bubble wrap tebal. Delivery laju, semalam order harini sampai. Trusted seller!"
Generated Question: "Hi boss, nak tanya sikit pasal barang ni, barang boleh selamat sampai tanpa rosak? I plan nak order juga tapi nak tahu seller packing okay ke tak, and delivery dia laju ke?"

Output ONLY a flat JSON array of {count} DETAILED questions in Bahasa Rojak, nothing else.
Format: ["Question 1?", "Question 2?", "Question 3?"]"""

        prompt = f"""Based on this restructured text/answer, reverse-engineer {count} diverse, DETAILED questions from the perspective of a PROSPECTIVE BUYER asking the ASSISTANT in Bahasa Rojak style:

{text}

REQUIREMENTS:
•⁠  ⁠PROSPECTIVE BUYER ROLE: Ask as a potential customer inquiring about the product details from the assistant.
•⁠  ⁠FACTUAL GROUNDING: Ensure every single question can be fully answered using ONLY the text provided. Do not ask about unmentioned details.
•⁠  ⁠LINGUISTICS: Use MALAY as the MAJORITY language, codemixed with English retail terms and polite community slang (boss, sis, nak tanya). STRICTLY adhere to the Negative Constraints (no "sikit-sikit", no ending with "eh").
Output ONLY a JSON array of DETAILED Bahasa Rojak questions:"""
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
        detect_problems: bool = True,
        system_prompt: str = None,
    ) -> tuple[str, List[str]]:
        """
        Generate a response to a question based on context in Bahasa Rojak style.
        Optionally detect problems in the response (hallucinations, errors).
        """
        system = system_prompt or """You are a helpful AI assistant that answers questions in Bahasa Rojak (Malaysian/Singaporean code-mixed style).

Bahasa Rojak characteristics:
- Mix of Malay (MAJORITY language) and English
- Use Malaysian/Singaporean slang and shortforms naturally (lah, leh, meh, lor, kan, sikit, macam, tau tak, betul tak, etc.)
- Natural conversational style
- Casual but informative tone

Your task: Answer the question based on the provided context/text.
The answer MUST:
- Be in Bahasa Rojak style with MALAY as MAJORITY language, codemixed with English
- Use slang/shortforms naturally (lah, leh, meh, sikit, macam, tau tak, betul tak)
- Be DETAILED and informative (not too short!)
- Directly address the question
- Reference specific details from the context
- Sound natural and conversational"""

        prompt = f"""Context/Text:
{context}

Question: {question}

REQUIREMENTS:
- Answer in Bahasa Rojak (Malay majority + English codemix)
- Use slang (lah, leh, meh, sikit, macam, tau tak, betul tak)
- Be detailed and informative
- Directly reference the context above

Answer in Bahasa Rojak:"""

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
            
            logger.info(f"Generated Bahasa Rojak response: {response[:100]}...")
            return response, problems
                
        except Exception as e:
            logger.error(f"Response generation failed: {e}")
            return f"Error generating response: {str(e)}", ["API Error"]
    
    def check_model_available(self) -> bool:
        """Check if Ollama is running and model is available."""
        try:
            response = self._session.get(f"{self.base_url}/api/tags", timeout=5)
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


def get_ollama_service(model_name: Optional[str] = None) -> OllamaService:
    """Get or create the global Ollama service instance. Reads config from settings.json."""
    global _ollama_service
    
    # Read from settings if no explicit model given
    if model_name is None:
        try:
            from backend.routes.settings import load_settings
            settings = load_settings()
            model_name = settings.get("ollama_model", "gemma3:4b")
            base_url = settings.get("ollama_base_url", "http://localhost:11434")
        except Exception:
            model_name = "gemma3:4b"
            base_url = "http://localhost:11434"
    else:
        base_url = "http://localhost:11434"
    
    # Fallback in case settings returned None
    model_name = model_name or "gemma3:4b"
    base_url = base_url or "http://localhost:11434"

    if _ollama_service is None or _ollama_service.model_name != model_name:
        _ollama_service = OllamaService(base_url=base_url, model_name=model_name)
    return _ollama_service
