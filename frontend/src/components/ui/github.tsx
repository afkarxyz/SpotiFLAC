'use client';

import type { Variants } from 'motion/react';
import type { HTMLAttributes } from 'react';
import { forwardRef, useCallback, useImperativeHandle, useRef } from 'react';
import { motion, useAnimation } from 'motion/react';

import { cn } from '@/lib/utils';

export interface GithubIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface GithubIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const BODY_VARIANTS: Variants = {
  normal: {
    opacity: 1,
    pathLength: 1,
    scale: 1,
    transition: {
      duration: 0.3,
    },
  },
  animate: {
    opacity: [0, 1],
    pathLength: [0, 1],
    scale: [0.9, 1],
    transition: {
      duration: 0.4,
    },
  },
};

const TAIL_VARIANTS: Variants = {
  normal: {
    pathLength: 1,
    rotate: 0,
    transition: {
      duration: 0.3,
    },
  },
  draw: {
    pathLength: [0, 1],
    rotate: 0,
    transition: {
      duration: 0.5,
    },
  },
  wag: {
    pathLength: 1,
    rotate: [0, -15, 15, -10, 10, -5, 5],
    transition: {
      duration: 2.5,
      ease: 'easeInOut',
      repeat: Infinity,
    },
  },
};

const GithubIcon = forwardRef<GithubIconHandle, GithubIconProps>(
  ({ onMouseEnter, onMouseLeave, className, size = 28, ...props }, ref) => {
    const bodyControls = useAnimation();
    const tailControls = useAnimation();
    const isControlledRef = useRef(false);

    useImperativeHandle(ref, () => {
      isControlledRef.current = true;

      return {
        startAnimation: async () => {
          bodyControls.start('animate');
          await tailControls.start('draw');
          tailControls.start('wag');
        },
        stopAnimation: () => {
          bodyControls.start('normal');
          tailControls.start('normal');
        },
      };
    });

    const handleMouseEnter = useCallback(
      async (e: React.MouseEvent<HTMLDivElement>) => {
        if (!isControlledRef.current) {
          bodyControls.start('animate');
          await tailControls.start('draw');
          tailControls.start('wag');
        } else {
          onMouseEnter?.(e);
        }
      },
      [bodyControls, onMouseEnter, tailControls]
    );

    const handleMouseLeave = useCallback(
      (e: React.MouseEvent<HTMLDivElement>) => {
        if (!isControlledRef.current) {
          bodyControls.start('normal');
          tailControls.start('normal');
        } else {
          onMouseLeave?.(e);
        }
      },
      [bodyControls, tailControls, onMouseLeave]
    );

    return (
      <div
        className={cn(className)}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        {...props}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width={size}
          height={size}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <motion.path
            variants={BODY_VARIANTS}
            initial="normal"
            animate={bodyControls}
            d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"
          />
          <motion.path
            variants={TAIL_VARIANTS}
            initial="normal"
            animate={tailControls}
            d="M9 18c-4.51 2-5-2-7-2"
          />
        </svg>
      </div>
    );
  }
);

GithubIcon.displayName = 'GithubIcon';

export { GithubIcon };
