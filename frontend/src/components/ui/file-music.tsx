'use client';
import type { Variants } from 'motion/react';
import type { HTMLAttributes } from 'react';
import { forwardRef, useCallback, useImperativeHandle, useRef } from 'react';
import { motion, useAnimation } from 'motion/react';
import { cn } from '@/lib/utils';

export interface FileMusicIconHandle {
    startAnimation: () => void;
    stopAnimation: () => void;
}

interface FileMusicIconProps extends HTMLAttributes<HTMLDivElement> {
    size?: number;
}

const PATH_VARIANTS: Variants = {
    normal: {
        pathLength: 1,
        opacity: 1,
    },
    animate: {
        pathLength: [0, 1],
        opacity: [0, 1],
        transition: {
            duration: 0.6,
            ease: 'easeInOut',
        },
    },
};

const FileMusicIcon = forwardRef<FileMusicIconHandle, FileMusicIconProps>(
    ({ onMouseEnter, onMouseLeave, className, size = 28, ...props }, ref) => {
        const controls = useAnimation();
        const isControlledRef = useRef(false);

        useImperativeHandle(ref, () => {
            isControlledRef.current = true;
            return {
                startAnimation: () => controls.start('animate'),
                stopAnimation: () => controls.start('normal'),
            };
        });

        const handleMouseEnter = useCallback(
            (e: React.MouseEvent<HTMLDivElement>) => {
                if (!isControlledRef.current) {
                    controls.start('animate');
                } else {
                    onMouseEnter?.(e);
                }
            },
            [controls, onMouseEnter]
        );

        const handleMouseLeave = useCallback(
            (e: React.MouseEvent<HTMLDivElement>) => {
                if (!isControlledRef.current) {
                    controls.start('normal');
                } else {
                    onMouseLeave?.(e);
                }
            },
            [controls, onMouseLeave]
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
                        d="M11.65 22H18a2 2 0 0 0 2-2V8a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 14 2H6a2 2 0 0 0-2 2v10.35"
                        variants={PATH_VARIANTS}
                        animate={controls}
                        initial="normal"
                    />
                    <motion.path
                        d="M14 2v5a1 1 0 0 0 1 1h5"
                        variants={PATH_VARIANTS}
                        animate={controls}
                        initial="normal"
                    />
                    <motion.path
                        d="M8 20v-7l3 1.474"
                        variants={PATH_VARIANTS}
                        animate={controls}
                        initial="normal"
                    />
                    <motion.circle
                        cx="6"
                        cy="20"
                        r="2"
                        variants={PATH_VARIANTS}
                        animate={controls}
                        initial="normal"
                    />
                </svg>
            </div>
        );
    }
);

FileMusicIcon.displayName = 'FileMusicIcon';
export { FileMusicIcon };
