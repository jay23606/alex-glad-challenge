// HTTP-клиент к OpenAI-совместимому Chat Completions API.
// Работает с любым провайдером: DeepSeek, OpenRouter, OpenAI, локальные сервера.

import type { ChatMessage, ChatParams, LlmRequest, LlmResponse, LlmTimings, Usage } from './types.js';
import { loadEnvUpward, getLlmProviderConfig } from './env.js';
import { netFetch } from './net.js';

loadEnvUpward();

export interface ProviderConfig {
  baseUrl: string;
  apiKey: string;
  defaultModel: string;
}

function pickProvider(): ProviderConfig {
  return getLlmProviderConfig();
}

export class LlmClient {
  private config: ProviderConfig;

  constructor(config?: ProviderConfig) {
    this.config = config ?? pickProvider();
  }

  get defaultModel(): string {
    return this.config.defaultModel;
  }

  // Низкоуровневый POST к /chat/completions. Все демо используют его.
  // netFetch: прокси-first с фолбэком на прямое подключение (раньше жёсткая
  // привязка к HTTPS_PROXY роняла pipeline с «fetch failed», если прокси лежал).
  async chatRaw(req: LlmRequest): Promise<LlmResponse> {
    const url = `${this.config.baseUrl}/chat/completions`;
    const resp = await netFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(req),
      label: 'LLM-провайдер',
      timeoutMs: 120_000, // генерация длинных постов бывает дольше дефолтных 15с
    });
    if (!resp.ok) {
      // Гигиена ошибок как в chatStream: наружу — только статус; тело читаем,
      // чтобы не оставлять открытой нечитанной streamed-модели, но не в текст.
      await resp.text().catch(() => {});
      throw new Error(`LLM API error ${resp.status}`);
    }
    return (await resp.json()) as LlmResponse;
  }

  // Удобная обёртка: сообщения + параметры -> текст ответа.
  async chat(messages: ChatMessage[], params: ChatParams = {}): Promise<string> {
    const req: LlmRequest = {
      model: params.model ?? this.config.defaultModel,
      messages,
      temperature: params.temperature,
      max_tokens: params.maxTokens,
      stop: params.stop,
    };
    const data = await this.chatRaw(req);
    const content = data.choices[0]?.message?.content;
    if (!content) throw new Error('Пустой choices в ответе LLM');
    return content;
  }

  // chat + распакованный usage (для демо про токены). День 29: контракт += опц.
  // timings? — base (OpenAI-compat) их не имеет → undefined; OllamaNativeClient
  // переопределяет и отдаёт ns→ms timings. Деструктуризаторы не ломаются.
  async chatWithUsage(
    messages: ChatMessage[],
    params: ChatParams = {},
  ): Promise<{ content: string; usage: Usage; timings?: LlmTimings }> {
    const req: LlmRequest = {
      model: params.model ?? this.config.defaultModel,
      messages,
      temperature: params.temperature,
      max_tokens: params.maxTokens,
      stop: params.stop,
    };
    const data = await this.chatRaw(req);
    const content = data.choices[0]?.message?.content;
    if (!content) throw new Error('Пустой choices в ответе LLM');
    return { content, usage: data.usage ?? emptyUsage() };
  }

  // Потоковый chat (день 28, web P1): OpenAI-compat stream:true, yield delta.content
  // токен-за-токеном. На !resp.ok — throw с обобщённым сообщением (только status):
  // тело/URL/ключ — это секрет, он не должен утекать в error. [DONE] завершает поток.
  // signal (follow-up P5 В3): прокидывается в fetch — при abort клиентского SSE
  // (disconnect) LLM-запрос обрывается чисто (AbortError), без orphan-дожигания токенов.
  // Фикс резильентности: раньше здесь не было ни прокси, ни netFetch — «fetch failed»
  // при лежащем прокси/блоках; теперь общий путь netFetch (timeoutMs:null — стрим
  // ограничен только клиентским signal).
  async *chatStream(
    messages: ChatMessage[],
    params: ChatParams = {},
    signal?: AbortSignal,
  ): AsyncGenerator<string> {
    const url = `${this.config.baseUrl}/chat/completions`;
    const resp = await netFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: params.model ?? this.config.defaultModel,
        messages,
        temperature: params.temperature,
        max_tokens: params.maxTokens,
        stop: params.stop,
        stream: true,
      }),
      signal,
      label: 'LLM-провайдер (stream)',
      timeoutMs: null,
    });
    if (!resp.ok) {
      const s = resp.status;
      await resp.text().catch(() => {});
      throw new Error(`LLM API stream error ${s}`);
    }
    if (!resp.body) throw new Error('LLM API stream: пустое тело ответа');
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (data === '[DONE]') return;
          try {
            const json = JSON.parse(data) as {
              choices?: Array<{ delta?: { content?: string } }>;
            };
            const delta = json?.choices?.[0]?.delta?.content;
            if (delta) yield delta;
          } catch {
            // partial chunk across read boundary — пропускаем
          }
        }
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // already released
      }
    }
  }
}

function emptyUsage(): Usage {
  return { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
}
