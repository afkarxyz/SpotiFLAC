import { useState } from "react";

export function useDownloadQueueDialog() {
  const [isOpen, setIsOpen] = useState(false);

  const openQueue = () => setIsOpen(true);
  const closeQueue = () => setIsOpen(false);
  const toggleQueue = () => setIsOpen((prev) => !prev);

  return {
    isOpen,
    openQueue,
    closeQueue,
    toggleQueue,
  };
}
