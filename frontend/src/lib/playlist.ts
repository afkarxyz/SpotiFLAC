export function buildPlaylistFolderName(playlistName?: string, ownerName?: string, includeOwner = false): string {
    const normalizedPlaylistName = playlistName?.trim() || "";
    if (!normalizedPlaylistName) {
        return "";
    }
    if (!includeOwner) {
        return normalizedPlaylistName;
    }
    const normalizedOwnerName = ownerName?.trim() || "";
    if (!normalizedOwnerName || normalizedOwnerName.toLowerCase() === normalizedPlaylistName.toLowerCase()) {
        return normalizedPlaylistName;
    }
    return `${normalizedPlaylistName}, ${normalizedOwnerName}`;
}
