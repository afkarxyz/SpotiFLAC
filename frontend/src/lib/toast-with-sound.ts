import { toast } from "sonner";
import {
  playSuccessSound,
  playErrorSound,
  playWarningSound,
  playInfoSound,
} from "./audio";
import { logger } from "./logger";
import { getSettings } from "./settings";

const toastStyle = {
  className: "font-mono lowercase",
};

// Helper to check if SFX is enabled
const isSfxEnabled = () => getSettings().sfxEnabled;

// Wrapper functions for toast with sound effects
export const toastWithSound = {
  success: (message: string, data?: any) => {
    const msg = message.toLowerCase();
    logger.success(msg);
    if (isSfxEnabled()) playSuccessSound();
    return toast.success(msg, { ...toastStyle, ...data });
  },

  error: (message: string, data?: any) => {
    const msg = message.toLowerCase();
    logger.error(msg);
    if (isSfxEnabled()) playErrorSound();
    return toast.error(msg, { ...toastStyle, ...data });
  },

  warning: (message: string, data?: any) => {
    const msg = message.toLowerCase();
    logger.warning(msg);
    if (isSfxEnabled()) playWarningSound();
    return toast.warning(msg, { ...toastStyle, ...data });
  },

  info: (message: string, data?: any) => {
    const msg = message.toLowerCase();
    logger.info(msg);
    if (isSfxEnabled()) playInfoSound();
    return toast.info(msg, { ...toastStyle, ...data });
  },

  // Default toast without specific type
  message: (message: string, data?: any) => {
    const msg = message.toLowerCase();
    logger.info(msg);
    if (isSfxEnabled()) playInfoSound();
    return toast(msg, { ...toastStyle, ...data });
  },
};
