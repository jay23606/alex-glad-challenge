// /settings — настройки (день 28, web P5).
// 'use client': GET /api/settings (display серверной конфигурации БЕЗ ключей) +
// modelPref radio (POST /api/settings → cookie).
// MCP_URL — read-only badge (смена через UI запрещена, §8 SSRF). НИКАКИХ импортов core/.
'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card } from '../components/ui/Card';
import { StatusDot } from '../components/ui/StatusDot';
import { SectionHead } from '../components/ui/SectionHead';
import { ThemePalette } from '../components/ThemePalette';

interface SettingsView {
  model: string | null;
  provider: string | null;
  mcpUrl: { configured: boolean; host: string | null };
  cloud: { configured: boolean; provider?: string; model?: string };
  localLlm: { configured: boolean; model?: string };
  modelPref: 'local' | 'cloud' | null;
}

export default function SettingsPage() {
  const [data, setData] = useState<SettingsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modelPref, setModelPref] = useState<'local' | 'cloud' | null>(null);
  const [savingPref, setSavingPref] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await fetch('/api/settings');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = (await r.json()) as SettingsView;
      setData(d);
      setModelPref(d.modelPref);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'load failed');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const savePref = useCallback(async (pref: 'local' | 'cloud') => {
    setSavingPref(true);
    setError(null);
    try {
      const r = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelPref: pref }),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${r.status}`);
      }
      setModelPref(pref);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'save failed');
    } finally {
      setSavingPref(false);
    }
  }, []);

  return (
    <div className="space-y-6">
      <SectionHead
        code="sys · settings"
        title="Настройки"
        description="Конфигурация сервера и preference (ключи не отображаются)."
      />

      {error && (
        <Card tone="danger">
          <p className="text-sm text-err">{error}</p>
        </Card>
      )}

      {data && (
        <Card label="Конфигурация">
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-dim">Активная модель</dt>
              <dd className="font-mono text-ink">{data.model ?? '—'}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-dim">Провайдер</dt>
              <dd className="text-ink">{data.provider ?? '—'}</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-dim">Cloud LLM</dt>
              <dd className="flex items-center gap-2">
                <StatusDot status={data.cloud.configured ? 'ok' : 'warn'} label="" />
                <span className="text-ink">
                  {data.cloud.configured ? `${data.cloud.provider} · ${data.cloud.model}` : 'не настроен'}
                </span>
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-dim">Local LLM</dt>
              <dd className="flex items-center gap-2">
                <StatusDot status={data.localLlm.configured ? 'ok' : 'warn'} label="" />
                <span className="text-ink">
                  {data.localLlm.configured ? data.localLlm.model : 'не настроен'}
                </span>
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-dim">MCP-сервер URL</dt>
              <dd className="flex items-center gap-2">
                <StatusDot status={data.mcpUrl.configured ? 'ok' : 'warn'} label="" />
                {data.mcpUrl.host && (
                  <span
                    className="font-mono text-xs text-dim"
                    title="read-only: MCP_URL меняется только через .env (защита от SSRF)"
                  >
                    {data.mcpUrl.host}
                  </span>
                )}
              </dd>
            </div>
          </dl>
        </Card>
      )}

      <Card label="Preference">
        <fieldset className="text-sm">
          <span
            className="block text-xs font-medium text-dim"
            title="Применяется как начальное значение LLM-селектора на /rag, /chat и /rag/chat (явный выбор в форме имеет приоритет)"
          >
            Модель по умолчанию
          </span>
          <div className="mt-1 flex gap-3">
            {(['cloud', 'local'] as const).map((v) => (
              <label key={v} className="flex items-center gap-1 text-ink">
                <input
                  type="radio"
                  name="modelPref"
                  checked={modelPref === v}
                  onChange={() => void savePref(v)}
                  disabled={savingPref}
                />
                {v === 'cloud' ? 'облако' : 'локально'}
              </label>
            ))}
            {!modelPref && <span className="text-xs text-dim">(не задан)</span>}
          </div>
        </fieldset>
      </Card>

      <Card label="Тема">
        <ThemePalette />
      </Card>
    </div>
  );
}
