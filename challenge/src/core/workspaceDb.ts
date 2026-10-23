// Workspace: проекты → папки → элементы (заметки/задачи/ссылки).
// node:sqlite, WAL, идемпотентная схема в конструкторе. SQL только parameterized.
// Инварианты: элемент принадлежит проекту; папка элемента — тому же проекту;
// удаление проекта каскадно удаляет папки и элементы (PRAGMA foreign_keys).

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export type ProjectStatus = 'active' | 'archived';
export type WorkspaceItemKind = 'note' | 'task' | 'link';

export interface ProjectRow {
  id: number;
  name: string;
  description: string;
  color: string;
  status: ProjectStatus;
  created_at: string;
  updated_at: string;
}

export interface FolderRow {
  id: number;
  project_id: number;
  parent_id: number | null;
  name: string;
  created_at: string;
}

export interface WorkspaceItemRow {
  id: number;
  project_id: number;
  folder_id: number | null;
  kind: WorkspaceItemKind;
  title: string;
  body: string;
  url: string | null;
  due_at: string | null;
  done: number;
  created_at: string;
  updated_at: string;
}

export interface ProjectInput {
  readonly name: string;
  readonly description?: string;
  readonly color?: string;
}

export interface ItemInput {
  readonly projectId: number;
  readonly folderId?: number | null;
  readonly kind?: WorkspaceItemKind;
  readonly title: string;
  readonly body?: string;
  readonly url?: string | null;
  readonly dueAt?: string | null;
}

export interface ItemFilter {
  readonly projectId?: number;
  readonly folderId?: number | null;
  readonly kind?: WorkspaceItemKind;
  readonly includeDone?: boolean;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '#8B7CFF',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS folders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  parent_id INTEGER REFERENCES folders(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS workspace_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL,
  kind TEXT NOT NULL DEFAULT 'note',
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  url TEXT,
  due_at TEXT,
  done INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_folders_project ON folders(project_id);
CREATE INDEX IF NOT EXISTS idx_items_project ON workspace_items(project_id);
CREATE INDEX IF NOT EXISTS idx_items_due ON workspace_items(due_at);
`;

function requiredText(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new RangeError(`${field} must be non-empty`);
  return trimmed;
}

function optionalIso(value: string | null | undefined): string | null {
  if (value == null || value.trim() === '') return null;
  const time = Date.parse(value);
  if (Number.isNaN(time)) throw new RangeError('dueAt must be an ISO date');
  return new Date(time).toISOString();
}

export class WorkspaceDb {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA foreign_keys = ON');
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  createProject(input: ProjectInput): number {
    const result = this.db
      .prepare('INSERT INTO projects (name, description, color) VALUES (?, ?, ?)')
      .run(
        requiredText(input.name, 'name'),
        input.description?.trim() ?? '',
        input.color?.trim() || '#8B7CFF',
      );
    return Number(result.lastInsertRowid);
  }

  listProjects(status?: ProjectStatus): ProjectRow[] {
    const rows = status
      ? this.db.prepare('SELECT * FROM projects WHERE status = ? ORDER BY name').all(status)
      : this.db.prepare('SELECT * FROM projects ORDER BY name').all();
    // node:sqlite возвращает Record<string, SQLOutputValue>; форма строк фиксирована SCHEMA.
    return rows as unknown as ProjectRow[];
  }

  getProject(id: number): ProjectRow | null {
    const row = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    return (row as unknown as ProjectRow | undefined) ?? null;
  }

  updateProject(id: number, patch: Partial<ProjectInput> & { status?: ProjectStatus }): boolean {
    const current = this.getProject(id);
    if (!current) return false;
    const status = patch.status ?? current.status;
    if (status !== 'active' && status !== 'archived') {
      throw new RangeError('status must be active or archived');
    }
    this.db
      .prepare(
        `UPDATE projects SET name = ?, description = ?, color = ?, status = ?,
         updated_at = datetime('now') WHERE id = ?`,
      )
      .run(
        patch.name !== undefined ? requiredText(patch.name, 'name') : current.name,
        patch.description !== undefined ? patch.description.trim() : current.description,
        patch.color?.trim() || current.color,
        status,
        id,
      );
    return true;
  }

  deleteProject(id: number): boolean {
    return this.db.prepare('DELETE FROM projects WHERE id = ?').run(id).changes > 0;
  }

  createFolder(projectId: number, name: string, parentId: number | null = null): number {
    this.requireProject(projectId);
    if (parentId !== null) {
      const parent = this.getFolder(parentId);
      if (!parent || parent.project_id !== projectId) {
        throw new RangeError('parent folder must belong to the same project');
      }
    }
    const result = this.db
      .prepare('INSERT INTO folders (project_id, parent_id, name) VALUES (?, ?, ?)')
      .run(projectId, parentId, requiredText(name, 'name'));
    return Number(result.lastInsertRowid);
  }

  getFolder(id: number): FolderRow | null {
    const row = this.db.prepare('SELECT * FROM folders WHERE id = ?').get(id);
    return (row as unknown as FolderRow | undefined) ?? null;
  }

  listFolders(projectId: number): FolderRow[] {
    return this.db
      .prepare('SELECT * FROM folders WHERE project_id = ? ORDER BY name')
      .all(projectId) as unknown as FolderRow[];
  }

  deleteFolder(id: number): boolean {
    return this.db.prepare('DELETE FROM folders WHERE id = ?').run(id).changes > 0;
  }

  createItem(input: ItemInput): number {
    this.requireProject(input.projectId);
    const kind = input.kind ?? 'note';
    this.assertKind(kind);
    if (input.folderId != null) {
      const folder = this.getFolder(input.folderId);
      if (!folder || folder.project_id !== input.projectId) {
        throw new RangeError('folder must belong to the same project');
      }
    }
    const url = input.url?.trim() || null;
    if (url !== null && !/^https?:\/\//i.test(url)) {
      throw new RangeError('url must be http(s)');
    }
    const result = this.db
      .prepare(
        `INSERT INTO workspace_items (project_id, folder_id, kind, title, body, url, due_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.projectId,
        input.folderId ?? null,
        kind,
        requiredText(input.title, 'title'),
        input.body?.trim() ?? '',
        url,
        optionalIso(input.dueAt),
      );
    return Number(result.lastInsertRowid);
  }

  getItem(id: number): WorkspaceItemRow | null {
    const row = this.db.prepare('SELECT * FROM workspace_items WHERE id = ?').get(id);
    return (row as unknown as WorkspaceItemRow | undefined) ?? null;
  }

  listItems(filter: ItemFilter = {}): WorkspaceItemRow[] {
    const where: string[] = [];
    const params: Array<string | number> = [];
    if (filter.projectId !== undefined) {
      where.push('project_id = ?');
      params.push(filter.projectId);
    }
    if (filter.folderId !== undefined) {
      if (filter.folderId === null) {
        where.push('folder_id IS NULL');
      } else {
        where.push('folder_id = ?');
        params.push(filter.folderId);
      }
    }
    if (filter.kind !== undefined) {
      this.assertKind(filter.kind);
      where.push('kind = ?');
      params.push(filter.kind);
    }
    if (!filter.includeDone) where.push('done = 0');
    const sql = `SELECT * FROM workspace_items${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC`;
    return this.db.prepare(sql).all(...params) as unknown as WorkspaceItemRow[];
  }

  updateItem(
    id: number,
    patch: Partial<Pick<WorkspaceItemRow, 'title' | 'body' | 'due_at'> & { done: boolean }>,
  ): boolean {
    const current = this.getItem(id);
    if (!current) return false;
    this.db
      .prepare(
        `UPDATE workspace_items SET title = ?, body = ?, due_at = ?, done = ?,
         updated_at = datetime('now') WHERE id = ?`,
      )
      .run(
        patch.title !== undefined ? requiredText(patch.title, 'title') : current.title,
        patch.body !== undefined ? patch.body.trim() : current.body,
        patch.due_at !== undefined ? optionalIso(patch.due_at) : current.due_at,
        patch.done !== undefined ? (patch.done ? 1 : 0) : current.done,
        id,
      );
    return true;
  }

  setItemDone(id: number, done: boolean): boolean {
    const result = this.db
      .prepare("UPDATE workspace_items SET done = ?, updated_at = datetime('now') WHERE id = ?")
      .run(done ? 1 : 0, id);
    return result.changes > 0;
  }

  deleteItem(id: number): boolean {
    return this.db.prepare('DELETE FROM workspace_items WHERE id = ?').run(id).changes > 0;
  }

  /** Открытые задачи с дедлайном в окне [from, to] — источник событий календаря. */
  listUpcoming(fromIso: string, toIso: string): WorkspaceItemRow[] {
    return this.db
      .prepare(
        `SELECT * FROM workspace_items
         WHERE done = 0 AND due_at IS NOT NULL AND due_at >= ? AND due_at <= ?
         ORDER BY due_at ASC`,
      )
      .all(fromIso, toIso) as unknown as WorkspaceItemRow[];
  }

  private requireProject(id: number): void {
    if (!this.getProject(id)) throw new RangeError('project not found');
  }

  private assertKind(kind: string): void {
    if (kind !== 'note' && kind !== 'task' && kind !== 'link') {
      throw new RangeError('kind must be note, task or link');
    }
  }
}
