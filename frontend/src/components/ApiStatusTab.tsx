import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { RefreshCw, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { CheckAPIStatus } from "../../wailsjs/go/main/App";
import { TidalIcon, QobuzIcon, AmazonIcon } from "./PlatformIcons";
interface ApiSource {
    id: string;
    type: string;
    name: string;
    url: string;
}
const SOURCES: ApiSource[] = [
    { id: "tidal1", type: "tidal", name: "Tidal A", url: "https://hifi-one.spotisaver.net" },
    { id: "tidal2", type: "tidal", name: "Tidal B", url: "https://hifi-two.spotisaver.net" },
    { id: "tidal3", type: "tidal", name: "Tidal C", url: "https://eu-central.monochrome.tf" },
    { id: "tidal4", type: "tidal", name: "Tidal D", url: "https://us-west.monochrome.tf" },
    { id: "tidal5", type: "tidal", name: "Tidal E", url: "https://api.monochrome.tf" },
    { id: "tidal6", type: "tidal", name: "Tidal F", url: "https://monochrome-api.samidy.com" },
    { id: "tidal7", type: "tidal", name: "Tidal G", url: "https://tidal.kinoplus.online" },
    { id: "qobuz1", type: "qobuz", name: "Qobuz A", url: "https://dab.yeet.su" },
    { id: "qobuz2", type: "qobuz", name: "Qobuz B", url: "https://dabmusic.xyz" },
    { id: "qobuz3", type: "qbz", name: "Qobuz C", url: "https://qbz.afkarxyz.fun" },
    { id: "amazon1", type: "amazon", name: "Amazon Music", url: "https://amzn.afkarxyz.fun" },
];
export function ApiStatusTab() {
    const [statuses, setStatuses] = useState<Record<string, "checking" | "online" | "offline" | "idle">>({});
    const [isCheckingAll, setIsCheckingAll] = useState(false);
    const checkStatus = async (sourceId: string, apiType: string, url: string) => {
        setStatuses(prev => ({ ...prev, [sourceId]: "checking" }));
        try {
            const isOnline = await CheckAPIStatus(apiType, url);
            setStatuses(prev => ({ ...prev, [sourceId]: isOnline ? "online" : "offline" }));
        }
        catch (error) {
            setStatuses(prev => ({ ...prev, [sourceId]: "offline" }));
        }
    };
    const checkAll = async () => {
        setIsCheckingAll(true);
        const promises = SOURCES.map(s => checkStatus(s.id, s.type, s.url));
        await Promise.allSettled(promises);
        setIsCheckingAll(false);
    };
    useEffect(() => {
        checkAll();
    }, []);
    return (<div className="space-y-6">
      <div className="flex items-center justify-end">
        <Button variant="outline" onClick={checkAll} disabled={isCheckingAll} className="gap-2">
          <RefreshCw className={`h-4 w-4 ${isCheckingAll ? "animate-spin" : ""}`}/>
          Refresh All
        </Button>
      </div>

      <div className="grid grid-cols-4 gap-4">
        {SOURCES.map((source) => {
            const status = statuses[source.id] || "idle";
            return (<div key={source.id} className="flex items-center justify-between p-4 border rounded-lg bg-card text-card-foreground shadow-sm">
              <div className="flex items-center gap-3">
                {source.type === "tidal" ? <TidalIcon className="w-5 h-5 shrink-0 text-muted-foreground"/> : source.type === "amazon" ? <AmazonIcon className="w-5 h-5 shrink-0 text-muted-foreground"/> : <QobuzIcon className="w-5 h-5 shrink-0 text-muted-foreground"/>}
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
