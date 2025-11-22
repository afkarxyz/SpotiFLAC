import { useDownloadProgress } from "@/hooks/useDownloadProgress";
import { Download } from "lucide-react";

export function DownloadProgressToast() {
  const progress = useDownloadProgress();

  if (!progress.is_downloading) {
    return null;
  }

  return (
    <div className="fixed top-4 left-4 z-50 animate-in slide-in-from-left-5 data-[state=closed]:animate-out data-[state=closed]:slide-out-to-left-5">
      <div className="bg-background border rounded-lg shadow-lg p-3">
        <div className="flex items-center gap-2">
          <Download className="h-4 w-4 text-primary animate-bounce" />
          <p className="text-sm font-medium">
            {progress.mb_downloaded.toFixed(2)} MB
          </p>
        </div>
      </div>
    </div>
  );
}
