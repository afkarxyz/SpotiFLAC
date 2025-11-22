import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import type { Settings } from "./settings";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}


export function sanitizePath(input: string, os: string): string {
  if (os === "Windows") {
    return input.replace(/[<>:"/\\|?*]/g, "_");
  }

  // unix-based OS
  return input.replace(/\//g, "_");
}

export function joinPath(os: string, ...parts: string[]): string {
  const sep = os === "Windows" ? "\\" : "/";

  return parts
    .filter(Boolean)
    .map(p => p.replace(/^[/\\]+|[/\\]+$/g, ""))
    .join(sep);
}

export function buildOutputPath(settings: Settings, folder?: string) {
  const os = settings.operatingSystem;

  const base = settings.downloadPath || "";
  const sanitized = folder ? sanitizePath(folder, os) : undefined;

  return sanitized ? joinPath(os, base, sanitized) : base;
}