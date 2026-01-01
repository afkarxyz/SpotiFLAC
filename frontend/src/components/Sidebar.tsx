import { FileMusic, FilePen, FileSpreadsheet } from "lucide-react";
import { HomeIcon } from "@/components/ui/home";
import { SettingsIcon } from "@/components/ui/settings";
import { ActivityIcon } from "@/components/ui/activity";
import { TerminalIcon } from "@/components/ui/terminal";
import { GithubIcon } from "@/components/ui/github";
import { BlocksIcon } from "@/components/ui/blocks";
import { CoffeeIcon } from "@/components/ui/coffee";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { openExternal } from "@/lib/utils";

export type PageType = "main" | "settings" | "debug" | "audio-analysis" | "audio-converter" | "file-manager" | "csv-import";

interface SidebarProps {
  currentPage: PageType;
  onPageChange: (page: PageType) => void;
}

export function Sidebar({ currentPage, onPageChange }: SidebarProps) {
  return (
    <div className="fixed left-0 top-0 h-full w-14 bg-card border-r border-border flex flex-col items-center py-14 z-30">
      <div className="flex flex-col gap-2 flex-1">
        {/* Home */}
        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>
            <Button
              variant={currentPage === "main" ? "secondary" : "ghost"}
              size="icon"
              className="h-10 w-10"
              onClick={() => onPageChange("main")}
            >
              <HomeIcon size={20} />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">
            <p>Home</p>
          </TooltipContent>
        </Tooltip>

        {/* Settings */}
        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>
            <Button
              variant={currentPage === "settings" ? "secondary" : "ghost"}
              size="icon"
              className="h-10 w-10"
              onClick={() => onPageChange("settings")}
            >
              <SettingsIcon size={20} />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">
            <p>Settings</p>
          </TooltipContent>
        </Tooltip>

        {/* Audio Analysis */}
        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>
            <Button
              variant={currentPage === "audio-analysis" ? "secondary" : "ghost"}
              size="icon"
              className="h-10 w-10"
              onClick={() => onPageChange("audio-analysis")}
            >
              <ActivityIcon size={20} />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">
            <p>Audio Quality Analyzer</p>
          </TooltipContent>
        </Tooltip>

        {/* Audio Converter - using lucide icon (no animated version) */}
        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>
            <Button
              variant={currentPage === "audio-converter" ? "secondary" : "ghost"}
              size="icon"
              className="h-10 w-10"
              onClick={() => onPageChange("audio-converter")}
            >
              <FileMusic className="h-5 w-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">
            <p>Audio Converter</p>
          </TooltipContent>
        </Tooltip>

        {/* File Manager - using lucide icon (no animated version) */}
        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>
            <Button
              variant={currentPage === "file-manager" ? "secondary" : "ghost"}
              size="icon"
              className="h-10 w-10"
              onClick={() => onPageChange("file-manager")}
            >
              <FilePen className="h-5 w-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">
            <p>File Manager</p>
          </TooltipContent>
        </Tooltip>

        {/* CSV Import */}
        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>
            <Button
              variant={currentPage === "csv-import" ? "secondary" : "ghost"}
              size="icon"
              className="h-10 w-10"
              onClick={() => onPageChange("csv-import")}
            >
              <FileSpreadsheet className="h-5 w-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">
            <p>CSV Playlist Import</p>
          </TooltipContent>
        </Tooltip>

        {/* Debug */}
        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>
            <Button
              variant={currentPage === "debug" ? "secondary" : "ghost"}
              size="icon"
              className="h-10 w-10"
              onClick={() => onPageChange("debug")}
            >
              <TerminalIcon size={20} />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">
            <p>Debug Logs</p>
          </TooltipContent>
        </Tooltip>
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
              <GithubIcon size={20} />
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
              <BlocksIcon size={20} />
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
              <CoffeeIcon size={20} />
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
