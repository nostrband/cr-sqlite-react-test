// Database utility for cr-sqlite with dual instance support
import sqliteWasm, { SQLite3, DB } from "@vlcn.io/crsqlite-wasm";

interface TodoList {
  name: string;
  creation_time: number;
}

interface Todo {
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

let sqlite: SQLite3 | null = null;
let db1: DB | null = null;
let db2: DB | null = null;

const createTables = async (db: DB) => {
  // Create tables
  await db.exec(`CREATE TABLE IF NOT EXISTS todo_list ("name" primary key not null, "creation_time");`);
  await db.exec(`CREATE TABLE IF NOT EXISTS todo ("id" primary key not null, "list", "text", "complete");`);

  // Make these tables 'tracked' by cr-sqlite
  await db.exec(`SELECT crsql_as_crr('todo_list');`);
  await db.exec(`SELECT crsql_as_crr('todo');`);
};

const insertTestData = async (db: DB, dbName: string) => {
  const currentTime = Date.now();
  
  // Create a default todo list
  await db.exec(
    `INSERT OR REPLACE INTO todo_list (name, creation_time) VALUES (?, ?)`,
    [`${dbName} Todo List`, currentTime]
  );

  // Insert some test todos
  const testTodos = [
    { id: `${dbName}-1`, list: `${dbName} Todo List`, text: `Learn cr-sqlite (${dbName})`, complete: 0 },
    { id: `${dbName}-2`, list: `${dbName} Todo List`, text: `Build React app (${dbName})`, complete: 1 },
    { id: `${dbName}-3`, list: `${dbName} Todo List`, text: `Test database sync (${dbName})`, complete: 0 }
  ];

  for (const todo of testTodos) {
    await db.exec(
      `INSERT OR REPLACE INTO todo (id, list, text, complete) VALUES (?, ?, ?, ?)`,
      [todo.id, todo.list, todo.text, todo.complete]
    );
  }
};

export const initDatabases = async (): Promise<{ success: boolean; db1?: DB; db2?: DB; error?: string }> => {
  try {
    // Initialize sqlite with wasm file loader
    sqlite = await sqliteWasm(
      (_file: string) => "https://esm.sh/@vlcn.io/crsqlite-wasm@0.16.0/dist/crsqlite.wasm"
    );

    // Open two in-memory databases
    db1 = await sqlite.open("test.db");
    db2 = await sqlite.open(":memory:");
    // @ts-ignore
    globalThis.db1 = db1;
    // @ts-ignore
    globalThis.db2 = db2;

    // Create tables for both databases
    await createTables(db1);
    await createTables(db2);

    // Insert test data for both databases
    await insertTestData(db1, "DB1");
    await insertTestData(db2, "DB2");

    console.log("Both databases initialized successfully");
    return { success: true, db1, db2 };
  } catch (error) {
    console.error("Failed to initialize databases:", error);
    return { success: false, error: (error as Error).message };
  }
};

export const getDatabases = () => {
  return { db1, db2 };
};

export const getTodoLists = async (dbInstance: 'db1' | 'db2'): Promise<TodoList[]> => {
  const db = dbInstance === 'db1' ? db1 : db2;
  if (!db) throw new Error("Database not initialized");
  
  const result = await db.execO<TodoList>("SELECT * FROM todo_list ORDER BY creation_time DESC");
  return result || [];
};

export const getTodos = async (dbInstance: 'db1' | 'db2', listName: string | null = null): Promise<Todo[]> => {
  const db = dbInstance === 'db1' ? db1 : db2;
  if (!db) throw new Error("Database not initialized");
  
  let query = "SELECT * FROM todo";
  let params: string[] = [];
  
  if (listName) {
    query += " WHERE list = ? ORDER BY id";
    params = [listName];
  } else {
    query += " ORDER BY id";
  }
  
  const result = await db.execO<Todo>(query, params);
  return result || [];
};

export const addTodo = async (dbInstance: 'db1' | 'db2', listName: string, text: string): Promise<string> => {
  const db = dbInstance === 'db1' ? db1 : db2;
  if (!db) throw new Error("Database not initialized");
  
  const id = `${dbInstance}-${Date.now()}`;
  await db.exec(
    `INSERT INTO todo (id, list, text, complete) VALUES (?, ?, ?, ?)`,
    [id, listName, text, 0]
  );
  
  return id;
};

export const deleteTodo = async (dbInstance: 'db1' | 'db2', id: string): Promise<void> => {
  const db = dbInstance === 'db1' ? db1 : db2;
  if (!db) throw new Error("Database not initialized");
  
  await db.exec("DELETE FROM todo WHERE id = ?", [id]);
};

export const toggleTodo = async (dbInstance: 'db1' | 'db2', id: string): Promise<void> => {
  const db = dbInstance === 'db1' ? db1 : db2;
  if (!db) throw new Error("Database not initialized");
  
  await db.exec(
    "UPDATE todo SET complete = CASE WHEN complete = 0 THEN 1 ELSE 0 END WHERE id = ?",
    [id]
  );
};

export const addTodoList = async (dbInstance: 'db1' | 'db2', name: string): Promise<void> => {
  const db = dbInstance === 'db1' ? db1 : db2;
  if (!db) throw new Error("Database not initialized");
  
  const currentTime = Date.now();
  await db.exec(
    `INSERT OR REPLACE INTO todo_list (name, creation_time) VALUES (?, ?)`,
    [name, currentTime]
  );
};

export const deleteTodoList = async (dbInstance: 'db1' | 'db2', name: string): Promise<void> => {
  const db = dbInstance === 'db1' ? db1 : db2;
  if (!db) throw new Error("Database not initialized");
  
  // Delete all todos in this list first
  await db.exec("DELETE FROM todo WHERE list = ?", [name]);
  
  // Then delete the list itself
  await db.exec("DELETE FROM todo_list WHERE name = ?", [name]);
};

// Get cr-sqlite changes for sync (useful for debugging)
export const getChanges = async (dbInstance: 'db1' | 'db2'): Promise<Change[]> => {
  const db = dbInstance === 'db1' ? db1 : db2;
  if (!db) throw new Error("Database not initialized");
  
  const result = await db.execO<Change>("SELECT * FROM crsql_changes");
  return result || [];
};

// Get changes after a specific db_version for syncing
export const getChangesAfterVersion = async (dbInstance: 'db1' | 'db2', dbVersion: number = 0): Promise<Change[]> => {
  const db = dbInstance === 'db1' ? db1 : db2;
  if (!db) throw new Error("Database not initialized");
  
  const result = await db.execO<Change>(
    `SELECT * FROM crsql_changes WHERE db_version > ? AND site_id = crsql_site_id()`,
    [dbVersion]
  );
  return result || [];
};

// Apply changes from one database to another
export const syncChanges = async (fromDb: 'db1' | 'db2', toDb: 'db1' | 'db2', lastSyncVersion: number = 0): Promise<void> => {
  if (fromDb === toDb) return;
  
  const sourceDb = fromDb === 'db1' ? db1 : db2;
  const targetDb = toDb === 'db1' ? db1 : db2;
  
  if (!sourceDb || !targetDb) throw new Error("Databases not initialized");
  
  try {
    // Get changes from source database after last sync version
    const changes = await sourceDb.execO<Change>(
      `SELECT * FROM crsql_changes WHERE db_version > ? AND site_id = crsql_site_id()`,
      [lastSyncVersion]
    );
    console.log("changes", changes);
    
    if (!changes || changes.length === 0) return;
    
    console.log(`Syncing ${changes.length} changes from ${fromDb} to ${toDb}`);
    
    // Apply changes to target database in a transaction
    await targetDb.tx(async (tx: any) => {
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
    
    console.log(`Successfully synced changes from ${fromDb} to ${toDb}`);
  } catch (error) {
    console.error(`Error syncing from ${fromDb} to ${toDb}:`, error);
    throw error;
  }
};

// Get the current database version for sync tracking
export const getCurrentDbVersion = async (dbInstance: 'db1' | 'db2'): Promise<number> => {
  const db = dbInstance === 'db1' ? db1 : db2;
  if (!db) throw new Error("Database not initialized");
  
  const result = await db.execO<{ max_version: number }>("SELECT MAX(db_version) as max_version FROM crsql_changes");
  return result?.[0]?.max_version || 0;
};

// Bidirectional sync between both databases
export const syncDatabases = async (): Promise<void> => {
  if (!db1 || !db2) throw new Error("Databases not initialized");
  
  try {

    // Sync changes from db1 to db2
    await syncChanges('db1', 'db2', 0);
    
    // Sync changes from db2 to db1
    await syncChanges('db2', 'db1', 0);
    
    console.log('Bidirectional sync completed');
  } catch (error) {
    console.error('Error during bidirectional sync:', error);
    throw error;
  }
};