// Database write hooks using TanStack Query mutations with remote-first execution
import { useMutation } from "@tanstack/react-query";
import { queryClient, notifyTablesChanged } from "./queryClient";
import { qk } from "./queryKeys";
import { useCRSqliteQuery } from "./CRSqliteQueryProvider";

export function useAddTodoRemote() {
  const { dbExec } = useCRSqliteQuery();
  
  return useMutation({
    mutationFn: async (input: { list: string; text: string }) => {
      const id = `t_${Date.now()}`;
      await dbExec(
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
      // keep UI instant, but still revalidate from DB
      // Note: sync is handled automatically by the worker after dbExec
      // notifyTablesChanged(["todo"]);
    },
  });
}

export function useToggleTodoRemote() {
  const { dbExec } = useCRSqliteQuery();
  
  return useMutation({
    mutationFn: async (input: { id: string }) => {
      await dbExec(
        `UPDATE todo SET complete = CASE WHEN complete = 0 THEN 1 ELSE 0 END WHERE id = ?`,
        [input.id]
      );
      return input.id;
    },
    onSuccess: (_id) => {
      // notifyTablesChanged(["todo"]);
    },
  });
}

export function useDeleteTodoRemote() {
  const { dbExec } = useCRSqliteQuery();
  
  return useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      await dbExec(`DELETE FROM todo WHERE id = ?`, [id]);
      return id;
    },
    onSuccess: (_id, _vars) => {
      // notifyTablesChanged(["todo"]);
    },
  });
}

export function useAddTodoListRemote() {
  const { dbExec } = useCRSqliteQuery();
  
  return useMutation({
    mutationFn: async ({ name }: { name: string }) => {
      await dbExec(
        `INSERT OR REPLACE INTO todo_list (name, creation_time) VALUES (?, ?)`,
        [name, Date.now()]
      );
    },
    onSuccess: () => {
      // notifyTablesChanged(["todo_list"]);
    },
  });
}

export function useDeleteTodoListRemote() {
  const { dbExec } = useCRSqliteQuery();
  
  return useMutation({
    mutationFn: async ({ name }: { name: string }) => {
      // Delete all todos in this list first
      await dbExec("DELETE FROM todo WHERE list = ?", [name]);
      
      // Then delete the list itself
      await dbExec("DELETE FROM todo_list WHERE name = ?", [name]);
      
      return name;
    },
    onSuccess: () => {
      // notifyTablesChanged(["todo_list", "todo"]);
    },
  });
}