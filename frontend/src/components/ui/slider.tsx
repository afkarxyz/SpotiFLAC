import * as React from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";
import { cn } from "@/lib/utils";
function Slider({ className, defaultValue, value, min = 0, max = 100, ...props }: React.ComponentProps<typeof SliderPrimitive.Root>) {
    const values = Array.isArray(value)
        ? value
        : Array.isArray(defaultValue)
            ? defaultValue
            : [min];
    return (<SliderPrimitive.Root data-slot="slider" defaultValue={defaultValue} value={value} min={min} max={max} className={cn("relative flex w-full touch-none select-none items-center data-[disabled]:opacity-50", className)} {...props}>
            <SliderPrimitive.Track data-slot="slider-track" className="relative h-2 w-full grow overflow-hidden rounded-full bg-muted">
                <SliderPrimitive.Range data-slot="slider-range" className="absolute h-full rounded-full bg-primary"/>
            </SliderPrimitive.Track>
            {values.map((_, index) => (<SliderPrimitive.Thumb key={index} data-slot="slider-thumb" className="block size-4 shrink-0 rounded-full border-2 border-primary bg-background shadow-sm transition-[color,box-shadow] hover:shadow-md focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50"/>))}
        </SliderPrimitive.Root>);
}
export { Slider };
