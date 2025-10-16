// TestDB class that encapsulates cr-sqlite database operations
import sqliteWasm, { SQLite3, DB } from "@vlcn.io/crsqlite-wasm";

export interface TodoList {
  name: string;
  creation_time: number;
}

export interface Todo {
  id: string;
  list: string;
  text: string;
  complete: number;
}

export interface Change {
  table: string;
  pk: Uint8Array;
  cid: string;
  val: any;
  col_version: number;
  db_version: number;
  site_id: Uint8Array;
  cl: number;
  seq: number;
}

export class TestDB {
  private sqlite: SQLite3 | null = null;
  private _db: DB | null = null;
  private filename: string;
  private isInitialized = false;

  constructor(filename: string) {
    this.filename = filename;
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      // Initialize sqlite with wasm file loader
      this.sqlite = await sqliteWasm(
        (_file: string) => "https://esm.sh/@vlcn.io/crsqlite-wasm@0.16.0/dist/crsqlite.wasm"
      );

      // Open database
      this._db = await this.sqlite.open(this.filename);

      // Create tables
      await this.createTables();

      this.isInitialized = true;
      console.log(`[TestDB] Initialized database: ${this.filename}`);
    } catch (error) {
      console.error(`[TestDB] Failed to initialize database ${this.filename}:`, error);
      throw error;
    }
  }

  private async createTables(): Promise<void> {
    if (!this._db) throw new Error("Database not initialized");

    // Create tables
    await this._db.exec(`CREATE TABLE IF NOT EXISTS todo_list ("name" primary key not null, "creation_time");`);
    await this._db.exec(`CREATE TABLE IF NOT EXISTS todo ("id" primary key not null, "list", "text", "complete");`);

    // Make these tables 'tracked' by cr-sqlite
    await this._db.exec(`SELECT crsql_as_crr('todo_list');`);
    await this._db.exec(`SELECT crsql_as_crr('todo');`);
  }

  get db(): DB {
    if (!this._db) throw new Error("Database not initialized");
    return this._db;
  }

  async getTodoLists(): Promise<TodoList[]> {
    if (!this._db) throw new Error("Database not initialized");
    
    const result = await this._db.execO<TodoList>("SELECT * FROM todo_list ORDER BY creation_time DESC");
    return result || [];
  }

  async getTodos(listName?: string): Promise<Todo[]> {
    if (!this._db) throw new Error("Database not initialized");
    
    let query = "SELECT * FROM todo";
    let params: string[] = [];
    
    if (listName) {
      query += " WHERE list = ? ORDER BY id";
      params = [listName];
    } else {
      query += " ORDER BY id";
    }
    
    const result = await this._db.execO<Todo>(query, params);
    return result || [];
  }

  async addTodo(listName: string, text: string): Promise<string> {
    if (!this._db) throw new Error("Database not initialized");
    
    const id = `${this.filename === ':memory:' ? 'tab' : 'worker'}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    await this._db.exec(
      `INSERT INTO todo (id, list, text, complete) VALUES (?, ?, ?, ?)`,
      [id, listName, text, 0]
    );
    
    return id;
  }

  async deleteTodo(id: string): Promise<void> {
    if (!this._db) throw new Error("Database not initialized");
    
    await this._db.exec("DELETE FROM todo WHERE id = ?", [id]);
  }

  async toggleTodo(id: string): Promise<void> {
    if (!this._db) throw new Error("Database not initialized");
    
    await this._db.exec(
      "UPDATE todo SET complete = CASE WHEN complete = 0 THEN 1 ELSE 0 END WHERE id = ?",
      [id]
    );
  }

  async addTodoList(name: string): Promise<void> {
    if (!this._db) throw new Error("Database not initialized");
    
    const currentTime = Date.now();
    await this._db.exec(
      `INSERT OR REPLACE INTO todo_list (name, creation_time) VALUES (?, ?)`,
      [name, currentTime]
    );
  }

  async deleteTodoList(name: string): Promise<void> {
    if (!this._db) throw new Error("Database not initialized");
    
    // Delete all todos in this list first
    await this._db.exec("DELETE FROM todo WHERE list = ?", [name]);
    
    // Then delete the list itself
    await this._db.exec("DELETE FROM todo_list WHERE name = ?", [name]);
  }

  async getChanges(): Promise<Change[]> {
    if (!this._db) throw new Error("Database not initialized");
    
    const result = await this._db.execO<Change>("SELECT * FROM crsql_changes");
    return result || [];
  }

  async getChangesAfterVersion(dbVersion: number): Promise<Change[]> {
    if (!this._db) throw new Error("Database not initialized");
    
    const result = await this._db.execO<Change>(
      `SELECT * FROM crsql_changes WHERE db_version > ? AND site_id = crsql_site_id()`,
      [dbVersion]
    );
    console.log(`[TestDB ${this.filename}] getChangesAfterVersion(${dbVersion}):`, result?.length || 0, "changes");
    return result || [];
  }

  async getCurrentDbVersion(): Promise<number> {
    if (!this._db) throw new Error("Database not initialized");
    
    const result = await this._db.execO<{ max_version: number }>("SELECT MAX(db_version) as max_version FROM crsql_changes");
    return result?.[0]?.max_version || 0;
  }

  async applyChanges(changes: Change[]): Promise<void> {
    if (!this._db || !changes || changes.length === 0) return;
    
    console.log(`[TestDB ${this.filename}] Applying ${changes.length} changes`);
    
    try {
      await this._db.tx(async (tx: any) => {
        for (const change of changes) {
          await tx.exec(
            `INSERT INTO crsql_changes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              change.table,
              change.pk,
              change.cid,
              change.val,
              change.col_version,
              change.db_version,
              change.site_id,
              change.cl,
              change.seq
            ]
          );
        }
      });
      console.log(`[TestDB ${this.filename}] Successfully applied changes`);
    } catch (error) {
      console.error(`[TestDB ${this.filename}] Error applying changes:`, error);
      throw error;
    }
  }

  getFilename(): string {
    return this.filename;
  }

  isMemory(): boolean {
    return this.filename === ':memory:';
  }

  close(): void {
    if (this._db) {
      this._db.close();
      this._db = null;
    }
    this.isInitialized = false;
  }
}