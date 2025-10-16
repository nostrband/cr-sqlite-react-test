// Database write hooks using TanStack Query mutations
import { useMutation } from "@tanstack/react-query";
import { queryClient, notifyTablesChanged } from "./queryClient";
import { qk } from "./queryKeys";
import type { DB } from "@vlcn.io/crsqlite-wasm";

export function useAddTodo(db: DB | null) {
  return useMutation({
    mutationFn: async (input: { list: string; text: string }) => {
      if (!db) throw new Error("Database not available");
      const id = `t_${Date.now()}`;
      await db.exec(
        `INSERT INTO todo (id, list, text, complete) VALUES (?, ?, ?, 0)`,
        [id, input.list, input.text]
      );
      return { id, ...input, complete: 0 };
    },
    onMutate: async ({ list, text }) => {
      await queryClient.cancelQueries({ queryKey: qk.todosByList(list) });
      await queryClient.cancelQueries({ queryKey: qk.allTodos() });
      
      const listKey = qk.todosByList(list);
      const allKey = qk.allTodos();
      
      const prevList = queryClient.getQueryData<any[]>(listKey) ?? [];
      const prevAll = queryClient.getQueryData<any[]>(allKey) ?? [];
      
      const optimistic = { id: `opt_${Date.now()}`, text, complete: 0 };
      
      queryClient.setQueryData(listKey, [optimistic, ...prevList]);
      queryClient.setQueryData(allKey, [{ ...optimistic, list }, ...prevAll]);
      
      return { listKey, allKey, prevList, prevAll };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx) {
        queryClient.setQueryData(ctx.listKey, ctx.prevList);
        queryClient.setQueryData(ctx.allKey, ctx.prevAll);
      }
    },
    onSuccess: (_result, { list }) => {
      // keep UI instant, but still revalidate from DB and trigger sync
      notifyTablesChanged(["todo"]);
    },
  });
}

export function useToggleTodo(db: DB | null) {
  return useMutation({
    mutationFn: async (input: { id: string }) => {
      if (!db) throw new Error("Database not available");
      await db.exec(
        `UPDATE todo SET complete = CASE WHEN complete = 0 THEN 1 ELSE 0 END WHERE id = ?`,
        [input.id]
      );
      return input.id;
    },
    onSuccess: (_id) => {
      notifyTablesChanged(["todo"]);
    },
  });
}

export function useDeleteTodo(db: DB | null) {
  return useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      if (!db) throw new Error("Database not available");
      await db.exec(`DELETE FROM todo WHERE id = ?`, [id]);
      return id;
    },
    onSuccess: (_id, _vars) => {
      notifyTablesChanged(["todo"]);
    },
  });
}

export function useAddTodoList(db: DB | null) {
  return useMutation({
    mutationFn: async ({ name }: { name: string }) => {
      if (!db) throw new Error("Database not available");
      await db.exec(
        `INSERT OR REPLACE INTO todo_list (name, creation_time) VALUES (?, ?)`,
        [name, Date.now()]
      );
    },
    onSuccess: () => {
      notifyTablesChanged(["todo_list"]);
    },
  });
}

export function useDeleteTodoList(db: DB | null) {
  return useMutation({
    mutationFn: async ({ name }: { name: string }) => {
      if (!db) throw new Error("Database not available");
      
      // Delete all todos in this list first
      await db.exec("DELETE FROM todo WHERE list = ?", [name]);
      
      // Then delete the list itself
      await db.exec("DELETE FROM todo_list WHERE name = ?", [name]);
      
      return name;
    },
    onSuccess: () => {
      notifyTablesChanged(["todo_list", "todo"]);
    },
  });
}