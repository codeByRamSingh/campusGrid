import { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { extractApiMessage } from "./apiError";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,        // 30 s — data is fresh for 30 s before background refetch
      retry: 1,
      refetchOnWindowFocus: true,
    },
    mutations: {
      onError: (error) => {
        toast.error(extractApiMessage(error));
      },
    },
  },
});
