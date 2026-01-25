'use client';

import type { Variants } from 'motion/react';
import type { HTMLAttributes } from 'react';
import { forwardRef, useCallback, useImperativeHandle, useRef } from 'react';
import { motion, useAnimation } from 'motion/react';
import { cn } from '@/lib/utils';

export interface LayersIconHandle {
    startAnimation: () => void;
    stopAnimation: () => void;
}

interface LayersIconProps extends HTMLAttributes<HTMLDivElement> {
    size?: number;
}

const PATH_VARIANTS: Variants = {
    normal: {
        y: 0,
        opacity: 1,
    },
    animate: (custom: number) => ({
        y: -2,
        opacity: [1, 0.5, 1],
        transition: {
            duration: 0.6,
            ease: 'easeInOut',
            delay: 0.1 * custom,
            repeat: 1,
            repeatType: "reverse"
        },
    }),
};

const LayersIcon = forwardRef<LayersIconHandle, LayersIconProps>(({ onMouseEnter, onMouseLeave, className, size = 28, ...props }, ref) => {
    const controls = useAnimation();
    const isControlledRef = useRef(false);

    useImperativeHandle(ref, () => {
        isControlledRef.current = true;
        return {
            startAnimation: () => controls.start('animate'),
            stopAnimation: () => controls.start('normal'),
        };
    });

    const handleMouseEnter = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        if (!isControlledRef.current) {
            controls.start('animate');
        } else {
            onMouseEnter?.(e);
        }
    }, [controls, onMouseEnter]);

    const handleMouseLeave = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        if (!isControlledRef.current) {
            controls.start('normal');
        } else {
            onMouseLeave?.(e);
        }
    }, [controls, onMouseLeave]);

    return (
        <div className={cn(className)} onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave} {...props}>
            <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <motion.path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z" variants={PATH_VARIANTS} custom={0} animate={controls} />
                <motion.path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65" variants={PATH_VARIANTS} custom={1} animate={controls} />
                <motion.path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65" variants={PATH_VARIANTS} custom={2} animate={controls} />
            </svg>
        </div>
    );
});

LayersIcon.displayName = 'LayersIcon';

export { LayersIcon };