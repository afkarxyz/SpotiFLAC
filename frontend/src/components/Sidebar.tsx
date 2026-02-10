import { HomeIcon } from "@/components/ui/home";
import { HistoryIcon } from "@/components/ui/history-icon";
import { SettingsIcon } from "@/components/ui/settings";
import { ActivityIcon } from "@/components/ui/activity";
import { TerminalIcon } from "@/components/ui/terminal";
import { FileMusicIcon } from "@/components/ui/file-music";
import { FilePenIcon } from "@/components/ui/file-pen";
import { CoffeeIcon } from "@/components/ui/coffee";
import { BadgeAlertIcon } from "@/components/ui/badge-alert";
import { Tooltip, TooltipContent, TooltipTrigger, } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { openExternal } from "@/lib/utils";
import BmcLogo from "@/assets/bmc-logo-side.svg";
import BmcLogoWhite from "@/assets/bmc-logo-side-white.svg";
import KofiLogo from "@/assets/kofi_symbol.svg";
export type PageType = "main" | "settings" | "debug" | "audio-analysis" | "audio-converter" | "file-manager" | "about" | "history";
interface SidebarProps {
    currentPage: PageType;
    onPageChange: (page: PageType) => void;
}
export function Sidebar({ currentPage, onPageChange }: SidebarProps) {
    return (<div className="fixed left-0 top-0 h-full w-14 bg-card border-r border-border flex flex-col items-center py-14 z-30">
    <div className="flex flex-col gap-2 flex-1">

      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>
          <Button variant={currentPage === "main" ? "secondary" : "ghost"} size="icon" className={`h-10 w-10 ${currentPage === "main" ? "bg-primary/10 text-primary hover:bg-primary/20" : "hover:bg-primary/10 hover:text-primary"}`} onClick={() => onPageChange("main")}>
            <HomeIcon size={20}/>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">
          <p>Home</p>
        </TooltipContent>
      </Tooltip>

      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>
          <Button variant={currentPage === "history" ? "secondary" : "ghost"} size="icon" className={`h-10 w-10 ${currentPage === "history" ? "bg-primary/10 text-primary hover:bg-primary/20" : "hover:bg-primary/10 hover:text-primary"}`} onClick={() => onPageChange("history")}>
            <HistoryIcon size={20}/>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">
          <p>History</p>
        </TooltipContent>
      </Tooltip>

      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>
          <Button variant={currentPage === "audio-analysis" ? "secondary" : "ghost"} size="icon" className={`h-10 w-10 ${currentPage === "audio-analysis" ? "bg-primary/10 text-primary hover:bg-primary/20" : "hover:bg-primary/10 hover:text-primary"}`} onClick={() => onPageChange("audio-analysis")}>
            <ActivityIcon size={20}/>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">
          <p>Audio Quality Analyzer</p>
        </TooltipContent>
      </Tooltip>

      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>
          <Button variant={currentPage === "audio-converter" ? "secondary" : "ghost"} size="icon" className={`h-10 w-10 ${currentPage === "audio-converter" ? "bg-primary/10 text-primary hover:bg-primary/20" : "hover:bg-primary/10 hover:text-primary"}`} onClick={() => onPageChange("audio-converter")}>
            <FileMusicIcon size={20}/>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">
          <p>Audio Converter</p>
        </TooltipContent>
      </Tooltip>

      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>
          <Button variant={currentPage === "file-manager" ? "secondary" : "ghost"} size="icon" className={`h-10 w-10 ${currentPage === "file-manager" ? "bg-primary/10 text-primary hover:bg-primary/20" : "hover:bg-primary/10 hover:text-primary"}`} onClick={() => onPageChange("file-manager")}>
            <FilePenIcon size={20}/>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">
          <p>File Manager</p>
        </TooltipContent>
      </Tooltip>

      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>
          <Button variant={currentPage === "debug" ? "secondary" : "ghost"} size="icon" className={`h-10 w-10 ${currentPage === "debug" ? "bg-primary/10 text-primary hover:bg-primary/20" : "hover:bg-primary/10 hover:text-primary"}`} onClick={() => onPageChange("debug")}>
            <TerminalIcon size={20} loop={true}/>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">
          <p>Debug Logs</p>
        </TooltipContent>
      </Tooltip>

      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>
          <Button variant={currentPage === "settings" ? "secondary" : "ghost"} size="icon" className={`h-10 w-10 ${currentPage === "settings" ? "bg-primary/10 text-primary hover:bg-primary/20" : "hover:bg-primary/10 hover:text-primary"}`} onClick={() => onPageChange("settings")}>
            <SettingsIcon size={20}/>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">
          <p>Settings</p>
        </TooltipContent>
      </Tooltip>
    </div>


    <div className="mt-auto flex flex-col gap-2">
      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>
          <Button variant={currentPage === "about" ? "secondary" : "ghost"} size="icon" className={`h-10 w-10 ${currentPage === "about" ? "bg-primary/10 text-primary hover:bg-primary/20" : "hover:bg-primary/10 hover:text-primary"}`} onClick={() => onPageChange("about")}>
            <BadgeAlertIcon size={20}/>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">
          <p>About</p>
        </TooltipContent>
      </Tooltip>
      <div className="relative group">
          <Button variant="ghost" size="icon" className="h-10 w-10 hover:bg-primary/10 hover:text-primary">
            <CoffeeIcon size={20} loop={true}/>
          </Button>

          
          <div className="absolute left-10 bottom-0 w-4 h-full bg-transparent"/>

          <div className="absolute left-10 bottom-0 mb-0 ml-3 hidden group-hover:flex flex-col gap-1 p-1 bg-popover border border-border rounded-md shadow-md z-50 w-max animate-in fade-in zoom-in-95 duration-200 origin-bottom-left">
               <button onClick={() => openExternal("https://ko-fi.com/afkarxyz")} className="flex items-center gap-2 px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground rounded-sm transition-colors text-left w-full">
                  <img src={KofiLogo} className="h-4 w-4" alt="Ko-fi"/>
                  Support me on Ko-fi
               </button>
               <button onClick={() => openExternal("https://buymeacoffee.com/afkarxyz")} className="flex items-center gap-2 px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground rounded-sm transition-colors text-left w-full">
                  <img src={BmcLogo} className="h-4 w-4 dark:hidden" alt="BMC"/>
                  <img src={BmcLogoWhite} className="h-4 w-4 hidden dark:block" alt="BMC"/>
                  Buy Me a Coffee
               </button>
          </div>
      </div>
    </div>
  </div>);
}
