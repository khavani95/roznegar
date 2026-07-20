import { GoogleGenAI } from "@google/genai";
import { config } from "@/lib/config";

let _client: GoogleGenAI | null = null;

export function getGemini(): GoogleGenAI {
  if (!_client) {
    _client = new GoogleGenAI({ apiKey: config.gemini.apiKey });
  }
  return _client;
}
