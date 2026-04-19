import { CheckAPIStatus, FetchUnifiedAPIStatus } from "../../wailsjs/go/main/App";
import { CHECK_TIMEOUT_MS, withTimeout } from "@/lib/async-timeout";
export type ApiCheckStatus = "checking" | "online" | "offline" | "idle";
export interface ApiSource {
    id: string;
    type: string;
    name: string;
    url: string;
}
export const API_SOURCES: ApiSource[] = [
    { id: "tidal1", type: "tidal", name: "Tidal A", url: "https://hifi-one.spotisaver.net" },
    { id: "tidal2", type: "tidal", name: "Tidal B", url: "https://hifi-two.spotisaver.net" },
    { id: "tidal3", type: "tidal", name: "Tidal C", url: "https://eu-central.monochrome.tf" },
    { id: "tidal4", type: "tidal", name: "Tidal D", url: "https://us-west.monochrome.tf" },
    { id: "tidal5", type: "tidal", name: "Tidal E", url: "https://api.monochrome.tf" },
    { id: "tidal6", type: "tidal", name: "Tidal F", url: "https://monochrome-api.samidy.com" },
    { id: "tidal7", type: "tidal", name: "Tidal G", url: "https://tidal.kinoplus.online" },
    { id: "qobuz1", type: "qobuz", name: "Qobuz A", url: "https://dab.yeet.su" },
    { id: "qobuz2", type: "qobuz", name: "Qobuz B", url: "https://dabmusic.xyz" },
    { id: "qobuz3", type: "qbz", name: "Qobuz C", url: "https://qobuz.spotbye.qzz.io" },
    { id: "amazon1", type: "amazon", name: "Amazon Music", url: "https://amazon.spotbye.qzz.io" },
    { id: "lrclib", type: "lrclib", name: "LRCLIB", url: "https://lrclib.net" },
    { id: "musicbrainz", type: "musicbrainz", name: "MusicBrainz", url: "https://musicbrainz.org" },
];
type ApiStatusState = {
    isCheckingAll: boolean;
    statuses: Record<string, ApiCheckStatus>;
};
let apiStatusState: ApiStatusState = {
    isCheckingAll: false,
    statuses: {},
};
let activeCheckAll: Promise<void> | null = null;
const listeners = new Set<() => void>();
type SpotiFLACUnifiedStatusResponse = {
    tidal?: string;
    qobuz_a?: string;
    qobuz_b?: string;
    qobuz_c?: string;
    amazon?: string;
    lrclib?: string;
};
function emitApiStatusChange() {
    for (const listener of listeners) {
        listener();
    }
}
function setApiStatusState(updater: (current: ApiStatusState) => ApiStatusState) {
    apiStatusState = updater(apiStatusState);
    emitApiStatusChange();
}
function statusFromUnifiedValue(value: string | undefined): ApiCheckStatus {
    return value === "up" ? "online" : "offline";
}
async function fetchUnifiedStatuses(forceRefresh: boolean): Promise<Pick<ApiStatusState, "statuses">> {
    const response = await FetchUnifiedAPIStatus(forceRefresh);
    const payload = JSON.parse(response) as SpotiFLACUnifiedStatusResponse;
    const tidalStatus = statusFromUnifiedValue(payload.tidal);
    return {
        statuses: {
            tidal1: tidalStatus,
            tidal2: tidalStatus,
            tidal3: tidalStatus,
            tidal4: tidalStatus,
            tidal5: tidalStatus,
            tidal6: tidalStatus,
            tidal7: tidalStatus,
            qobuz1: statusFromUnifiedValue(payload.qobuz_a),
            qobuz2: statusFromUnifiedValue(payload.qobuz_b),
            qobuz3: statusFromUnifiedValue(payload.qobuz_c),
            amazon1: statusFromUnifiedValue(payload.amazon),
            lrclib: statusFromUnifiedValue(payload.lrclib),
        },
    };
}
async function checkMusicBrainzStatus(): Promise<ApiCheckStatus> {
    try {
        const isOnline = await withTimeout(CheckAPIStatus("musicbrainz", "https://musicbrainz.org"), CHECK_TIMEOUT_MS, "API status check timed out after 10 seconds for MusicBrainz");
        return isOnline ? "online" : "offline";
    }
    catch {
        return "offline";
    }
}
export function getApiStatusState(): ApiStatusState {
    return apiStatusState;
}
export function subscribeApiStatus(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}
export async function checkAllApiStatuses(forceRefresh: boolean = false): Promise<void> {
    if (activeCheckAll) {
        return activeCheckAll;
    }
    activeCheckAll = (async () => {
        const checkingStatuses = Object.fromEntries(API_SOURCES.map((source) => [source.id, "checking" as ApiCheckStatus]));
        setApiStatusState((current) => ({
            ...current,
            isCheckingAll: true,
            statuses: {
                ...current.statuses,
                ...checkingStatuses,
            },
        }));
        try {
            const [unifiedResult, musicBrainzStatus] = await Promise.allSettled([
                withTimeout(fetchUnifiedStatuses(forceRefresh), CHECK_TIMEOUT_MS, "Unified SpotiFLAC status check timed out after 10 seconds"),
                checkMusicBrainzStatus(),
            ]);
            setApiStatusState((current) => {
                const nextStatuses = { ...current.statuses };
                if (unifiedResult.status === "fulfilled") {
                    Object.assign(nextStatuses, unifiedResult.value.statuses);
                }
                else {
                    nextStatuses.tidal1 = "offline";
                    nextStatuses.tidal2 = "offline";
                    nextStatuses.tidal3 = "offline";
                    nextStatuses.tidal4 = "offline";
                    nextStatuses.tidal5 = "offline";
                    nextStatuses.tidal6 = "offline";
                    nextStatuses.tidal7 = "offline";
                    nextStatuses.qobuz1 = "offline";
                    nextStatuses.qobuz2 = "offline";
                    nextStatuses.qobuz3 = "offline";
                    nextStatuses.amazon1 = "offline";
                    nextStatuses.lrclib = "offline";
                }
                nextStatuses.musicbrainz =
                    musicBrainzStatus.status === "fulfilled" ? musicBrainzStatus.value : "offline";
                return {
                    ...current,
                    statuses: nextStatuses,
                };
            });
        }
        finally {
            setApiStatusState((current) => ({
                ...current,
                isCheckingAll: false,
            }));
            activeCheckAll = null;
        }
    })();
    return activeCheckAll;
}
