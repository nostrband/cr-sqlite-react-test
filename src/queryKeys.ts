// Query keys for TanStack Query with stable keys and table dependencies
export const qk = {
  todoLists: () => [{ scope: "todoLists" }] as const,
  todosByList: (list: string) => [{ scope: "todosByList", list }] as const,
  todoById: (id: string) => [{ scope: "todoById", id }] as const,
  allTodos: () => [{ scope: "allTodos" }] as const,
  changes: () => [{ scope: "changes" }] as const,
};