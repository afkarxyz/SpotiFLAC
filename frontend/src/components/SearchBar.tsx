import { Button } from "@/components/ui/button";
import { InputWithContext } from "@/components/ui/input-with-context";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Search, Info, XCircle } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface SearchBarProps {
  url: string;
  loading: boolean;
  onUrlChange: (url: string) => void;
  onFetch: () => void;
}

export function SearchBar({ url, loading, onUrlChange, onFetch }: SearchBarProps) {
  return (
    <Card>
      <CardContent className="px-6 py-6 space-y-4">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Label htmlFor="spotify-url">Spotify URL</Label>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-4 w-4 text-muted-foreground cursor-help" />
              </TooltipTrigger>
              <TooltipContent side="right">
                <p>Supports track, album, playlist, and artist URLs</p>
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
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
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
      </CardContent>
    </Card>
  );
}
