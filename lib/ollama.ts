/**
 * Ollama Integration for Local LLM
 * Connects to Ollama running locally for football predictions and chat
 */

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const DEFAULT_MODEL = 'llama2'; // Can be changed to mistral, neural-chat, etc.
const REQUEST_TIMEOUT = 120000; // 2 minutes for predictions

export interface OllamaGenerateResponse {
  model: string;
  created_at: string;
  response: string;
  done: boolean;
  context?: number[];
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

export interface OllamaChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OllamaChatResponse {
  model: string;
  created_at: string;
  message: OllamaChatMessage;
  done: boolean;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

/**
 * Check if Ollama is available
 */
export async function checkOllamaHealth(): Promise<boolean> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)

  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
      method: 'GET',
      signal: controller.signal,
    })
    return response.ok
  } catch {
    return false
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Get list of available models
 */
export async function getAvailableModels(): Promise<string[]> {
  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`);
    if (!response.ok) return [];

    const data = (await response.json()) as { models?: Array<{ name: string }> };
    return data.models?.map((m) => m.name) || [];
  } catch {
    return [];
  }
}

/**
 * Generate a prediction using Ollama
 * Streams the response back to the client
 */
export async function generatePrediction(
  prompt: string,
  model: string = DEFAULT_MODEL
): Promise<ReadableStream<Uint8Array>> {
  const systemPrompt = `You are an expert football/soccer analyst with deep knowledge of match statistics, team form, player injuries, and betting markets. 
You analyze matches objectively using available data and provide probability-based predictions for various betting markets (1X2, Over/Under, BTTS, Corners, Yellow Cards).
Always explain your reasoning with statistics and form analysis.`;

  const response = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      prompt: `${systemPrompt}\n\n${prompt}`,
      stream: true,
      temperature: 0.7,
    }),
    // @ts-ignore - Custom timeout option
    timeout: REQUEST_TIMEOUT,
  });

  if (!response.ok) {
    throw new Error(`Ollama error: ${response.status} ${response.statusText}`);
  }

  if (!response.body) {
    throw new Error('No response body from Ollama');
  }

  return response.body;
}

/**
 * Chat with Ollama for conversational predictions
 */
export async function chatWithOllama(
  messages: OllamaChatMessage[],
  model: string = DEFAULT_MODEL
): Promise<ReadableStream<Uint8Array>> {
  const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      temperature: 0.7,
    }),
    // @ts-ignore - Custom timeout option
    timeout: REQUEST_TIMEOUT,
  });

  if (!response.ok) {
    throw new Error(`Ollama chat error: ${response.status} ${response.statusText}`);
  }

  if (!response.body) {
    throw new Error('No response body from Ollama');
  }

  return response.body;
}

/**
 * Generate a non-streaming prediction
 * Useful for API responses that aren't streaming
 */
export async function generatePredictionNonStream(
  prompt: string,
  model: string = DEFAULT_MODEL
): Promise<string> {
  const systemPrompt = `You are an expert football/soccer analyst with deep knowledge of match statistics, team form, player injuries, and betting markets. 
You analyze matches objectively using available data and provide probability-based predictions for various betting markets (1X2, Over/Under, BTTS, Corners, Yellow Cards).
Always explain your reasoning with statistics and form analysis.
Keep response concise (2-3 paragraphs max).`;

  const response = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      prompt: `${systemPrompt}\n\n${prompt}`,
      stream: false,
      temperature: 0.7,
    }),
    // @ts-ignore - Custom timeout option
    timeout: REQUEST_TIMEOUT,
  });

  if (!response.ok) {
    throw new Error(`Ollama error: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as OllamaGenerateResponse;
  return data.response;
}

/**
 * Build a prediction prompt from match data
 */
export function buildPredictionPrompt(
  homeTeam: string,
  awayTeam: string,
  homeForm?: string,
  awayForm?: string,
  headToHead?: string,
  injuries?: string
): string {
  let prompt = `Analyze the upcoming football match and provide betting predictions:\n\n`;
  prompt += `Match: ${homeTeam} vs ${awayTeam}\n`;

  if (homeForm) {
    prompt += `${homeTeam} recent form: ${homeForm}\n`;
  }
  if (awayForm) {
    prompt += `${awayTeam} recent form: ${awayForm}\n`;
  }
  if (headToHead) {
    prompt += `Head-to-head history: ${headToHead}\n`;
  }
  if (injuries) {
    prompt += `Injury news: ${injuries}\n`;
  }

  prompt += `\nProvide predictions for:\n`;
  prompt += `1. Match Result (1X2): Probability for Home Win, Draw, Away Win\n`;
  prompt += `2. Over/Under 2.5 Goals\n`;
  prompt += `3. Both Teams to Score (BTTS)\n`;
  prompt += `4. Expected Corner Count\n`;
  prompt += `5. Expected Yellow Cards\n`;

  return prompt;
}

/**
 * Build a chat context message with match info
 */
export function buildMatchContext(
  homeTeam: string,
  awayTeam: string,
  homeScore?: number,
  awayScore?: number,
  matchStatus?: string
): string {
  let context = `Current Match: ${homeTeam} vs ${awayTeam}`;
  if (homeScore !== undefined && awayScore !== undefined) {
    context += ` (${homeScore}-${awayScore})`;
  }
  if (matchStatus) {
    context += ` - ${matchStatus}`;
  }
  return context;
}
