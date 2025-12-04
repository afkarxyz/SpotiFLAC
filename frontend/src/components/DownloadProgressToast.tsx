import { useDownloadProgress } from "@/hooks/useDownloadProgress";
import { useDownloadQueueData } from "@/hooks/useDownloadQueueData";
import { Download, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

interface DownloadProgressToastProps {
  onClick: () => void;
}

export function DownloadProgressToast({ onClick }: DownloadProgressToastProps) {
  const progress = useDownloadProgress();
  const queueInfo = useDownloadQueueData();

  // Show indicator if there are any queued or downloading items
  // Don't show for completed/failed/skipped only
  const hasActiveDownloads = queueInfo.queue.some(
    item => item.status === "queued" || item.status === "downloading"
  );

  if (!hasActiveDownloads) {
    return null;
  }

  return (
    <div className="fixed bottom-4 left-[calc(56px+1rem)] z-50 animate-in slide-in-from-bottom-5 data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom-5">
      <Button
        variant="outline"
        className="bg-background border rounded-lg shadow-lg p-3 h-auto hover:bg-muted/50 transition-colors cursor-pointer"
        onClick={onClick}
      >
        <div className="flex items-center gap-3">
          <Download className={`h-4 w-4 text-primary ${progress.is_downloading ? 'animate-bounce' : ''}`} />
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
          <ChevronRight className="h-4 w-4 text-muted-foreground ml-1" />
        </div>
      </Button>
    </div>
  );
}
