import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Settings } from "@/components/Settings";
import { Activity } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { openExternal } from "@/lib/utils";

interface HeaderProps {
  version: string;
  hasUpdate: boolean;
  onOpenAudioAnalysis: () => void;
}

export function Header({ version, hasUpdate, onOpenAudioAnalysis }: HeaderProps) {
  return (
    <div className="relative">
      <div className="text-center space-y-2">
        <div className="flex items-center justify-center gap-3">
          <img
            src="/icon.svg"
            alt="SpotiFLAC"
            className="w-12 h-12 cursor-pointer"
            onClick={() => window.location.reload()}
          />
          <h1
            className="text-4xl font-bold cursor-pointer"
            onClick={() => window.location.reload()}
          >
            SpotiFLAC
          </h1>
          <div className="relative">
            <Badge variant="default" asChild>
              <button
                type="button"
                onClick={() => openExternal("https://github.com/afkarxyz/SpotiFLAC/releases")}
                className="cursor-pointer hover:opacity-80 transition-opacity"
              >
                v{version}
              </button>
            </Badge>
            {hasUpdate && (
              <span className="absolute -top-1 -right-1 flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
              </span>
            )}
          </div>
        </div>
        <p className="text-muted-foreground">
          Get Spotify tracks in true FLAC from Tidal, Deezer, Qobuz & Amazon Music — no account required.
        </p>
      </div>
      <div className="absolute right-0 top-0 flex gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              onClick={() => openExternal("https://github.com/afkarxyz/SpotiFLAC/issues")}
              aria-label="GitHub Issues"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
              </svg>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left">
            <p>Report bug or request feature</p>
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="outline" size="icon" onClick={onOpenAudioAnalysis}>
              <Activity className="h-5 w-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left">
            <p>Audio Quality Analyzer</p>
          </TooltipContent>
        </Tooltip>
        <Settings />
      </div>
    </div>
  );
}
