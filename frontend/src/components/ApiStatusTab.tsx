import { Button } from "@/components/ui/button";
import { RefreshCw, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { TidalIcon, QobuzIcon, AmazonIcon, LrclibIcon, MusicBrainzIcon } from "./PlatformIcons";
import { useApiStatus } from "@/hooks/useApiStatus";
export function ApiStatusTab() {
    const { sources, statuses, isCheckingAll, refreshAll } = useApiStatus();
    return (<div className="space-y-6">
      <div className="flex items-center justify-end">
        <Button variant="outline" onClick={() => void refreshAll()} disabled={isCheckingAll} className="gap-2">
          <RefreshCw className={`h-4 w-4 ${isCheckingAll ? "animate-spin" : ""}`}/>
          Refresh All
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {sources.map((source) => {
            const status = statuses[source.id] || "idle";
            return (<div key={source.id} className="flex items-center justify-between p-4 border rounded-lg bg-card text-card-foreground shadow-sm">
              <div className="flex items-center gap-3">
                {source.type === "tidal" ? <TidalIcon className="w-5 h-5 shrink-0 text-muted-foreground"/> : source.type === "amazon" ? <AmazonIcon className="w-5 h-5 shrink-0 text-muted-foreground"/> : source.type === "lrclib" ? <LrclibIcon className="w-5 h-5 shrink-0 text-muted-foreground"/> : source.type === "musicbrainz" ? <MusicBrainzIcon className="w-5 h-5 shrink-0 text-muted-foreground"/> : <QobuzIcon className="w-5 h-5 shrink-0 text-muted-foreground"/>}
                <p className="font-medium leading-none">{source.name}</p>
              </div>
              
              <div className="flex items-center">
                {status === "checking" && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground"/>}
                {status === "online" && <CheckCircle2 className="h-5 w-5 text-emerald-500"/>}
                {status === "offline" && <XCircle className="h-5 w-5 text-destructive"/>}
                {status === "idle" && <div className="h-5 w-5 rounded-full bg-muted"/>}
              </div>
            </div>);
        })}
      </div>
    </div>);
}
