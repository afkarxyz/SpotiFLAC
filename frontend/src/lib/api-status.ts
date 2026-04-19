import { CheckAPIStatus } from "../../wailsjs/go/main/App";
import { CHECK_TIMEOUT_MS, withTimeout } from "@/lib/async-timeout";

export type ApiCheckStatus = "checking" | "online" | "offline" | "idle";

export interface ApiSource {
    id: string;
    type: string;
    name: string;
    url: string;
}

interface SpotiFLACNextSource {
    id: string;
    name: string;
}

type SpotiFLACNextStatusResponse = {
    tidal?: string;
    qobuz_a?: string;
    qobuz_b?: string;
    qobuz_c?: string;
    deezer_a?: string;
    deezer_b?: string;
    amazon_a?: string;
    amazon_b?: string;
    amazon_c?: string;
    apple?: string;
};

export const API_SOURCES: ApiSource[] = [
    { id: "tidal", type: "tidal", name: "Tidal", url: "" },
    { id: "qobuz", type: "qobuz", name: "Qobuz", url: "" },
    { id: "amazon", type: "amazon", name: "Amazon Music", url: "" },
    { id: "musicbrainz", type: "musicbrainz", name: "MusicBrainz", url: "https://musicbrainz.org" },
];

export const SPOTIFLAC_NEXT_SOURCES: SpotiFLACNextSource[] = [
    { id: "tidal", name: "Tidal" },
    { id: "qobuz", name: "Qobuz" },
    { id: "amazon", name: "Amazon Music" },
    { id: "deezer", name: "Deezer" },
    { id: "apple", name: "Apple Music" },
];

const SPOTIFLAC_NEXT_STATUS_URL = "https://status.spotbye.qzz.io/status";
const SPOTIFLAC_NEXT_MAX_ATTEMPTS = 3;
const SPOTIFLAC_NEXT_RETRY_DELAY_MS = 1200;

type ApiStatusState = {
    checkingSources: Record<string, boolean>;
    statuses: Record<string, ApiCheckStatus>;
    nextStatuses: Record<string, ApiCheckStatus>;
};

let apiStatusState: ApiStatusState = {
    checkingSources: {},
    statuses: {},
    nextStatuses: {},
};

let activeCheckNextOnly: Promise<void> | null = null;
const activeSourceChecks = new Map<string, Promise<void>>();
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

function statusFromNextValue(value: string | undefined): ApiCheckStatus {
    return value === "up" ? "online" : "offline";
}

function anyNextVariantUp(values: Array<string | undefined>): ApiCheckStatus {
    return values.some((value) => value === "up") ? "online" : "offline";
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function getSafeNextStatusesFallback(currentStatuses: Record<string, ApiCheckStatus>): Record<string, ApiCheckStatus> {
    return SPOTIFLAC_NEXT_SOURCES.reduce<Record<string, ApiCheckStatus>>((acc, source) => {
        const current = currentStatuses[source.id];
        acc[source.id] = current === "online" || current === "offline" ? current : "idle";
        return acc;
    }, {});
}

async function fetchSpotiFLACNextStatusesOnce(): Promise<Record<string, ApiCheckStatus>> {
    const response = await withTimeout(fetch(SPOTIFLAC_NEXT_STATUS_URL, {
        method: "GET",
        cache: "no-store",
        headers: {
            Accept: "application/json",
        },
    }), CHECK_TIMEOUT_MS, "SpotiFLAC Next status check timed out after 10 seconds");

    if (!response.ok) {
        throw new Error(`SpotiFLAC Next status returned ${response.status}`);
    }

    const payload = (await response.json()) as SpotiFLACNextStatusResponse;
    return {
        tidal: statusFromNextValue(payload.tidal),
        qobuz: anyNextVariantUp([payload.qobuz_a, payload.qobuz_b, payload.qobuz_c]),
        deezer: anyNextVariantUp([payload.deezer_a, payload.deezer_b]),
        amazon: anyNextVariantUp([payload.amazon_a, payload.amazon_b, payload.amazon_c]),
        apple: statusFromNextValue(payload.apple),
    };
}

async function checkSpotiFLACNextStatuses(): Promise<Record<string, ApiCheckStatus>> {
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= SPOTIFLAC_NEXT_MAX_ATTEMPTS; attempt++) {
        try {
            return await fetchSpotiFLACNextStatusesOnce();
        }
        catch (error) {
            lastError = error;
            if (attempt < SPOTIFLAC_NEXT_MAX_ATTEMPTS) {
                await delay(SPOTIFLAC_NEXT_RETRY_DELAY_MS * attempt);
            }
        }
    }

    throw lastError instanceof Error ? lastError : new Error("SpotiFLAC Next status check failed");
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

function hasSpotiFLACNextResults(): boolean {
    return SPOTIFLAC_NEXT_SOURCES.some((source) => {
        const status = apiStatusState.nextStatuses[source.id];
        return status === "online" || status === "offline";
    });
}

export async function checkSpotiFLACNextStatusesOnly(): Promise<void> {
    if (activeCheckNextOnly) {
        return activeCheckNextOnly;
    }

    activeCheckNextOnly = (async () => {
        const checkingNextStatuses = Object.fromEntries(SPOTIFLAC_NEXT_SOURCES.map((source) => [source.id, "checking" as ApiCheckStatus]));
        setApiStatusState((current) => ({
            ...current,
            nextStatuses: {
                ...current.nextStatuses,
                ...checkingNextStatuses,
            },
        }));

        try {
            setApiStatusState((current) => ({
                ...current,
                nextStatuses: { ...current.nextStatuses },
            }));

            const nextStatuses = await checkSpotiFLACNextStatuses();

            setApiStatusState((current) => ({
                ...current,
                nextStatuses: {
                    ...current.nextStatuses,
                    ...nextStatuses,
                },
            }));
        }
        catch {
            setApiStatusState((current) => ({
                ...current,
                nextStatuses: getSafeNextStatusesFallback(current.nextStatuses),
            }));
        }
        finally {
            activeCheckNextOnly = null;
        }
    })();

    return activeCheckNextOnly;
}

export function ensureSpotiFLACNextStatusCheckStarted(): void {
    if (!activeCheckNextOnly && !hasSpotiFLACNextResults()) {
        void checkSpotiFLACNextStatusesOnly();
    }
}

export async function checkApiStatus(sourceId: string): Promise<void> {
    const source = API_SOURCES.find((item) => item.id === sourceId);
    if (!source) {
        return;
    }

    const activeCheck = activeSourceChecks.get(sourceId);
    if (activeCheck) {
        return activeCheck;
    }

    const task = (async () => {
        setApiStatusState((current) => ({
            ...current,
            checkingSources: {
                ...current.checkingSources,
                [sourceId]: true,
            },
            statuses: {
                ...current.statuses,
                [sourceId]: "checking",
            },
        }));

        try {
            const status = await checkSourceStatus(source);

            setApiStatusState((current) => ({
                ...current,
                statuses: {
                    ...current.statuses,
                    [sourceId]: status,
                },
            }));
        }
        finally {
            setApiStatusState((current) => ({
                ...current,
                checkingSources: {
                    ...current.checkingSources,
                    [sourceId]: false,
                },
            }));
            activeSourceChecks.delete(sourceId);
        }
    })();

    activeSourceChecks.set(sourceId, task);
    return task;
}
