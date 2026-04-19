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
    { id: "tidal", type: "tidal", name: "Tidal", url: "" },
    { id: "qobuz", type: "qobuz", name: "Qobuz", url: "" },
    { id: "amazon", type: "amazon", name: "Amazon Music", url: "" },
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

async function checkSourceStatus(source: ApiSource): Promise<ApiCheckStatus> {
    try {
        const isOnline = await withTimeout(CheckAPIStatus(source.type, source.url), CHECK_TIMEOUT_MS, `API status check timed out after 10 seconds for ${source.name}`);
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

export async function checkAllApiStatuses(_forceRefresh: boolean = false): Promise<void> {
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
            const results = await Promise.all(API_SOURCES.map(async (source) => ({
                id: source.id,
                status: await checkSourceStatus(source),
            })));

            setApiStatusState((current) => ({
                ...current,
                statuses: results.reduce<Record<string, ApiCheckStatus>>((acc, result) => {
                    acc[result.id] = result.status;
                    return acc;
                }, { ...current.statuses }),
            }));
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
