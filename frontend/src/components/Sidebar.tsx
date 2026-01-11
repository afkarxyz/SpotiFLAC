import { HomeIcon } from "@/components/ui/home";
import { SettingsIcon } from "@/components/ui/settings";
import { ActivityIcon } from "@/components/ui/activity";
import { TerminalIcon } from "@/components/ui/terminal";
import { FileMusicIcon } from "@/components/ui/file-music";
import { FilePenIcon } from "@/components/ui/file-pen";
import { GithubIcon } from "@/components/ui/github";
import { BlocksIcon } from "@/components/ui/blocks";
import { CoffeeIcon } from "@/components/ui/coffee";
import { Tooltip, TooltipContent, TooltipTrigger, } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { openExternal } from "@/lib/utils";
export type PageType = "main" | "settings" | "debug" | "audio-analysis" | "audio-converter" | "file-manager";
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
            <Button variant={currentPage === "settings" ? "secondary" : "ghost"} size="icon" className={`h-10 w-10 ${currentPage === "settings" ? "bg-primary/10 text-primary hover:bg-primary/20" : "hover:bg-primary/10 hover:text-primary"}`} onClick={() => onPageChange("settings")}>
              <SettingsIcon size={20}/>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">
            <p>Settings</p>
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
              <TerminalIcon size={20}/>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">
            <p>Debug Logs</p>
          </TooltipContent>
        </Tooltip>
      </div>
      
      
      <div className="mt-auto flex flex-col gap-2">
        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-10 w-10 hover:bg-primary/10 hover:text-primary" onClick={() => openExternal("https://github.com/afkarxyz/SpotiFLAC/issues/new?title=%5BBug%20Report%5D%20/%20%5BFeature%20Request%5D&body=%3C%21--%20WARNING%3A%20Issues%20that%20do%20not%20follow%20this%20template%20will%20be%20closed%20without%20review.%20Fill%20out%20the%20relevant%20section%20and%20delete%20the%20other.%20--%3E%0A%0A%23%23%23%20%5BBug%20Report%5D%0A%0A%23%23%23%23%20Problem%0A%3E%20Type%20here%0A%0A%23%23%23%23%20Type%0ATrack%20/%20Album%20/%20Playlist%20/%20Artist%0A%0A%23%23%23%23%20Spotify%20URL%0A%3E%20Type%20here%0A%0A%23%23%23%23%20Version%0ASpotiFLAC%20v%0A%0A%23%23%23%23%20OS%0AWindows%20/%20Linux%20/%20macOS%0A%0A%23%23%23%23%20Additional%20Context%0A%3E%20Type%20here%20or%20send%20screenshot%0A%0A---%0A%0A%23%23%23%20%5BFeature%20Request%5D%0A%0A%23%23%23%23%20Description%0A%3E%20Type%20here%0A%0A%23%23%23%23%20Use%20Case%0A%3E%20Type%20here%0A%0A%23%23%23%23%20Additional%20Context%0A%3E%20Type%20here%20or%20send%20screenshot")}>
              <GithubIcon size={20}/>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">
            <p>Report Bug or Feature Request</p>
          </TooltipContent>
        </Tooltip>
        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-10 w-10 hover:bg-primary/10 hover:text-primary" onClick={() => openExternal("https://exyezed.cc/")}>
              <BlocksIcon size={20}/>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">
            <p>Other Projects</p>
          </TooltipContent>
        </Tooltip>
        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-10 w-10 hover:bg-primary/10 hover:text-primary" onClick={() => openExternal("https://ko-fi.com/afkarxyz")}>
              <CoffeeIcon size={20}/>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">
            <p>Every coffee helps me keep going</p>
          </TooltipContent>
        </Tooltip>
      </div>
    </div>);
}
