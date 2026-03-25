import { HomeIcon } from "@/components/ui/home";
import { HistoryIcon } from "@/components/ui/history-icon";
import { SettingsIcon } from "@/components/ui/settings";
import { ActivityIcon } from "@/components/ui/activity";
import { TerminalIcon } from "@/components/ui/terminal";
import { FileMusicIcon } from "@/components/ui/file-music";
import { FilePenIcon } from "@/components/ui/file-pen";
import { CoffeeIcon } from "@/components/ui/coffee";
import { BadgeAlertIcon } from "@/components/ui/badge-alert";
import { GithubIcon } from "@/components/ui/github";
import { BlocksIcon } from "@/components/ui/blocks-icon";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger, } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { openExternal } from "@/lib/utils";
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
                        <Button variant={currentPage === "debug" ? "secondary" : "ghost"} size="icon" className={`h-10 w-10 ${currentPage === "debug" ? "bg-primary/10 text-primary hover:bg-primary/20" : "hover:bg-primary/10 hover:text-primary"}`} onClick={() => onPageChange("debug")}>
                            <TerminalIcon size={20} loop={true}/>
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent side="right">
                        <p>Debug Logs</p>
                    </TooltipContent>
                </Tooltip>

                <DropdownMenu>
                    <Tooltip delayDuration={0}>
                        <DropdownMenuTrigger asChild>
                            <TooltipTrigger asChild>
                                <Button variant={["audio-analysis", "audio-converter", "file-manager"].includes(currentPage) ? "secondary" : "ghost"} size="icon" className={`h-10 w-10 ${["audio-analysis", "audio-converter", "file-manager"].includes(currentPage) ? "bg-primary/10 text-primary hover:bg-primary/20" : "hover:bg-primary/10 hover:text-primary"}`}>
                                    <BlocksIcon size={20} loop={true}/>
                                </Button>
                            </TooltipTrigger>
                        </DropdownMenuTrigger>
                        <TooltipContent side="right">
                            <p>Tools</p>
                        </TooltipContent>
                    </Tooltip>
                    <DropdownMenuContent side="right" sideOffset={14} className="min-w-[200px] ml-2">
                        <DropdownMenuItem onClick={() => onPageChange("audio-analysis")} className="gap-3 cursor-pointer py-2 px-3">
                            <ActivityIcon size={16}/>
                            <span>Audio Quality Analyzer</span>
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => onPageChange("audio-converter")} className="gap-3 cursor-pointer py-2 px-3">
                            <FileMusicIcon size={16}/>
                            <span>Audio Converter</span>
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => onPageChange("file-manager")} className="gap-3 cursor-pointer py-2 px-3">
                            <FilePenIcon size={16}/>
                            <span>File Manager</span>
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>

            <div className="mt-auto flex flex-col gap-2">
                <Tooltip delayDuration={0}>
                    <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-10 w-10 hover:bg-primary/10 hover:text-primary" onClick={() => openExternal("https://github.com/afkarxyz/SpotiFLAC/issues")}>
                            <GithubIcon size={20}/>
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent side="right">
                        <p>Report Bugs or Request Features</p>
                    </TooltipContent>
                </Tooltip>

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

                <Tooltip delayDuration={0}>
                    <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-10 w-10 hover:bg-primary/10 hover:text-primary" onClick={() => openExternal("https://ko-fi.com/afkarxyz")}>
                            <CoffeeIcon size={20} loop={true}/>
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent side="right">
                        <p>Support me on Ko-fi</p>
                    </TooltipContent>
                </Tooltip>
            </div>
        </div>);
}
