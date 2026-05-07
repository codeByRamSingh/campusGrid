import axios from "axios";

export function extractApiMessage(error: unknown, fallback = "Something went wrong. Please try again."): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { message?: string } | undefined;
    return data?.message ?? fallback;
  }
  if (error instanceof Error) return error.message;
  return fallback;
}
