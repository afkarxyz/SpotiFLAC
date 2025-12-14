import { Button } from "@/components/ui/button";
import { InputWithContext } from "@/components/ui/input-with-context";
import { Label } from "@/components/ui/label";
import { Search, Info, XCircle } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { FetchHistory } from "@/components/FetchHistory";
import type { HistoryItem } from "@/components/FetchHistory";

interface SearchBarProps {
  url: string;
  loading: boolean;
  onUrlChange: (url: string) => void;
  onFetch: () => void;
  history: HistoryItem[];
  onHistorySelect: (item: HistoryItem) => void;
  onHistoryRemove: (id: string) => void;
  hasResult: boolean;
}

export function SearchBar({
  url,
  loading,
  onUrlChange,
  onFetch,
  history,
  onHistorySelect,
  onHistoryRemove,
  hasResult,
}: SearchBarProps) {
  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Label htmlFor="spotify-url">Spotify URL</Label>
          <Tooltip>
            <TooltipTrigger asChild>
              <Info className="h-4 w-4 text-muted-foreground cursor-help" />
            </TooltipTrigger>
            <TooltipContent side="right">
              <p>Supports track, album, playlist, and artist URLs</p>
              <p className="mt-1">Note: Playlist must be public (not private)</p>
            </TooltipContent>
          </Tooltip>
        </div>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <InputWithContext
              id="spotify-url"
              placeholder="https://open.spotify.com/..."
              value={url}
              onChange={(e) => onUrlChange(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && onFetch()}
              className="pr-8"
            />
            {url && (
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                onClick={() => onUrlChange("")}
              >
                <XCircle className="h-4 w-4" />
              </button>
            )}
          </div>
          <Button onClick={onFetch} disabled={loading}>
            {loading ? (
              <>
                <Spinner />
                Fetching...
              </>
            ) : (
              <>
                <Search className="h-4 w-4" />
                Fetch
              </>
            )}
          </Button>
        </div>
      </div>
      {!hasResult && (
        <FetchHistory
          history={history}
          onSelect={onHistorySelect}
          onRemove={onHistoryRemove}
        />
      )}
    </div>
  );
}
