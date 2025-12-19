import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { StopCircle } from "lucide-react";

interface DownloadProgressProps {
  progress: number;
  currentTrack: { name: string; artists: string } | null;
  onStop: () => void;
}

export function DownloadProgress({ progress, currentTrack, onStop }: DownloadProgressProps) {
  const clampedProgress = Math.min(100, Math.max(0, progress));
  return (
    <div className="w-full space-y-2 mt-4">
      <div className="flex items-center gap-2">
        <Progress value={clampedProgress} className="h-2 flex-1" />
        <Button variant="destructive" size="sm" onClick={onStop} className="gap-1.5">
          <StopCircle className="h-4 w-4" />
          Stop
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {clampedProgress}% -{" "}
        {currentTrack
          ? `${currentTrack.name} - ${currentTrack.artists}`
          : "Preparing download..."}
      </p>
    </div>
  );
}
