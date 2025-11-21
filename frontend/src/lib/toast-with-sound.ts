import { toast } from 'sonner';
import { playSuccessSound, playErrorSound, playWarningSound, playInfoSound } from './audio';

// Wrapper functions for toast with sound effects
export const toastWithSound = {
  success: (message: string, data?: any) => {
    playSuccessSound();
    return toast.success(message, data);
  },
  
  error: (message: string, data?: any) => {
    playErrorSound();
    return toast.error(message, data);
  },
  
  warning: (message: string, data?: any) => {
    playWarningSound();
    return toast.warning(message, data);
  },
  
  info: (message: string, data?: any) => {
    playInfoSound();
    return toast.info(message, data);
  },
  
  // Default toast without specific type
  message: (message: string, data?: any) => {
    playInfoSound();
    return toast(message, data);
  },
};
