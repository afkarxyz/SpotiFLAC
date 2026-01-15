"use client";
import type { Variants } from "motion/react";
import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";
import { cn } from "@/lib/utils";
export interface BadgeAlertIconHandle {
    startAnimation: () => void;
    stopAnimation: () => void;
}
interface BadgeAlertIconProps extends HTMLAttributes<HTMLDivElement> {
    size?: number;
}
const ICON_VARIANTS: Variants = {
    normal: { scale: 1, rotate: 0 },
    animate: {
        scale: [1, 1.1, 1.1, 1.1, 1],
        rotate: [0, -3, 3, -2, 2, 0],
        transition: {
            duration: 0.5,
            times: [0, 0.2, 0.4, 0.6, 1],
            ease: "easeInOut",
        },
    },
};
const BadgeAlertIcon = forwardRef<BadgeAlertIconHandle, BadgeAlertIconProps>(({ onMouseEnter, onMouseLeave, className, size = 28, ...props }, ref) => {
    const controls = useAnimation();
    const isControlledRef = useRef(false);
    useImperativeHandle(ref, () => {
        isControlledRef.current = true;
        return {
            startAnimation: () => controls.start("animate"),
            stopAnimation: () => controls.start("normal"),
        };
    });
    const handleMouseEnter = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        if (isControlledRef.current) {
            onMouseEnter?.(e);
        }
        else {
            controls.start("animate");
        }
    }, [controls, onMouseEnter]);
    const handleMouseLeave = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        if (isControlledRef.current) {
            onMouseLeave?.(e);
        }
        else {
            controls.start("normal");
        }
    }, [controls, onMouseLeave]);
    return (<div className={cn(className)} onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave} {...props}>
                <motion.svg animate={controls} fill="none" height={size} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" variants={ICON_VARIANTS} viewBox="0 0 24 24" width={size} xmlns="http://www.w3.org/2000/svg">
                    <path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z"/>
                    <line x1="12" x2="12" y1="8" y2="12"/>
                    <line x1="12" x2="12.01" y1="16" y2="16"/>
                </motion.svg>
            </div>);
});
BadgeAlertIcon.displayName = "BadgeAlertIcon";
export { BadgeAlertIcon };
