import { useState, useRef, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { FileText, Play, Square, Upload, Trash2 } from "lucide-react";
import { useBatchProcessor, type BatchLog } from "@/hooks/useBatchProcessor";
import { SelectTextFile, ReadTextFile } from "../../wailsjs/go/main/App";
import { toastWithSound as toast } from "@/lib/toast-with-sound";

interface BatchDownloadDialogProps {
    isOpen: boolean;
    onClose: () => void;
    onDownloadTrack: (
        isrc: string,
        name: string,
        artists: string,
        albumName: string,
        spotifyId?: string,
        folderName?: string,
        durationMs?: number,
        position?: number,
        albumArtist?: string,
        releaseDate?: string,
        coverUrl?: string,
        spotifyTrackNumber?: number,
        spotifyDiscNumber?: number,
        spotifyTotalTracks?: number,
        spotifyTotalDiscs?: number,
        copyright?: string,
        publisher?: string
    ) => void;
}

export function BatchDownloadDialog({ isOpen, onClose, onDownloadTrack }: BatchDownloadDialogProps) {
    const [inputMode, setInputMode] = useState<"text" | "file">("text");
    const [textInput, setTextInput] = useState("");
    const [selectedFilePath, setSelectedFilePath] = useState("");
    const [fileContent, setFileContent] = useState("");
    
    const {
        processUrls,
        stopProcessing,
        clearLogs,
        isProcessing,
        progress,
        logs,
        processedCount,
        totalCount
    } = useBatchProcessor();

    const scrollRef = useRef<HTMLDivElement>(null);

    // Auto-scroll logs
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [logs]);

    const handleFileSelect = async () => {
        try {
            const path = await SelectTextFile(); 
            if (path) {
                setSelectedFilePath(path);
                const content = await ReadTextFile(path);
                setFileContent(content);
                toast.success("File loaded successfully");
            }
        } catch (err) {
            toast.error("Failed to load file");
        }
    };

    const handleStart = () => {
        let urls: string[] = [];
        const source = inputMode === "text" ? textInput : fileContent;
        
        if (!source.trim()) {
            toast.error("Input is empty");
            return;
        }

        urls = source
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(line => line.length > 0 && line.includes("spotify.com"));

        if (urls.length === 0) {
            toast.error("No valid Spotify URLs found");
            return;
        }

        processUrls(urls, { onDownloadTrack });
    };

    const handleClose = () => {
        onClose();
    };

    return (
        <Dialog open={isOpen} onOpenChange={handleClose}>
            <DialogContent className="sm:max-w-[600px] max-h-[85vh] flex flex-col p-0 gap-0">
                <DialogHeader className="px-6 pt-6 pb-2">
                    <DialogTitle>Batch Download</DialogTitle>
                    <DialogDescription>
                        Queue multiple tracks, albums, or playlists from a list of URLs.
                    </DialogDescription>
                </DialogHeader>

                <div className="flex-1 overflow-y-auto px-6 py-2">
                    <Tabs value={inputMode} onValueChange={(v) => setInputMode(v as "text" | "file")} className="w-full">
                        <TabsList className="grid w-full grid-cols-2 mb-4">
                            <TabsTrigger value="text" disabled={isProcessing}>Text Input</TabsTrigger>
                            <TabsTrigger value="file" disabled={isProcessing}>From File</TabsTrigger>
                        </TabsList>

                        <TabsContent value="text" className="space-y-4 mt-0">
                            <div className="space-y-2">
                                <Label>Paste URLs (one per line)</Label>
                                <Textarea 
                                    placeholder={`https://open.spotify.com/track/...\nhttps://open.spotify.com/album/...`} 
                                    className="min-h-[200px] font-mono text-xs whitespace-nowrap resize-none"
                                    value={textInput}
                                    onChange={(e) => setTextInput(e.target.value)}
                                    disabled={isProcessing}
                                />
                            </div>
                        </TabsContent>

                        <TabsContent value="file" className="space-y-4 mt-0">
                            <div className="flex flex-col items-center justify-center border-2 border-dashed rounded-lg p-10 space-y-4">
                                <FileText className="h-10 w-10 text-muted-foreground" />
                                <div className="text-center space-y-1">
                                    <p className="text-sm font-medium">Load URLs from a text file</p>
                                    <p className="text-xs text-muted-foreground">Supported format: .txt (one URL per line)</p>
                                </div>
                                <div className="flex gap-2">
                                    <Button onClick={handleFileSelect} variant="secondary" disabled={isProcessing}>
                                        <Upload className="h-4 w-4 mr-2" />
                                        Select File
                                    </Button>
                                </div>
                                {selectedFilePath && (
                                    <div className="flex items-center gap-2 text-xs bg-muted px-3 py-1.5 rounded-md max-w-full">
                                        <span className="truncate max-w-[300px]">{selectedFilePath}</span>
                                    </div>
                                )}
                            </div>
                        </TabsContent>
                    </Tabs>

                    {/* Progress Section */}
                    {(isProcessing || logs.length > 0) && (
                        <div className="mt-6 space-y-3 animate-in fade-in slide-in-from-bottom-4">
                            <div className="flex items-center justify-between text-sm">
                                <span className="font-medium">Processing...</span>
                                <span className="text-muted-foreground">{processedCount} / {totalCount}</span>
                            </div>
                            <Progress value={progress} className="h-2" />
                            
                            <div 
                                ref={scrollRef}
                                className="h-[150px] overflow-y-auto border rounded-md bg-muted/30 p-2 text-xs font-mono space-y-1"
                            >
                                {logs.length === 0 ? (
                                    <span className="text-muted-foreground italic">Waiting to start...</span>
                                ) : (
                                    logs.map((log: BatchLog) => (
                                        <div key={log.id} className="flex gap-2 items-start">
                                            <span className="text-muted-foreground shrink-0">
                                                [{new Date(log.timestamp).toLocaleTimeString([], {hour12: false, hour: '2-digit', minute:'2-digit', second:'2-digit'})}]
                                            </span>
                                            <span className={
                                                log.type === "error" ? "text-red-500" :
                                                log.type === "success" ? "text-green-500" :
                                                log.type === "warning" ? "text-yellow-500" :
                                                "text-foreground"
                                            }>
                                                {log.message}
                                            </span>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    )}
                </div>

                <DialogFooter className="px-6 py-4 border-t mt-2">
                    <div className="flex justify-between w-full">
                        <Button 
                            variant="ghost" 
                            onClick={clearLogs} 
                            disabled={isProcessing || logs.length === 0}
                            className="text-muted-foreground hover:text-destructive"
                        >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Clear Log
                        </Button>
                        <div className="flex gap-2">
                            <Button variant="outline" onClick={handleClose} disabled={isProcessing}>
                                Close
                            </Button>
                            {isProcessing ? (
                                <Button variant="destructive" onClick={stopProcessing}>
                                    <Square className="h-4 w-4 mr-2 fill-current" />
                                    Stop
                                </Button>
                            ) : (
                                <Button onClick={handleStart} disabled={inputMode === "text" ? !textInput.trim() : !fileContent.trim()}>
                                    <Play className="h-4 w-4 mr-2" />
                                    Start Batch
                                </Button>
                            )}
                        </div>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}