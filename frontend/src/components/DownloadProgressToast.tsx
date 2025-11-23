import { useDownloadProgress } from "@/hooks/useDownloadProgress";
import { Download } from "lucide-react";

export function DownloadProgressToast() {
  const progress = useDownloadProgress();

  if (!progress.is_downloading) {
    return null;
  }

  return (
    <div className="fixed bottom-4 left-4 z-50 animate-in slide-in-from-bottom-5 data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom-5">
      <div className="bg-background border rounded-lg shadow-lg p-3">
        <div className="flex items-center gap-3">
          <Download className="h-4 w-4 text-primary animate-bounce" />
          <div className="flex flex-col min-w-[80px]">
            <p className="text-sm font-medium font-mono tabular-nums">
              {progress.mb_downloaded.toFixed(2)} MB
            </p>
            {progress.speed_mbps > 0 && (
              <p className="text-xs text-muted-foreground font-mono tabular-nums">
                {progress.speed_mbps.toFixed(2)} MB/s
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
