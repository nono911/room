import { Provider, ProviderConfig, ProviderExecuteOptions } from './provider.js';
import { fetchProviderJson } from './boundedFetch.js';

export class GeminiProvider implements Provider {
  name = 'Gemini';
  private apiKey: string;
  private modelName: string;

  constructor(config: ProviderConfig) {
    this.apiKey = config.apiKey || process.env.GEMINI_API_KEY || '';
    this.modelName = config.modelName || 'gemini-1.5-flash';
    if (!this.apiKey) {
      console.warn('Warning: Gemini API Key is missing.');
    }
  }

  async execute(prompt: string, systemInstruction?: string, options?: ProviderExecuteOptions): Promise<string> {
    if (!this.apiKey) {
      throw new Error('Gemini API key is required to execute this provider.');
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.modelName}:generateContent?key=${this.apiKey}`;
    
    const payload: {
      contents: Array<{ parts: Array<{ text: string }> }>;
      generationConfig: { temperature: number };
      systemInstruction?: { parts: Array<{ text: string }> };
    } = {
      contents: [
        {
          parts: [
            {
              text: prompt
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.2
      }
    };

    if (systemInstruction) {
      payload.systemInstruction = {
        parts: [
          {
            text: systemInstruction
          }
        ]
      };
    }

    const { response, data } = await fetchProviderJson(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`Gemini API call failed with status ${response.status}.`);
    }

    const parsed = data as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      throw new Error('Empty response from Gemini API.');
    }
    options?.onChunk?.(text);
    return text;
  }
}
