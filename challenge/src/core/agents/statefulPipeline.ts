// Stateful pipeline: orchestrator с конечным автоматом.
// Позволяет: паузу, продолжение, пошаговое прохождение.
// Состояние сериализуется в .data/pipeline-state.json.
//
// Команды REPL:
//   /pipeline run          — запустить с нуля (planning)
//   /pipeline pick <N>     — выбрать новость (planning → execution)
//   /pipeline next         — продолжить к следующему этапу
//   /pipeline edit <text>  — ручные правки поста (revision)
//   /pipeline retry        — переписать пост заново
//   /pipeline accept       — принять пост как есть
//   /pipeline status       — текущее состояние FSM
//   /pipeline resume       — продолжить с сохранённого состояния
//   /pipeline reset        — сбросить FSM
//   /pipeline publish      — опубликовать готовый пост в Telegram

import { BlogDb, type NewsRow } from '../db.js';
import type { LlmClient } from '../client.js';
import type { ProfileManager } from '../profile.js';
import { fetchAllFeeds, filterRecent, toNewsRow } from './rss.js';
import { NewsFetcher } from './newsFetcher.js';
import { PostWriter, rewritePost } from './postWriter.js';
import { FactChecker } from './factChecker.js';
import { Reviser } from './reviser.js';
import {
  type PipelineState,
  allowedTransitions,
  createInitialState,
  expectedActionFor,
  loadState,
  saveState,
  transition,
} from './stateMachine.js';

const MAX_REVISIONS = 3;

export interface StepResult {
  state: PipelineState;
  output: string;
}

export class StatefulPipeline {
  private state: PipelineState;
  private readonly statePath: string;

  constructor(
    private db: BlogDb,
    private client: LlmClient,
    private profile: ProfileManager | undefined,
    statePath: string,
  ) {
    this.statePath = statePath;
    const loaded = loadState(statePath);
    this.state = loaded ?? createInitialState();
  }

  get current(): PipelineState {
    return this.state;
  }

  status(): string {
    const s = this.state;
    const lines: string[] = [];
    lines.push(`Этап: ${s.stage}`);
    lines.push(`Шаг: ${s.step}`);
    lines.push(`Ожидается: ${expectedActionFor(s.stage)}`);
    lines.push(`Разрешённые переходы: ${allowedTransitions(s.stage).join(', ')}`);
    if (s.revisionCount > 0) lines.push(`Правок: ${s.revisionCount}`);
    if (s.postContent) lines.push(`Пост: ${s.postContent.length} символов`);
    if (s.factCheck) lines.push(`Вердикт: ${s.factCheck.verdict}`);
    if (s.newsRanked && s.chosenNewsId !== null) {
      const chosen = s.newsRanked.find((r) => r.news.id === s.chosenNewsId);
      if (chosen) lines.push(`Новость: ${chosen.news.title}`);
    }
    lines.push(`История: ${s.history.length} переходов`);
    return lines.join('\n');
  }

  save(): void {
    saveState(this.state, this.statePath);
  }

  reset(): void {
    this.state = createInitialState();
    this.save();
  }

  // Запуск с нуля: planning (RSS + агент 1).
  async run(maxAgeHours = 24, topK = 5): Promise<StepResult> {
    this.state = createInitialState();
    transition(this.state, 'planning', `Запуск pipeline (hours=${maxAgeHours}, topK=${topK})`);

    // RSS.
    const items = filterRecent(await fetchAllFeeds(), maxAgeHours);
    let added = 0;
    for (const item of items) {
      if (this.db.insertNews(toNewsRow(item))) added++;
    }

    // Агент 1.
    const fetcher = new NewsFetcher(this.client);
    const news = await fetcher.fetch(this.db, { maxAgeHours, topK });
    this.state.newsRanked = news.ranked.map((r) => ({
      news: r.news,
      score: r.score,
      why: r.why,
    }));

    this.state.step = 'Выбор новости';
    this.state.expectedAction = `/pipeline pick <номер> (0..${news.ranked.length - 1})`;
    this.save();

    const lines: string[] = [];
    lines.push(`RSS: ${items.length} получено, ${added} новых.`);
    lines.push(`Агент 1: ${news.ranked.length} новостей в топе:`);
    news.ranked.forEach((r, i) => {
      lines.push(`  ${i} [${r.score}] ${r.news.title}`);
    });

    return { state: this.state, output: lines.join('\n') };
  }

  // Полностью автоматический прогон: planning → execution → validation → revision (loop) → done.
  // Не требует ручного pick/next. Сохраняет результат в БД.
  async runAuto(maxAgeHours = 24, topK = 5): Promise<StepResult> {
    const MAX_RETRIES = 2;
    const log: string[] = [];
    let newsRetries = 0;

    const r1 = await this.run(maxAgeHours, topK);
    log.push(r1.output);

    const r2 = await this.pick(0);
    log.push(r2.output);

    while (this.state.stage === 'revision') {
      log.push(`\n[auto] Ревизор (попытка ${this.state.revisionCount + 1})...`);
      const rRev = await this.autoRevise();
      log.push(rRev.output);

      const stage: string = this.state.stage;
      if (stage === 'planning' && newsRetries < MAX_RETRIES) {
        newsRetries++;
        const pickIdx = Math.min(newsRetries, (this.state.newsRanked?.length ?? 1) - 1);
        log.push(`\n[auto] Беру новость №${pickIdx}...`);
        const rPick = await this.pick(pickIdx);
        log.push(rPick.output);
      } else if (stage === 'planning') {
        log.push('\n[auto] Все новости перебраны. Принимаю последний пост.');
        this.accept();
        break;
      }
    }

    if (this.state.stage === 'done') {
      this.finalize();
    }

    if (this.state.postContent) {
      log.push('\n=== Финальный пост ===\n' + this.state.postContent);
    }

    return { state: this.state, output: log.join('\n') };
  }

  // Выбор новости → execution (агент 2).
  async pick(index: number): Promise<StepResult> {
    if (this.state.stage !== 'planning' || !this.state.newsRanked) {
      return { state: this.state, output: 'Нельзя выбрать новость на этом этапе. /pipeline run для старта.' };
    }

    const ranked = this.state.newsRanked;
    if (index < 0 || index >= ranked.length) {
      return { state: this.state, output: `Номер должен быть 0..${ranked.length - 1}` };
    }

    this.state.chosenNewsId = ranked[index].news.id;
    transition(this.state, 'execution', `Выбрана новость: ${ranked[index].news.title}`);
    this.save();

    return this.executePost();
  }

  // Написание поста (агент 2).
  private async executePost(): Promise<StepResult> {
    const news = this.getChosenNews();
    if (!news) return { state: this.state, output: 'Новость не выбрана.' };

    const writer = new PostWriter(this.client, this.profile);
    const post = await writer.write(this.db, news);
    this.state.postContent = post.content;
    transition(this.state, 'validation', `Пост написан (${post.content.length} символов)`);
    this.save();

    // Сразу запускаем фактчекинг.
    return this.runFactCheck();
  }

  // Фактчекинг (агент 3).
  private async runFactCheck(): Promise<StepResult> {
    const news = this.getChosenNews();
    if (!news || !this.state.postContent) {
      return { state: this.state, output: 'Нет поста для проверки.' };
    }

    // Если ещё не в validation — переходим. Если уже в validation — продолжаем.
    if (this.state.stage !== 'validation') {
      transition(this.state, 'validation', 'Фактчекинг запущен');
    }
    const checker = new FactChecker(this.client);
    const fc = await checker.check(this.state.postContent, news);
    this.state.factCheck = fc;
    this.save();

    const lines: string[] = [];
    lines.push(`Вердикт: ${fc.verdict}`);
    lines.push(`Issues: ${fc.issues.length}`);
    if (fc.recommendation) lines.push(`Рекомендация: ${fc.recommendation}`);

    if (fc.verdict === 'ok' || fc.issues.length === 0) {
      transition(this.state, 'done', 'Фактчекинг пройден');
      this.save();
      lines.push('\nПост готов! /pipeline publish или /pipeline status');
    } else if (this.state.revisionCount >= MAX_REVISIONS) {
      transition(this.state, 'done', `Достигнут лимит правок (${MAX_REVISIONS})`);
      this.save();
      lines.push(`\nЛимит правок (${MAX_REVISIONS}). Пост доступен как есть.`);
    } else {
      transition(this.state, 'revision', `Нужна правка (${fc.issues.length} issues)`);
      this.state.expectedAction = '/pipeline next (автоправка), /pipeline edit <текст> (ручная), /pipeline accept';
      this.save();
      lines.push('\nРевизор: /pipeline next для автоправки, /pipeline edit <текст> для ручных правок');
    }

    return { state: this.state, output: lines.join('\n') };
  }

  // Автоправка через агента 4 (Reviser).
  async autoRevise(): Promise<StepResult> {
    if (this.state.stage !== 'revision') {
      return { state: this.state, output: `autoRevise доступен только на этапе revision. Сейчас: ${this.state.stage}. ${expectedActionFor(this.state.stage)}` };
    }
    const news = this.getChosenNews();
    if (!news || !this.state.postContent || !this.state.factCheck) {
      return { state: this.state, output: 'Нечего править.' };
    }

    const reviser = new Reviser(this.client, this.profile);
    const result = await reviser.revise(this.state.postContent, news, this.state.factCheck);
    this.state.revisionCount++;

    if (result.action === 'switch_news') {
      transition(this.state, 'planning', `Смена новости: ${result.reason}`);
      this.state.postContent = null;
      this.state.factCheck = null;
      this.save();
      return {
        state: this.state,
        output: `Ревизор рекомендует сменить новость:\n${result.reason}\n\n/pipeline pick <номер>`,
      };
    }

    // Переписанный пост → обратно на фактчекинг.
    this.state.postContent = result.postContent;
    transition(this.state, 'validation', `Ревизор переписал (правка #${this.state.revisionCount})`);
    this.save();

    const stepResult = await this.runFactCheck();
    return {
      state: this.state,
      output: `Ревизор переписал пост (правка #${this.state.revisionCount}).\n${result.reason}\n\n${stepResult.output}`,
    };
  }

  // Ручная правка → обратно на фактчекинг.
  async manualEdit(instruction: string): Promise<StepResult> {
    if (this.state.stage !== 'revision') {
      return { state: this.state, output: `edit доступен только на этапе revision. Сейчас: ${this.state.stage}. ${expectedActionFor(this.state.stage)}` };
    }
    const news = this.getChosenNews();
    if (!news || !this.state.postContent) {
      return { state: this.state, output: 'Нет поста для правки.' };
    }

    this.state.revisionCount++;
    const rewritten = await rewritePost(this.client, this.state.postContent, instruction, news, this.profile);
    this.state.postContent = rewritten;
    transition(this.state, 'validation', `Ручная правка #${this.state.revisionCount}: ${instruction.slice(0, 50)}`);
    this.save();

    const stepResult = await this.runFactCheck();
    return {
      state: this.state,
      output: `Ручная правка применена (#${this.state.revisionCount}).\n\n${stepResult.output}`,
    };
  }

  // Принять пост как есть (только из revision или validation).
  accept(): StepResult {
    if (this.state.stage !== 'revision' && this.state.stage !== 'validation') {
      return {
        state: this.state,
        output: `accept доступен только на этапе revision/validation. Сейчас: ${this.state.stage}. ${expectedActionFor(this.state.stage)}`,
      };
    }
    transition(this.state, 'done', 'Пост принят пользователем');
    this.save();
    return { state: this.state, output: 'Пост принят. /pipeline publish или /pipeline status' };
  }

  // Переписать с нуля (та же новость).
  async retry(): Promise<StepResult> {
    // retry доступен только из revision или validation.
    if (this.state.stage !== 'revision' && this.state.stage !== 'validation') {
      return { state: this.state, output: `retry доступен только на этапе revision/validation. Сейчас: ${this.state.stage}` };
    }
    // Возврат к execution для переписывания.
    transition(this.state, 'execution', 'Переписываю пост с нуля');
    this.save();
    return this.executePost();
  }

  // Продолжить к следующему шагу (авто).
  async next(): Promise<StepResult> {
    switch (this.state.stage) {
      case 'revision':
        return this.autoRevise();
      case 'execution':
        return this.executePost();
      case 'validation':
        return this.runFactCheck();
      case 'done':
        return { state: this.state, output: 'Pipeline завершён. /pipeline publish или /pipeline reset' };
      case 'idle':
        return { state: this.state, output: 'Pipeline не запущен. /pipeline run' };
      case 'planning':
        return { state: this.state, output: 'Выберите новость: /pipeline pick <номер>' };
      default:
        return { state: this.state, output: `Неизвестный этап: ${this.state.stage}` };
    }
  }

  // Сохранить результат в БД.
  finalize(): StepResult {
    const news = this.getChosenNews();
    if (!news || !this.state.postContent) {
      return { state: this.state, output: 'Нечего сохранять.' };
    }
    const fc = this.state.factCheck;
    this.db.insertPost(this.state.postContent, news.id, fc ? JSON.stringify(fc) : '{}');
    this.db.markUsed(news.id);
    // Если уже done — не делаем повторный transition.
    if (this.state.stage !== 'done') {
      transition(this.state, 'done', 'Сохранено в БД');
    }
    this.save();
    return { state: this.state, output: 'Пост сохранён в БД.' };
  }

  private getChosenNews(): NewsRow | null {
    if (this.state.newsRanked && this.state.chosenNewsId !== null) {
      const found = this.state.newsRanked.find((r) => r.news.id === this.state.chosenNewsId);
      return found?.news ?? null;
    }
    return null;
  }
}
