import { useEffect, useState } from "react";
import { GetDownloadQueue } from "../../wailsjs/go/main/App";
import { backend } from "../../wailsjs/go/models";

export function useDownloadQueueData() {
  const [queueInfo, setQueueInfo] = useState<backend.DownloadQueueInfo>(
    new backend.DownloadQueueInfo({
      is_downloading: false,
      queue: [],
      current_speed: 0,
      total_downloaded: 0,
      session_start_time: 0,
      queued_count: 0,
      completed_count: 0,
      failed_count: 0,
      skipped_count: 0,
    })
  );

  useEffect(() => {
    const fetchQueue = async () => {
      try {
        const info = await GetDownloadQueue();
        setQueueInfo(info);
      } catch (error) {
        console.error("Failed to get download queue:", error);
      }
    };

    // Initial fetch
    fetchQueue();

    // Poll every 200ms
    const interval = setInterval(fetchQueue, 200);

    return () => clearInterval(interval);
  }, []);

  return queueInfo;
}
