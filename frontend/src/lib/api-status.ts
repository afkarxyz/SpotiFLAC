import { CheckAPIStatus } from "../../wailsjs/go/main/App";
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
    { id: "qobuz3", type: "qbz", name: "Qobuz C", url: "https://qbz.afkarxyz.qzz.io" },
    { id: "amazon1", type: "amazon", name: "Amazon Music", url: "https://amzn.afkarxyz.qzz.io" },
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
function emitApiStatusChange() {
    for (const listener of listeners) {
        listener();
    }
}
function setApiStatusState(updater: (current: ApiStatusState) => ApiStatusState) {
    apiStatusState = updater(apiStatusState);
    emitApiStatusChange();
}
async function checkSingleApiStatus(source: ApiSource): Promise<void> {
    setApiStatusState((current) => ({
        ...current,
        statuses: {
            ...current.statuses,
            [source.id]: "checking",
        },
    }));
    try {
        const isOnline = await withTimeout(CheckAPIStatus(source.type, source.url), CHECK_TIMEOUT_MS, `API status check timed out after 10 seconds for ${source.url}`);
        setApiStatusState((current) => ({
            ...current,
            statuses: {
                ...current.statuses,
                [source.id]: isOnline ? "online" : "offline",
            },
        }));
    }
    catch {
        setApiStatusState((current) => ({
            ...current,
            statuses: {
                ...current.statuses,
                [source.id]: "offline",
            },
        }));
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
export function hasApiStatusResults(): boolean {
    return API_SOURCES.some((source) => {
        const status = apiStatusState.statuses[source.id];
        return status === "online" || status === "offline";
    });
}
export function ensureApiStatusCheckStarted(): void {
    if (!activeCheckAll && !hasApiStatusResults()) {
        void checkAllApiStatuses();
    }
}
export async function checkAllApiStatuses(): Promise<void> {
    if (activeCheckAll) {
        return activeCheckAll;
    }
    activeCheckAll = (async () => {
        setApiStatusState((current) => ({
            ...current,
            isCheckingAll: true,
        }));
        try {
            await Promise.allSettled(API_SOURCES.map((source) => checkSingleApiStatus(source)));
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
