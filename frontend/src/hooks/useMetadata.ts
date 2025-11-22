import { useState } from "react";
import { fetchSpotifyMetadata } from "@/lib/api";
import { toastWithSound as toast } from "@/lib/toast-with-sound";
import type { SpotifyMetadataResponse } from "@/types/api";

export function useMetadata() {
  const [loading, setLoading] = useState(false);
  const [metadata, setMetadata] = useState<SpotifyMetadataResponse | null>(null);
  const [showTimeoutDialog, setShowTimeoutDialog] = useState(false);
  const [timeoutValue, setTimeoutValue] = useState(60);
  const [pendingUrl, setPendingUrl] = useState("");
  const [showAlbumDialog, setShowAlbumDialog] = useState(false);
  const [selectedAlbum, setSelectedAlbum] = useState<{
    id: string;
    name: string;
    external_urls: string;
  } | null>(null);

  const fetchMetadataDirectly = async (url: string) => {
    setLoading(true);
    setMetadata(null);

    try {
      const data = await fetchSpotifyMetadata(url);
      setMetadata(data);
      toast.success("Metadata fetched successfully");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to fetch metadata");
    } finally {
      setLoading(false);
    }
  };

  const handleFetchMetadata = async (url: string) => {
    if (!url.trim()) {
      toast.error("Please enter a Spotify URL");
      return;
    }

    let urlToFetch = url.trim();
    const isArtistUrl = urlToFetch.includes("/artist/");

    if (isArtistUrl && !urlToFetch.includes("/discography")) {
      urlToFetch = urlToFetch.replace(/\/$/, "") + "/discography/all";
    }

    if (isArtistUrl) {
      setPendingUrl(urlToFetch);
      setShowTimeoutDialog(true);
    } else {
      await fetchMetadataDirectly(urlToFetch);
    }

    return urlToFetch;
  };

  const handleConfirmFetch = async () => {
    setShowTimeoutDialog(false);
    setLoading(true);
    setMetadata(null);

    try {
      const data = await fetchSpotifyMetadata(pendingUrl, true, 1.0, timeoutValue);
      setMetadata(data);
      toast.success("Metadata fetched successfully");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to fetch metadata");
    } finally {
      setLoading(false);
    }
  };

  const handleAlbumClick = (album: {
    id: string;
    name: string;
    external_urls: string;
  }) => {
    setSelectedAlbum(album);
    setShowAlbumDialog(true);
  };

  const handleConfirmAlbumFetch = async () => {
    if (!selectedAlbum) return;

    setShowAlbumDialog(false);
    setLoading(true);
    setMetadata(null);

    try {
      const data = await fetchSpotifyMetadata(selectedAlbum.external_urls);
      setMetadata(data);
      toast.success("Album metadata fetched successfully");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to fetch album metadata");
    } finally {
      setLoading(false);
      setSelectedAlbum(null);
    }
  };

  return {
    loading,
    metadata,
    showTimeoutDialog,
    setShowTimeoutDialog,
    timeoutValue,
    setTimeoutValue,
    showAlbumDialog,
    setShowAlbumDialog,
    selectedAlbum,
    handleFetchMetadata,
    handleConfirmFetch,
    handleAlbumClick,
    handleConfirmAlbumFetch,
  };
}
