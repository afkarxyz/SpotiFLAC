import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { BrowserOpenURL } from "../../wailsjs/runtime/runtime"
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

  const filtered = parts.filter(Boolean);
  if (filtered.length === 0) return "";

  const joined = filtered
    .map((p, i) => {
      // For first part, only remove trailing slashes (preserve leading slash for absolute paths)
      if (i === 0) {
        return p.replace(/[/\\]+$/g, "");
      }
      // For other parts, remove both leading and trailing slashes
      return p.replace(/^[/\\]+|[/\\]+$/g, "");
    })
    .filter(Boolean) // Remove empty strings after trimming
    .join(sep);

  return joined;
}

export function buildOutputPath(settings: Settings, folder?: string) {
  const os = settings.operatingSystem;

  const base = settings.downloadPath || "";
  const sanitized = folder ? sanitizePath(folder, os) : undefined;

  return sanitized ? joinPath(os, base, sanitized) : base;
}

export function openExternal(url: string) {
  if (!url) return;
  try {
    BrowserOpenURL(url);
  } catch (error) {
    if (typeof window !== "undefined") {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }
}