export type InputMode = "url" | "search" | "batch";

export type BatchJobStatus = "pending" | "processing" | "success" | "error";

export interface BatchJobItem {
  id: number;
  url: string;
  status: BatchJobStatus;
  title?: string;
  message?: string;
}
