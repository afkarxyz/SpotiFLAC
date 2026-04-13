import type { ArtistSimple } from "@/types/api";

export interface ClickableArtist {
    id: string;
    name: string;
    external_urls: string;
}

export function splitArtistNames(value: string): string[] {
    const trimmed = value.trim();
    if (!trimmed) {
        return [];
    }
    const parts = trimmed.split(/\s*[;,]\s*/).map((part) => part.trim()).filter(Boolean);
    return parts.length > 0 ? parts : [trimmed];
}

export function buildClickableArtists(artists: string, artistsData?: ArtistSimple[], fallbackArtistId?: string, fallbackArtistUrl?: string): ClickableArtist[] {
    const names = splitArtistNames(artists);
    if (names.length === 0) {
        return [];
    }
    return names.map((name, index) => {
        const artistData = artistsData?.[index];
        if (artistData && (artistData.id || artistData.external_urls)) {
            return {
                id: artistData.id || "",
                name,
                external_urls: artistData.external_urls || "",
            };
        }
        if (names.length === 1) {
            return {
                id: fallbackArtistId || "",
                name,
                external_urls: fallbackArtistUrl || "",
            };
        }
        return {
            id: "",
            name,
            external_urls: "",
        };
    });
}
