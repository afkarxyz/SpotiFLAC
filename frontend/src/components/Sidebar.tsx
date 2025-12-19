import { Home, Settings, Bug, Activity, FileMusic, FilePen, LayoutGrid, Coffee, Github } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { openExternal } from "@/lib/utils";

export type PageType = "main" | "settings" | "debug" | "audio-analysis" | "audio-converter" | "file-manager";

interface SidebarProps {
  currentPage: PageType;
  onPageChange: (page: PageType) => void;
}

export function Sidebar({ currentPage, onPageChange }: SidebarProps) {
  const navItems = [
    { id: "main" as PageType, icon: Home, label: "Home" },
    { id: "settings" as PageType, icon: Settings, label: "Settings" },
    { id: "audio-analysis" as PageType, icon: Activity, label: "Audio Quality Analyzer" },
    { id: "audio-converter" as PageType, icon: FileMusic, label: "Audio Converter" },
    { id: "file-manager" as PageType, icon: FilePen, label: "File Manager" },
    { id: "debug" as PageType, icon: Bug, label: "Debug Logs" },
  ];

  return (
    <div className="fixed left-0 top-0 h-full w-14 bg-card border-r border-border flex flex-col items-center py-14 z-30">
      <div className="flex flex-col gap-2 flex-1">
        {navItems.map((item) => (
          <Tooltip key={item.id} delayDuration={0}>
            <TooltipTrigger asChild>
              <Button
                variant={currentPage === item.id ? "secondary" : "ghost"}
                size="icon"
                className="h-10 w-10"
                onClick={() => onPageChange(item.id)}
              >
                <item.icon className="h-5 w-5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              <p>{item.label}</p>
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
      
      {/* Bottom icons */}
      <div className="mt-auto flex flex-col gap-2">
        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-10"
              onClick={() => openExternal("https://github.com/afkarxyz/SpotiFLAC/issues")}
            >
              <Github className="h-5 w-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">
            <p>Report Bug</p>
          </TooltipContent>
        </Tooltip>
        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-10"
              onClick={() => openExternal("https://exyezed.cc/")}
            >
              <LayoutGrid className="h-5 w-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">
            <p>Other Projects</p>
          </TooltipContent>
        </Tooltip>
        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-10"
              onClick={() => openExternal("https://ko-fi.com/afkarxyz")}
            >
              <Coffee className="h-5 w-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">
            <p>Support me on Ko-fi</p>
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}