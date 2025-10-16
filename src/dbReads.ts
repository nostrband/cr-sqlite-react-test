// Database read hooks using TanStack Query
import { useQuery } from "@tanstack/react-query";
import type { DB } from "@vlcn.io/crsqlite-wasm";
import { qk } from "./queryKeys";
import { useCRSqliteQuery } from "./CRSqliteQueryProvider";

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

interface Change {
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

export function useTodoLists() {
  const { db } = useCRSqliteQuery();
  return useQuery({
    queryKey: qk.todoLists(),
    queryFn: async () => {
      if (!db) return [];
      const result = await db.execO<TodoList>(
        `SELECT name, creation_time FROM todo_list ORDER BY creation_time DESC`
      );
      return result ?? [];
    },
    meta: { tables: ["todo_list"] },
    enabled: !!db,
  });
}

export function useTodosByList(list: string) {
  const { db } = useCRSqliteQuery();
  return useQuery({
    queryKey: qk.todosByList(list),
    queryFn: async () => {
      if (!db) return [];
      const result = await db.execO<Todo>(
        `SELECT id, text, complete FROM todo WHERE list = ? ORDER BY id`,
        [list]
      );
      return result ?? [];
    },
    meta: { tables: ["todo"] },
    enabled: !!db && !!list,
    // optional: select to stabilize referential equality
    select: (rows) => rows.map((r) => ({ ...r })),
  });
}

export function useTodo(id: string) {
  const { db } = useCRSqliteQuery();
  return useQuery({
    queryKey: qk.todoById(id),
    queryFn: async () => {
      if (!db) return null;
      const result = await db.execO<Todo>(
        `SELECT id, list, text, complete FROM todo WHERE id = ?`,
        [id]
      );
      return result?.[0] ?? null;
    },
    meta: { tables: ["todo"] },
    enabled: !!db && !!id,
  });
}

export function useAllTodos() {
  const { db } = useCRSqliteQuery();
  return useQuery({
    queryKey: qk.allTodos(),
    queryFn: async () => {
      if (!db) return [];
      const result = await db.execO<Todo>(
        `SELECT id, list, text, complete FROM todo ORDER BY id`
      );
      return result ?? [];
    },
    meta: { tables: ["todo"] },
    enabled: !!db,
  });
}

export function useChanges() {
  const { db } = useCRSqliteQuery();
  return useQuery({
    queryKey: qk.changes(),
    queryFn: async () => {
      if (!db) return [];
      const result = await db.execO<Change>(`SELECT * FROM crsql_changes`);
      return result ?? [];
    },
    meta: { tables: ["crsql_changes"] },
    enabled: !!db,
  });
}
