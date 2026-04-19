import { Button } from "@/components/ui/button";
import { SearchCheck, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { TidalIcon, QobuzIcon, AmazonIcon, MusicBrainzIcon, AppleMusicIcon, DeezerIcon } from "./PlatformIcons";
import { useApiStatus } from "@/hooks/useApiStatus";
import { SPOTIFLAC_NEXT_SOURCES } from "@/lib/api-status";

function renderStatusIcon(status: "checking" | "online" | "offline" | "idle") {
    if (status === "online") {
        return <CheckCircle2 className="h-5 w-5 text-emerald-500"/>;
    }
    if (status === "offline") {
        return <XCircle className="h-5 w-5 text-destructive"/>;
    }
    return null;
}

function renderPlatformIcon(type: string) {
    if (type === "tidal") {
        return <TidalIcon className="w-5 h-5 shrink-0 text-muted-foreground"/>;
    }
    if (type === "amazon") {
        return <AmazonIcon className="w-5 h-5 shrink-0 text-muted-foreground"/>;
    }
    if (type === "musicbrainz") {
        return <MusicBrainzIcon className="w-5 h-5 shrink-0 text-muted-foreground"/>;
    }
    if (type === "deezer") {
        return <DeezerIcon className="w-5 h-5 shrink-0 text-muted-foreground"/>;
    }
    if (type === "apple") {
        return <AppleMusicIcon className="w-5 h-5 shrink-0 text-muted-foreground"/>;
    }
    return <QobuzIcon className="w-5 h-5 shrink-0 text-muted-foreground"/>;
}

export function ApiStatusTab() {
    const { sources, statuses, nextStatuses, checkingSources, checkOne } = useApiStatus();
    return (<div className="space-y-6">
      <div className="space-y-4">
        <h3 className="text-sm font-semibold tracking-tight">SpotiFLAC Services</h3>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {sources.map((source) => {
            const status = statuses[source.id] || "idle";
            const isChecking = checkingSources[source.id] === true;
            return (<div key={source.id} className="space-y-4 p-4 border rounded-lg bg-card text-card-foreground shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    {renderPlatformIcon(source.type)}
                    <p className="font-medium leading-none">{source.name}</p>
                  </div>
                  <div className="flex items-center">{renderStatusIcon(status)}</div>
                </div>
                <Button variant="outline" size="sm" onClick={() => void checkOne(source.id)} disabled={isChecking} className="w-full gap-2">
                  {isChecking ? <Loader2 className="h-4 w-4 animate-spin"/> : <SearchCheck className="h-4 w-4"/>}
                  Check
                </Button>
              </div>);
        })}
        </div>
      </div>

      <div className="border-t"/>

      <div className="space-y-4">
        <h3 className="text-sm font-semibold tracking-tight">SpotiFLAC Next Services</h3>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
          {SPOTIFLAC_NEXT_SOURCES.map((source) => {
            const status = nextStatuses[source.id] || "idle";
            return (<div key={source.id} className="flex items-center justify-between p-4 border rounded-lg bg-card text-card-foreground shadow-sm">
              <div className="flex items-center gap-3">
                {renderPlatformIcon(source.id)}
                <p className="font-medium leading-none">{source.name}</p>
              </div>
              <div className="flex items-center">{renderStatusIcon(status)}</div>
            </div>);
        })}
        </div>
      </div>
    </div>);
}
