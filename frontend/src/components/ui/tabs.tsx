import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/utils";
function Tabs({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
    return (<TabsPrimitive.Root data-slot="tabs" className={cn("flex flex-col gap-2", className)} {...props}/>);
}
function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
    return (<TabsPrimitive.List data-slot="tabs-list" className={cn("bg-muted text-muted-foreground inline-flex h-9 w-fit items-center justify-center rounded-lg p-[3px]", className)} {...props}/>);
}
function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
    return (<TabsPrimitive.Trigger data-slot="tabs-trigger" className={cn("inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm flex-1", className)} {...props}/>);
}
function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
    return (<TabsPrimitive.Content data-slot="tabs-content" className={cn("flex-1 outline-none", className)} {...props}/>);
}
export { Tabs, TabsList, TabsTrigger, TabsContent };
