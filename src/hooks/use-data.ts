import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export function useDataQuery(model: string, queryParams: Record<string, any> = {}) {
  return useQuery({
    queryKey: [model, queryParams],
    queryFn: async () => {
      const search = new URLSearchParams();
      Object.entries(queryParams).forEach(([k, v]) => {
        if (v !== undefined && v !== null) search.append(k, String(v));
      });
      const res = await fetch(`/api/data/${model}?${search.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch data");
      return res.json();
    }
  });
}

export function useDataMutation(model: string) {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ method = "POST", data, id }: { method?: "POST" | "PATCH" | "DELETE", data?: any, id?: string }) => {
      let url = `/api/data/${model}`;
      if (id && (method === "PATCH" || method === "DELETE")) {
        url += `?id=${encodeURIComponent(id)}`;
      }
      
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: data ? JSON.stringify(data) : undefined,
      });
      
      if (!res.ok) throw new Error("Mutation failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [model] });
    }
  });
}
