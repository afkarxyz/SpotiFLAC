import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { openExternal } from "@/lib/utils";
import { GetOSInfo } from "../../wailsjs/go/main/App";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Bug, Lightbulb, ExternalLink, Star, GitFork, Clock, Download, CircleHelp, Blocks, Heart } from "lucide-react";
import AudioTTSProIcon from "@/assets/audiotts-pro.webp";
import ChatGPTTTSIcon from "@/assets/chatgpt-tts.webp";
import XProIcon from "@/assets/x-pro.webp";
import SpotubeDLIcon from "@/assets/icons/spotubedl.svg";
import SpotiDownloaderIcon from "@/assets/icons/spotidownloader.svg";
import XBatchDLIcon from "@/assets/icons/xbatchdl.svg";
import SpotiFLACNextIcon from "@/assets/icons/next.svg";
import BmcLogo from "@/assets/bmc-logo.svg";
import KofiLogo from "@/assets/kofi_symbol.svg";
import { langColors } from "@/assets/github-lang-colors";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DragDropMedia } from "./DragDropTextarea";
interface AboutPageProps {
    version: string;
}
export function AboutPage({ version }: AboutPageProps) {
    const [os, setOs] = useState("Unknown");
    const [location, setLocation] = useState("Unknown");
    const [activeTab, setActiveTab] = useState<"bug_report" | "feature_request" | "faq" | "projects" | "support">("bug_report");
    const [bugType, setBugType] = useState("Track");
    const [problem, setProblem] = useState("");
    const [spotifyUrl, setSpotifyUrl] = useState("");
    const [bugContext, setBugContext] = useState("");
    const [featureDesc, setFeatureDesc] = useState("");
    const [useCase, setUseCase] = useState("");
    const [featureContext, setFeatureContext] = useState("");
    const [repoStats, setRepoStats] = useState<Record<string, any>>({});
    useEffect(() => {
        const fetchOS = async () => {
            try {
                const info = await GetOSInfo();
                setOs(info);
            }
            catch (err) {
                const userAgent = window.navigator.userAgent;
                if (userAgent.indexOf("Win") !== -1)
                    setOs("Windows");
                else if (userAgent.indexOf("Mac") !== -1)
                    setOs("macOS");
                else if (userAgent.indexOf("Linux") !== -1)
                    setOs("Linux");
            }
        };
        fetchOS();
        const fetchLocation = async () => {
            try {
                const response = await fetch('https://ipapi.co/json/');
                if (response.ok) {
                    const data = await response.json();
                    const city = data.city || '';
                    const region = data.region || '';
                    const country = data.country_name || '';
                    const parts = [city, region, country].filter(Boolean);
                    setLocation(parts.join(', ') || 'Unknown');
                }
                else {
                    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
                    setLocation(timezone);
                }
            }
            catch (err) {
                const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
                setLocation(timezone);
            }
        };
        fetchLocation();
        const fetchRepoStats = async () => {
            const CACHE_KEY = 'github_repo_stats';
            const CACHE_DURATION = 1000 * 60 * 60;
            const cached = localStorage.getItem(CACHE_KEY);
            if (cached) {
                try {
                    const { data, timestamp } = JSON.parse(cached);
                    if (Date.now() - timestamp < CACHE_DURATION) {
                        setRepoStats(data);
                        return;
                    }
                }
                catch (err) {
                    console.error('Failed to parse cache:', err);
                }
            }
            const repos = [
                { name: 'SpotiDownloader', owner: 'afkarxyz' },
                { name: 'SpotiFLAC-Next', owner: 'spotiverse' },
                { name: 'Twitter-X-Media-Batch-Downloader', owner: 'afkarxyz' }
            ];
            const stats: Record<string, any> = {};
            for (const repo of repos) {
                try {
                    const [repoRes, releasesRes, langsRes] = await Promise.all([
                        fetch(`https://api.github.com/repos/${repo.owner}/${repo.name}`),
                        fetch(`https://api.github.com/repos/${repo.owner}/${repo.name}/releases`),
                        fetch(`https://api.github.com/repos/${repo.owner}/${repo.name}/languages`)
                    ]);
                    if (repoRes.status === 403) {
                        if (cached) {
                            const { data } = JSON.parse(cached);
                            setRepoStats(data);
                        }
                        return;
                    }
                    if (repoRes.ok && releasesRes.ok && langsRes.ok) {
                        const repoData = await repoRes.json();
                        const releases = await releasesRes.json();
                        const languages = await langsRes.json();
                        let totalDownloads = 0;
                        let latestDownloads = 0;
                        if (releases.length > 0) {
                            latestDownloads = releases[0].assets?.reduce((sum: number, asset: any) => sum + (asset.download_count || 0), 0) || 0;
                            totalDownloads = releases.reduce((sum: number, release: any) => {
                                return sum + (release.assets?.reduce((s: number, a: any) => s + (a.download_count || 0), 0) || 0);
                            }, 0);
                        }
                        const topLangs = Object.entries(languages)
                            .sort(([, a]: any, [, b]: any) => b - a)
                            .slice(0, 4)
                            .map(([lang]) => lang);
                        stats[repo.name] = {
                            stars: repoData.stargazers_count,
                            forks: repoData.forks_count,
                            createdAt: repoData.created_at,
                            totalDownloads,
                            latestDownloads,
                            languages: topLangs
                        };
                    }
                }
                catch (err) {
                    console.error(`Failed to fetch stats for ${repo.name}:`, err);
                    if (cached) {
                        const { data } = JSON.parse(cached);
                        setRepoStats(data);
                        return;
                    }
                }
            }
            setRepoStats(stats);
            localStorage.setItem(CACHE_KEY, JSON.stringify({ data: stats, timestamp: Date.now() }));
        };
        fetchRepoStats();
    }, []);
    const faqs = [
        {
            q: "Is this software free?",
            a: "Yes. This software is completely free. You do not need an account, login, or subscription. All you need is an internet connection."
        },
        {
            q: "Can using this software get my Spotify account suspended or banned?",
            a: "No. This software has no connection to your Spotify account. Spotify data is obtained through reverse engineering of the Spotify Web Player, not through user authentication."
        },
        {
            q: "Where does the audio come from?",
            a: "The audio is fetched using third-party APIs."
        },
        {
            q: "Why does metadata fetching sometimes fail?",
            a: "This usually happens because your IP address has been rate-limited. You can wait and try again later, or use a VPN to bypass the rate limit."
        },
        {
            q: "Why does Windows Defender or antivirus flag or delete the file?",
            a: "This is a false positive. It likely happens because the executable is compressed using UPX. If you are concerned, you can fork the repository and build the software yourself from source."
        }
    ];
    const formatTimeAgo = (dateString: string): string => {
        const now = new Date();
        const updated = new Date(dateString);
        const diffMs = now.getTime() - updated.getTime();
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        const diffMonths = Math.floor(diffDays / 30);
        if (diffDays === 0)
            return 'today';
        if (diffDays === 1)
            return '1d';
        if (diffDays < 30)
            return `${diffDays}d`;
        if (diffMonths === 1)
            return '1mo';
        if (diffMonths < 12)
            return `${diffMonths}mo`;
        const diffYears = Math.floor(diffMonths / 12);
        return `${diffYears}y`;
    };
    const formatNumber = (num: number): string => {
        if (num >= 1000) {
            return num.toLocaleString();
        }
        return num.toString();
    };
    const getLangColor = (lang: string): string => {
        return langColors[lang] || '#858585';
    };
    const handleSubmit = () => {
        const title = activeTab === "bug_report"
            ? `[Bug Report] ${problem.substring(0, 50)}${problem.length > 50 ? "..." : ""}`
            : `[Feature Request] ${featureDesc.substring(0, 50)}${featureDesc.length > 50 ? "..." : ""}`;
        let bodyContent = "";
        if (activeTab === "bug_report") {
            const contextContent = bugContext.trim() ? bugContext.trim() : "Type here or send screenshot/recording";
            bodyContent = `### [Bug Report]

#### Problem
${problem || "Type here"}

#### Type
${bugType}

#### Spotify URL
${spotifyUrl || "Type here"}

#### Additional Context
${contextContent}

#### Environment
- SpotiFLAC Version: ${version}
- OS: ${os}
- Location: ${location}`;
        }
        else {
            const contextContent = featureContext.trim() ? featureContext.trim() : "Type here or send screenshot/recording";
            bodyContent = `### [Feature Request]

#### Description
${featureDesc || "Type here"}

#### Use Case
${useCase || "Type here"}

#### Additional Context
${contextContent}`;
        }
        const params = new URLSearchParams({
            title: title,
            body: bodyContent
        });
        const url = `https://github.com/afkarxyz/SpotiFLAC/issues/new?${params.toString()}`;
        openExternal(url);
    };
    return (<div className={`flex flex-col space-y-4 ${activeTab === "faq" ? "h-[calc(100vh-10rem)]" : ""}`}>
        <div className="flex items-center justify-between shrink-0">
            <h2 className="text-2xl font-bold tracking-tight">About</h2>
        </div>

        <div className="flex gap-2 border-b shrink-0">
            <Button variant={activeTab === "bug_report" ? "default" : "ghost"} size="sm" onClick={() => setActiveTab("bug_report")} className="rounded-b-none">
                <Bug className="h-4 w-4"/>
                Bug Report
            </Button>
            <Button variant={activeTab === "feature_request" ? "default" : "ghost"} size="sm" onClick={() => setActiveTab("feature_request")} className="rounded-b-none">
                <Lightbulb className="h-4 w-4"/>
                Feature Request
            </Button>
            <Button variant={activeTab === "faq" ? "default" : "ghost"} size="sm" onClick={() => setActiveTab("faq")} className="rounded-b-none">
                <CircleHelp className="h-4 w-4"/>
                FAQ
            </Button>
            <Button variant={activeTab === "projects" ? "default" : "ghost"} size="sm" onClick={() => setActiveTab("projects")} className="rounded-b-none">
                <Blocks className="h-4 w-4"/>
                Other Projects
            </Button>
            <Button variant={activeTab === "support" ? "default" : "ghost"} size="sm" onClick={() => setActiveTab("support")} className="rounded-b-none">
                <Heart className="h-4 w-4"/>
                Support Us
            </Button>
        </div>

        <div className={`flex-1 min-h-0 ${activeTab === "faq" ? "overflow-hidden" : ""}`}>
            {activeTab === "bug_report" && (<div className="flex flex-col">
                    <div className="space-y-4 pt-4 flex flex-col">
                        <div className="mt-4 pr-2">
                           <div className="grid md:grid-cols-3 gap-6">
                                    <div className="space-y-2 flex flex-col">
                                        <Label>Problem</Label>
                                        <Textarea className="h-56 resize-none" placeholder="Describe the problem..." value={problem} onChange={e => setProblem(e.target.value)}/>
                                    </div>
                                    <div className="space-y-2 flex flex-col">
                                        <Label>Additional Context</Label>
                                        <DragDropMedia className="min-h-[14rem]" value={bugContext} onChange={setBugContext}/>
                                    </div>
                                    <div className="space-y-4 flex flex-col">
                                        <div className="space-y-2">
                                            <Label>Type</Label>
                                            <ToggleGroup type="single" value={bugType} onValueChange={(val) => {
                if (val)
                    setBugType(val);
            }} className="justify-start w-full cursor-pointer">
                                                <ToggleGroupItem value="Track" className="flex-1 cursor-pointer" aria-label="Toggle track">Track</ToggleGroupItem>
                                                <ToggleGroupItem value="Album" className="flex-1 cursor-pointer" aria-label="Toggle album">Album</ToggleGroupItem>
                                                <ToggleGroupItem value="Playlist" className="flex-1 cursor-pointer" aria-label="Toggle playlist">Playlist</ToggleGroupItem>
                                                <ToggleGroupItem value="Artist" className="flex-1 cursor-pointer" aria-label="Toggle artist">Artist</ToggleGroupItem>
                                            </ToggleGroup>
                                        </div>
                                        <div className="space-y-2">
                                            <Label>Spotify URL</Label>
                                            <Input placeholder="https://open.spotify.com/..." value={spotifyUrl} onChange={e => setSpotifyUrl(e.target.value)}/>
                                        </div>
                                    </div>
                                </div>
                            </div>
                    </div>
                    <div className="flex justify-center pt-4 shrink-0">
                        <Button className="w-[200px] cursor-pointer gap-2" onClick={handleSubmit}>
                            <ExternalLink className="h-4 w-4"/> Create Issue on GitHub
                        </Button>
                    </div>
                </div>)}

            {activeTab === "feature_request" && (<div className="flex flex-col">
                    <div className="space-y-4 pt-4 flex flex-col">
                        <div className="mt-4 pr-2">
                            <div className="grid md:grid-cols-3 gap-6">
                                    <div className="space-y-2 flex flex-col">
                                        <Label>Description</Label>
                                        <Textarea className="h-56 resize-none" placeholder="Describe your feature request..." value={featureDesc} onChange={e => setFeatureDesc(e.target.value)}/>
                                    </div>
                                    <div className="space-y-2 flex-col">
                                        <Label>Use Case</Label>
                                        <Textarea className="h-56 resize-none" placeholder="How would this feature be useful?" value={useCase} onChange={e => setUseCase(e.target.value)}/>
                                    </div>
                                    <div className="space-y-2 flex-col">
                                        <Label>Additional Context</Label>
                                        <DragDropMedia className="min-h-[14rem]" value={featureContext} onChange={setFeatureContext}/>
                                    </div>
                                </div>
                            </div>
                    </div>
                    <div className="flex justify-center pt-4 shrink-0">
                        <Button className="w-[200px] cursor-pointer gap-2" onClick={handleSubmit}>
                            <ExternalLink className="h-4 w-4"/> Create Issue on GitHub
                        </Button>
                    </div>
                </div>)}

            {activeTab === "faq" && (<ScrollArea className="h-full">
                     <div className="p-1 pr-4">
                        <Card>
                            <CardHeader>
                                <CardTitle>Frequently Asked Questions</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-6">
                                {faqs.map((faq, index) => (<div key={index} className="space-y-2">
                                    <h3 className="font-medium text-base text-foreground/90">{faq.q}</h3>
                                    <p className="text-sm text-muted-foreground leading-relaxed">{faq.a}</p>
                                </div>))}
                            </CardContent>
                        </Card>
                    </div>
                </ScrollArea>)}

            {activeTab === "projects" && (<div className="p-1 pr-2">
                    <div className="grid gap-2 grid-cols-4">
                            <div className="flex flex-col gap-2 h-full">
                                <Card className="hover:bg-muted/50 hover:border-primary/50 transition-colors cursor-pointer flex-1" onClick={() => openExternal("https://exyezed.cc/")}>
                                    <CardHeader>
                                        <CardTitle>Browser Extensions & Scripts</CardTitle>
                                        <CardDescription className="flex gap-3 pt-2">
                                            <img src={AudioTTSProIcon} className="h-8 w-8 rounded-md shadow-sm" alt="AudioTTS Pro"/>
                                            <img src={ChatGPTTTSIcon} className="h-8 w-8 rounded-md shadow-sm" alt="ChatGPT TTS"/>
                                            <img src={XProIcon} className="h-8 w-8 rounded-md shadow-sm" alt="X Pro"/>
                                        </CardDescription>
                                    </CardHeader>
                                </Card>
                                <Card className="hover:bg-muted/50 hover:border-primary/50 transition-colors cursor-pointer flex-1" onClick={() => openExternal("https://spotubedl.com/")}>
                                    <CardHeader>
                                        <CardTitle className="flex items-center gap-2"><img src={SpotubeDLIcon} className="h-5 w-5" alt="SpotubeDL"/> SpotubeDL</CardTitle>
                                        <CardDescription>Download Spotify Tracks, Albums, Playlists as MP3/OGG/Opus with High Quality.</CardDescription>
                                    </CardHeader>
                                </Card>
                            </div>
                            <Card className="hover:bg-muted/50 hover:border-primary/50 transition-colors cursor-pointer" onClick={() => openExternal("https://github.com/afkarxyz/SpotiDownloader")}>
                                <CardHeader>
                                    <CardTitle className="flex items-center gap-2"><img src={SpotiDownloaderIcon} className="h-5 w-5" alt="SpotiDownloader"/> SpotiDownloader</CardTitle>
                                    <CardDescription>Get Spotify tracks in MP3 and FLAC via spotidownloader.com</CardDescription>
                                </CardHeader>
                                {repoStats['SpotiDownloader'] && (<CardContent className="space-y-3">
                                    <div className="flex flex-wrap gap-2 text-xs">
                                        {repoStats['SpotiDownloader'].languages?.map((lang: string) => (<span key={lang} className="px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: getLangColor(lang) + '20', color: getLangColor(lang) }}>{lang}</span>))}
                                    </div>
                                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                                        <span className="flex items-center gap-1"><Star className="h-3.5 w-3.5 fill-amber-500 text-amber-500"/> {formatNumber(repoStats['SpotiDownloader'].stars)}</span>
                                        <span className="flex items-center gap-1"><GitFork className="h-3.5 w-3.5"/> {repoStats['SpotiDownloader'].forks}</span>
                                        <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5"/> {formatTimeAgo(repoStats['SpotiDownloader'].createdAt)}</span>
                                    </div>
                                    <div className="flex flex-col gap-1 text-xs text-muted-foreground items-start">
                                        <span className="flex items-center gap-1"><Download className="h-3.5 w-3.5"/> TOTAL: {formatNumber(repoStats['SpotiDownloader'].totalDownloads)}</span>
                                        <span className="flex items-center gap-1 text-green-600 dark:text-green-400"><Download className="h-3.5 w-3.5"/> LATEST: {formatNumber(repoStats['SpotiDownloader'].latestDownloads)}</span>
                                    </div>
                                </CardContent>)}
                            </Card>
                            <Card className="hover:bg-muted/50 hover:border-primary/50 transition-colors cursor-pointer" onClick={() => openExternal("https://github.com/spotiverse/SpotiFLAC-Next")}>
                                <CardHeader>
                                    <CardTitle className="flex items-center gap-2"><img src={SpotiFLACNextIcon} className="h-5 w-5" alt="SpotiFLAC Next"/> SpotiFLAC Next</CardTitle>
                                    <CardDescription>Get Spotify tracks in Hi-Res lossless FLACs — no account required.</CardDescription>
                                </CardHeader>
                                {repoStats['SpotiFLAC-Next'] && (<CardContent className="space-y-3">
                                    <div className="flex flex-wrap gap-2 text-xs">
                                        {repoStats['SpotiFLAC-Next'].languages?.map((lang: string) => (<span key={lang} className="px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: getLangColor(lang) + '20', color: getLangColor(lang) }}>{lang}</span>))}
                                    </div>
                                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                                        <span className="flex items-center gap-1"><Star className="h-3.5 w-3.5 fill-amber-500 text-amber-500"/> {formatNumber(repoStats['SpotiFLAC-Next'].stars)}</span>
                                        <span className="flex items-center gap-1"><GitFork className="h-3.5 w-3.5"/> {repoStats['SpotiFLAC-Next'].forks}</span>
                                        <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5"/> {formatTimeAgo(repoStats['SpotiFLAC-Next'].createdAt)}</span>
                                    </div>
                                    <div className="flex flex-col gap-1 text-xs text-muted-foreground items-start">
                                        <span className="flex items-center gap-1"><Download className="h-3.5 w-3.5"/> TOTAL: {formatNumber(repoStats['SpotiFLAC-Next'].totalDownloads)}</span>
                                        <span className="flex items-center gap-1 text-green-600 dark:text-green-400"><Download className="h-3.5 w-3.5"/> LATEST: {formatNumber(repoStats['SpotiFLAC-Next'].latestDownloads)}</span>
                                    </div>
                                </CardContent>)}
                            </Card>
                            <Card className="hover:bg-muted/50 hover:border-primary/50 transition-colors cursor-pointer" onClick={() => openExternal("https://github.com/afkarxyz/Twitter-X-Media-Batch-Downloader")}>
                                <CardHeader>
                                    <CardTitle className="flex items-center gap-2"><img src={XBatchDLIcon} className="h-5 w-5" alt="Twitter/X Media Batch Downloader"/> Twitter/X Media Batch Downloader</CardTitle>
                                    <CardDescription>A GUI tool to download original-quality images and videos from Twitter/X accounts, powered by gallery-dl by @mikf</CardDescription>
                                </CardHeader>
                                {repoStats['Twitter-X-Media-Batch-Downloader'] && (<CardContent className="space-y-3">
                                    <div className="flex flex-wrap gap-2 text-xs">
                                        {repoStats['Twitter-X-Media-Batch-Downloader'].languages?.map((lang: string) => (<span key={lang} className="px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: getLangColor(lang) + '20', color: getLangColor(lang) }}>{lang}</span>))}
                                    </div>
                                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                                        <span className="flex items-center gap-1"><Star className="h-3.5 w-3.5 fill-amber-500 text-amber-500"/> {formatNumber(repoStats['Twitter-X-Media-Batch-Downloader'].stars)}</span>
                                        <span className="flex items-center gap-1"><GitFork className="h-3.5 w-3.5"/> {repoStats['Twitter-X-Media-Batch-Downloader'].forks}</span>
                                        <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5"/> {formatTimeAgo(repoStats['Twitter-X-Media-Batch-Downloader'].createdAt)}</span>
                                    </div>
                                    <div className="flex flex-col gap-1 text-xs text-muted-foreground items-start">
                                        <span className="flex items-center gap-1"><Download className="h-3.5 w-3.5"/> TOTAL: {formatNumber(repoStats['Twitter-X-Media-Batch-Downloader'].totalDownloads)}</span>
                                        <span className="flex items-center gap-1 text-green-600 dark:text-green-400"><Download className="h-3.5 w-3.5"/> LATEST: {formatNumber(repoStats['Twitter-X-Media-Batch-Downloader'].latestDownloads)}</span>
                                    </div>
                                </CardContent>)}
                            </Card>
                        </div>
                    </div>)}

            
            {activeTab === "support" && (<div className="flex flex-col items-center justify-center p-8 space-y-8">
                <div className="text-center space-y-2">
                    <h3 className="text-2xl font-bold tracking-tight">Support Our Work</h3>
                    <p className="text-muted-foreground max-w-[500px]">
                        If this software is useful and brings you value, consider supporting the project by buying me a coffee. Your support helps keep development going.
                    </p>
                </div>

                <div className="grid sm:grid-cols-2 gap-4 w-full max-w-lg">
                    <Button size="lg" className="h-16 text-lg font-semibold text-white gap-3 group" style={{ backgroundColor: "#72a4f2" }} onClick={() => openExternal("https://ko-fi.com/afkarxyz")}>
                        <img src={KofiLogo} className="h-8 w-8 transition-transform group-hover:scale-110" alt="Ko-fi"/>
                        Support me on Ko-fi
                    </Button>

                    <Button size="lg" className="h-16 text-lg font-semibold text-black gap-3 group" style={{ backgroundColor: "#ffdd00" }} onClick={() => openExternal("https://buymeacoffee.com/afkarxyz")}>
                        <img src={BmcLogo} className="h-6 w-6 transition-transform group-hover:scale-110" alt="Buy Me a Coffee"/>
                        Buy Me a Coffee
                    </Button>
                </div>
            </div>)}
        </div>
    </div>);
}
