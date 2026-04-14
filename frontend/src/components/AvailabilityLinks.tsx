import type { ReactNode } from "react";
import type { TrackAvailability } from "@/types/api";
import { openExternal } from "@/lib/utils";
import { AmazonAvailabilityIcon, QobuzAvailabilityIcon, TidalAvailabilityIcon } from "./PlatformIcons";
interface AvailabilityLinkEntry {
    id: string;
    found: boolean;
    url?: string;
    icon: ReactNode;
}
function getAvailabilityLinkEntries(availability: TrackAvailability): AvailabilityLinkEntry[] {
    const tidalUrl = availability.tidal_url?.trim() || "";
    const qobuzUrl = availability.qobuz_url?.trim() || "";
    const amazonUrl = availability.amazon_url?.trim() || "";
    return [
        {
            id: "tidal",
            found: tidalUrl !== "",
            url: tidalUrl,
            icon: <TidalAvailabilityIcon className={`w-4 h-4 shrink-0 ${tidalUrl ? "text-green-500" : "text-red-500"}`}/>,
        },
        {
            id: "qobuz",
            found: qobuzUrl !== "",
            url: qobuzUrl,
            icon: <QobuzAvailabilityIcon className={`w-4 h-4 shrink-0 ${qobuzUrl ? "text-green-500" : "text-red-500"}`}/>,
        },
        {
            id: "amazon",
            found: amazonUrl !== "",
            url: amazonUrl,
            icon: <AmazonAvailabilityIcon className={`w-4 h-4 shrink-0 ${amazonUrl ? "text-green-500" : "text-red-500"}`}/>,
        },
    ];
}
export function hasAvailabilityLinks(availability?: TrackAvailability): boolean {
    if (!availability) {
        return false;
    }
    return getAvailabilityLinkEntries(availability).some((entry) => entry.found);
}
export function AvailabilityLinks({ availability }: {
    availability?: TrackAvailability;
}) {
    if (!availability) {
        return <p>Check Availability</p>;
    }
    const entries = getAvailabilityLinkEntries(availability);
    return (<div className="flex flex-col gap-1.5 w-[260px] max-w-[260px] pointer-events-auto">
            {entries.map((entry) => entry.found ? (<button key={entry.id} type="button" onClick={() => entry.url && openExternal(entry.url)} className="flex items-center gap-2 text-left text-xs hover:underline min-w-0 cursor-pointer" title={entry.url}>
                    {entry.icon}
                    <span className="truncate whitespace-nowrap leading-5 min-w-0">
                        {entry.url}
                    </span>
                </button>) : (<div key={entry.id} className="flex items-center gap-2 text-left text-xs min-w-0">
                    {entry.icon}
                    <span className="truncate whitespace-nowrap leading-5 min-w-0 text-red-500">
                        Not Found
                    </span>
                </div>))}
        </div>);
}
