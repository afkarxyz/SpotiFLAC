import { useState, useEffect } from "react";
import type { DragEvent } from "react";
import { UploadImageBytes, UploadImage, SelectImageVideo } from "../../wailsjs/go/main/App";
import { Upload, Loader2, ImagePlus, X, Check, FileVideo, ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
interface UploadedFile {
    id: string;
    name: string;
    url: string;
    type: 'image' | 'video' | 'unknown';
    status: 'uploading' | 'done' | 'error';
    error?: string;
}
interface DragDropMediaProps {
    value: string;
    onChange: (value: string) => void;
    className?: string;
}
export function DragDropMedia({ value, onChange, className }: DragDropMediaProps) {
    const [isDragging, setIsDragging] = useState(false);
    const [files, setFiles] = useState<UploadedFile[]>(() => {
        if (!value)
            return [];
        return value.split('\n').filter(line => line.trim()).map((line, i) => {
            const match = line.match(/!\[(.*?)\]\((.*?)\)/);
            if (match) {
                return {
                    id: `init-${i}-${Date.now()}`,
                    name: match[1] === 'image' || match[1] === 'video' ? `file-${i}` : match[1],
                    url: match[2] || line,
                    type: (match[2] && match[2].match(/\.(mp4|mkv|webm|mov)$/i)) ? 'video' : 'image',
                    status: 'done'
                };
            }
            return {
                id: `init-${i}-${Date.now()}`,
                name: 'unknown',
                url: line,
                type: 'image',
                status: 'done'
            };
        });
    });
    useEffect(() => {
        const newValue = files
            .filter(f => f.status === 'done' && f.url)
            .map(f => f.url)
            .join('\n');
        if (newValue !== value) {
            onChange(newValue);
        }
    }, [files]);
    const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(true);
    };
    const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
    };
    const handleDrop = async (e: DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            await handleFiles(Array.from(e.dataTransfer.files));
        }
    };
    const handleFiles = async (fileList: File[]) => {
        const timestamp = Date.now();
        const newFiles: UploadedFile[] = fileList.map((f, i) => ({
            id: `drop-${timestamp}-${i}`,
            name: f.name,
            url: '',
            type: f.type.startsWith('video') ? 'video' : 'image',
            status: 'uploading'
        }));
        setFiles(prev => [...prev, ...newFiles]);
        for (let i = 0; i < fileList.length; i++) {
            const file = fileList[i];
            const fileId = newFiles[i].id;
            try {
                const base64 = await fileToBase64(file);
                const result = await UploadImageBytes(file.name, base64);
                setFiles(prev => prev.map(f => f.id === fileId
                    ? { ...f, status: 'done', url: result }
                    : f));
            }
            catch (err: any) {
                console.error("Upload failed", err);
                setFiles(prev => prev.map(f => f.id === fileId
                    ? { ...f, status: 'error', error: err.message || "Upload failed" }
                    : f));
            }
        }
    };
    const handleSelectFile = async () => {
        try {
            const paths = await SelectImageVideo();
            if (paths && paths.length > 0) {
                const timestamp = Date.now();
                const newFiles: UploadedFile[] = paths.map((p, i) => ({
                    id: `select-${timestamp}-${i}`,
                    name: p.split(/[\\/]/).pop() || 'unknown',
                    url: '',
                    type: p.match(/\.(mp4|mkv|webm|mov)$/i) ? 'video' : 'image',
                    status: 'uploading'
                }));
                setFiles(prev => [...prev, ...newFiles]);
                for (let i = 0; i < paths.length; i++) {
                    const path = paths[i];
                    const fileId = newFiles[i].id;
                    try {
                        const result = await UploadImage(path);
                        setFiles(prev => prev.map(f => f.id === fileId
                            ? { ...f, status: 'done', url: result }
                            : f));
                    }
                    catch (err: any) {
                        setFiles(prev => prev.map(f => f.id === fileId
                            ? { ...f, status: 'error', error: err.message }
                            : f));
                    }
                }
            }
        }
        catch (err: any) {
            console.error("Select file failed", err);
        }
    };
    const removeFile = (index: number) => {
        setFiles(prev => prev.filter((_, i) => i !== index));
    };
    return (<div className={cn("relative group flex flex-col gap-2 p-4 border-2 border-dashed rounded-lg transition-colors border-muted-foreground/25 hover:border-primary/50 min-h-[14rem]", isDragging ? "border-primary bg-primary/10" : "bg-muted/5", className)} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop} onClick={(e) => {
            if (e.target === e.currentTarget)
                handleSelectFile();
        }}>
            {files.length === 0 && (<div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none opacity-50">
                    <ImagePlus className="h-10 w-10 mb-2"/>
                    <span className="text-sm font-medium">Drop media here or click to browse</span>
                    <span className="text-xs text-muted-foreground mt-1">Supports PNG, JPG, MP4, MOV</span>
                </div>)}

            <div className="flex flex-col gap-2 z-10 w-full">
                {files.map((file, i) => (<div key={i} className="flex items-center gap-3 p-2 rounded-md bg-background/80 backdrop-blur-sm border shadow-sm animate-in fade-in slide-in-from-bottom-2">
                        {file.type === 'video' ? <FileVideo className="h-8 w-8 text-primary"/> : <ImageIcon className="h-8 w-8 text-primary"/>}
                        
                        <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium truncate">{file.name}</div>
                            <div className="text-xs text-muted-foreground flex items-center gap-1">
                                {file.status === 'uploading' && <span className="text-yellow-500 flex items-center"><Loader2 className="h-3 w-3 animate-spin mr-1"/> Uploading...</span>}
                                {file.status === 'done' && <span className="text-green-500 flex items-center"><Check className="h-3 w-3 mr-1"/> Ready</span>}
                                {file.status === 'error' && <span className="text-red-500">{file.error || 'Failed'}</span>}
                            </div>
                        </div>

                        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={(e) => { e.stopPropagation(); removeFile(i); }}>
                            <X className="h-4 w-4"/>
                        </Button>
                    </div>))}
            </div>

            
            {isDragging && (<div className="absolute inset-0 flex items-center justify-center bg-background/50 rounded-lg pointer-events-none z-20">
                    <div className="flex flex-col items-center text-primary font-medium">
                        <Upload className="h-10 w-10 mb-2 animate-bounce"/>
                        <span>Drop files to add</span>
                    </div>
                </div>)}
        </div>);
}
const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = (error) => reject(error);
    });
};
