import { useState, useCallback } from "react";
import { CheckTrackAvailability } from "../../wailsjs/go/main/App";
import type { TrackAvailability } from "@/types/api";
import { logger } from "@/lib/logger";

export function useAvailability() {
  const [checking, setChecking] = useState(false);
  const [checkingTrackId, setCheckingTrackId] = useState<string | null>(null);
  const [availabilityMap, setAvailabilityMap] = useState<Map<string, TrackAvailability>>(new Map());
  const [error, setError] = useState<string | null>(null);

  const checkAvailability = useCallback(async (spotifyId: string, isrc?: string) => {
    if (!spotifyId) {
      setError("No Spotify ID provided");
      return null;
    }

    // Check if already cached
    if (availabilityMap.has(spotifyId)) {
      return availabilityMap.get(spotifyId)!;
    }

    setChecking(true);
    setCheckingTrackId(spotifyId);
    setError(null);

    try {
      logger.info(`Checking availability for track: ${spotifyId}`);
      const response = await CheckTrackAvailability(spotifyId, isrc || "");
      const availability: TrackAvailability = JSON.parse(response);

      setAvailabilityMap((prev) => {
        const newMap = new Map(prev);
        newMap.set(spotifyId, availability);
        return newMap;
      });

      logger.success(`Availability check completed for ${spotifyId}`);
      return availability;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to check availability";
      logger.error(`Availability check error: ${errorMessage}`);
      setError(errorMessage);
      return null;
    } finally {
      setChecking(false);
      setCheckingTrackId(null);
    }
  }, [availabilityMap]);

  const getAvailability = useCallback((spotifyId: string) => {
    return availabilityMap.get(spotifyId);
  }, [availabilityMap]);

  const clearAvailability = useCallback(() => {
    setAvailabilityMap(new Map());
    setError(null);
  }, []);

  return {
    checking,
    checkingTrackId,
    availabilityMap,
    error,
    checkAvailability,
    getAvailability,
    clearAvailability,
  };
}
