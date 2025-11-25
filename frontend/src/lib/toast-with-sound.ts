import { toast } from "sonner";
import {
  playSuccessSound,
  playErrorSound,
  playWarningSound,
  playInfoSound,
} from "./audio";
import { logger } from "./logger";

const toastStyle = {
  className: "font-mono lowercase",
};

// Wrapper functions for toast with sound effects
export const toastWithSound = {
  success: (message: string, data?: any) => {
    const msg = message.toLowerCase();
    logger.success(msg);
    playSuccessSound();
    return toast.success(msg, { ...toastStyle, ...data });
  },

  error: (message: string, data?: any) => {
    const msg = message.toLowerCase();
    logger.error(msg);
    playErrorSound();
    return toast.error(msg, { ...toastStyle, ...data });
  },

  warning: (message: string, data?: any) => {
    const msg = message.toLowerCase();
    logger.warning(msg);
    playWarningSound();
    return toast.warning(msg, { ...toastStyle, ...data });
  },

  info: (message: string, data?: any) => {
    const msg = message.toLowerCase();
    logger.info(msg);
    playInfoSound();
    return toast.info(msg, { ...toastStyle, ...data });
  },

  // Default toast without specific type
  message: (message: string, data?: any) => {
    const msg = message.toLowerCase();
    logger.info(msg);
    playInfoSound();
    return toast(msg, { ...toastStyle, ...data });
  },
};
