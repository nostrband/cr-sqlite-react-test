// Database factory functions for createDB/closeDB pattern
import sqliteWasm, { SQLite3, DB } from "@vlcn.io/crsqlite-wasm";

let sqlite: SQLite3 | null = null;

const createTables = async (db: DB) => {
  // Create tables
  await db.exec(`CREATE TABLE IF NOT EXISTS todo_list ("name" primary key not null, "creation_time");`);
  await db.exec(`CREATE TABLE IF NOT EXISTS todo ("id" primary key not null, "list", "text", "complete");`);

  // Make these tables 'tracked' by cr-sqlite
  await db.exec(`SELECT crsql_as_crr('todo_list');`);
  await db.exec(`SELECT crsql_as_crr('todo');`);
};

const insertTestData = async (db: DB) => {
  const currentTime = Date.now();
  
  // Create a default todo list
  await db.exec(
    `INSERT OR REPLACE INTO todo_list (name, creation_time) VALUES (?, ?)`,
    [`Default Todo List`, currentTime]
  );

  // Insert some test todos
  const testTodos = [
    { id: `test-1`, list: `Default Todo List`, text: `Learn TanStack Query with cr-sqlite`, complete: 0 },
    { id: `test-2`, list: `Default Todo List`, text: `Build reactive database UI`, complete: 1 },
    { id: `test-3`, list: `Default Todo List`, text: `Test table-based invalidation`, complete: 0 }
  ];

  for (const todo of testTodos) {
    await db.exec(
      `INSERT OR REPLACE INTO todo (id, list, text, complete) VALUES (?, ?, ?, ?)`,
      [todo.id, todo.list, todo.text, todo.complete]
    );
  }
};

export const createDB = async (): Promise<DB> => {
  try {
    // Initialize sqlite with wasm file loader if not already done
    if (!sqlite) {
      sqlite = await sqliteWasm(
        (_file: string) => "https://esm.sh/@vlcn.io/crsqlite-wasm@0.16.0/dist/crsqlite.wasm"
      );
    }

    // Open database
    const db = await sqlite.open("tanstack-query-test.db");
    
    // Create tables
    await createTables(db);
    
    // Insert test data
    // await insertTestData(db);

    console.log("Database created and initialized successfully");
    return db;
  } catch (error) {
    console.error("Failed to create database:", error);
    throw error;
  }
};

export const closeDB = async (db: DB): Promise<void> => {
  try {
    await db.close();
    console.log("Database closed successfully");
  } catch (error) {
    console.error("Failed to close database:", error);
    throw error;
  }
};