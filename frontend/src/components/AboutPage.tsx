import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { openExternal } from "@/lib/utils";
import { GetOSInfo } from "../../wailsjs/go/main/App";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Bug, Lightbulb, ExternalLink, Star, GitFork, Clock, Download } from "lucide-react";
import AudioTTSProIcon from "@/assets/audiotts-pro.webp";
import ChatGPTTTSIcon from "@/assets/chatgpt-tts.webp";
import XProIcon from "@/assets/x-pro.webp";
import SpotubeDLIcon from "@/assets/icons/spotubedl.svg";
import SpotiDownloaderIcon from "@/assets/icons/spotidownloader.svg";
import XBatchDLIcon from "@/assets/icons/xbatchdl.svg";
import { langColors } from "@/assets/github-lang-colors";
interface AboutPageProps {
    version: string;
}
export function AboutPage({ version }: AboutPageProps) {
    const [os, setOs] = useState("Unknown");
    const [location, setLocation] = useState("Unknown");
    const [reportType, setReportType] = useState("bug");
    const [problem, setProblem] = useState("");
    const [bugType, setBugType] = useState<string>("Track");
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
    const sanitizeForURL = (text: string): string => {
        return text.replace(/[()]/g, "").replace(/,/g, " -");
    };
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
        let title = "";
        let body = "";
        if (reportType === "bug") {
            title = `[Bug Report] ${problem ? problem.substring(0, 50) + (problem.length > 50 ? "..." : "") : "Issue"}`;
            body = `### [Bug Report]

#### Problem
> ${problem || "Type here"}

#### Type
${bugType || "Track / Album / Playlist / Artist"}

#### Spotify URL
> ${spotifyUrl || "Type here"}

#### Additional Context
> ${bugContext || "Type here or send screenshot/recording"}

#### Version
SpotiFLAC v${version}

#### OS
${sanitizeForURL(os || "Unknown")}

#### Location
${location || "Unknown"}
`;
        }
        else {
            title = `[Feature Request] ${featureDesc ? featureDesc.substring(0, 50) + (featureDesc.length > 50 ? "..." : "") : "Request"}`;
            body = `### [Feature Request]

#### Description
> ${featureDesc || "Type here"}

#### Use Case
> ${useCase || "Type here"}

#### Additional Context
> ${featureContext || "Type here or send screenshot/recording"}
`;
        }
        const url = `https://github.com/afkarxyz/SpotiFLAC/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
        openExternal(url);
    };
    return (<div className="animate-in slide-in-from-bottom-12 fade-in duration-500 ease-out space-y-6">
        <div>
            <h2 className="text-2xl font-bold tracking-tight">About</h2>
        </div>

        <Tabs defaultValue="report" className="w-full">
            <TabsList className="grid w-full grid-cols-3 cursor-pointer">
                <TabsTrigger value="report" className="cursor-pointer transition-colors hover:text-primary data-[state=active]:text-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none">Report Issue</TabsTrigger>
                <TabsTrigger value="faq" className="cursor-pointer transition-colors hover:text-primary data-[state=active]:text-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none">FAQ</TabsTrigger>
                <TabsTrigger value="projects" className="cursor-pointer transition-colors hover:text-primary data-[state=active]:text-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none">Other Projects</TabsTrigger>
            </TabsList>

            <TabsContent value="report" className="mt-4">
                <Card>
                    <CardContent className="space-y-4 pt-4">
                        <Tabs value={reportType} onValueChange={setReportType} className="w-full">
                            <TabsList className="w-full grid grid-cols-2 cursor-pointer pb-2">
                                <TabsTrigger value="bug" className="flex items-center gap-2 cursor-pointer transition-colors hover:text-primary data-[state=active]:text-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"><Bug className="h-4 w-4" /> Bug Report</TabsTrigger>
                                <TabsTrigger value="feature" className="flex items-center gap-2 cursor-pointer transition-colors hover:text-primary data-[state=active]:text-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"><Lightbulb className="h-4 w-4" /> Feature Request</TabsTrigger>
                            </TabsList>

                            <div className="mt-4">
                                {reportType === "bug" ? (<div className="grid md:grid-cols-2 gap-6">
                                    <div className="space-y-2 flex flex-col">
                                        <Label>Problem</Label>
                                        <Textarea className="flex-1 resize-none" placeholder="Describe the problem..." value={problem} onChange={e => setProblem(e.target.value)} />
                                    </div>
                                    <div className="space-y-4">
                                        <div className="space-y-2">
                                            <Label>Type</Label>
                                            <ToggleGroup type="single" value={bugType} onValueChange={(val) => {
                                                if (val)
                                                    setBugType(val);
                                            }} className="justify-start w-full cursor-pointer">
                                                <ToggleGroupItem value="Track" className="flex-1 cursor-pointer" aria-label="Toggle track">
                                                    Track
                                                </ToggleGroupItem>
                                                <ToggleGroupItem value="Album" className="flex-1 cursor-pointer" aria-label="Toggle album">
                                                    Album
                                                </ToggleGroupItem>
                                                <ToggleGroupItem value="Playlist" className="flex-1 cursor-pointer" aria-label="Toggle playlist">
                                                    Playlist
                                                </ToggleGroupItem>
                                                <ToggleGroupItem value="Artist" className="flex-1 cursor-pointer" aria-label="Toggle artist">
                                                    Artist
                                                </ToggleGroupItem>
                                            </ToggleGroup>
                                        </div>
                                        <div className="space-y-2">
                                            <Label>Spotify URL</Label>
                                            <Input placeholder="https://open.spotify.com/..." value={spotifyUrl} onChange={e => setSpotifyUrl(e.target.value)} />
                                        </div>
                                        <div className="space-y-2 h-full">
                                            <Label>Additional Context</Label>
                                            <Textarea className="h-[125px] resize-none" placeholder="Any other details? Screenshots or recordings are very helpful (please upload directly to GitHub)." value={bugContext} onChange={e => setBugContext(e.target.value)} />
                                        </div>
                                    </div>
                                </div>) : (<div className="grid md:grid-cols-2 gap-6">
                                    <div className="space-y-2 flex flex-col">
                                        <Label>Description</Label>
                                        <Textarea className="flex-1 resize-none" placeholder="Describe your feature request..." value={featureDesc} onChange={e => setFeatureDesc(e.target.value)} />
                                    </div>
                                    <div className="space-y-4">
                                        <div className="space-y-2">
                                            <Label>Use Case</Label>
                                            <Textarea className="h-[100px] resize-none" placeholder="How would this feature be useful?" value={useCase} onChange={e => setUseCase(e.target.value)} />
                                        </div>
                                        <div className="space-y-2">
                                            <Label>Additional Context</Label>
                                            <Textarea className="h-[135px] resize-none" placeholder="Any other details? Screenshots/recordings or examples..." value={featureContext} onChange={e => setFeatureContext(e.target.value)} />
                                        </div>
                                    </div>
                                </div>)}
                            </div>
                        </Tabs>

                        <div className="flex justify-center pt-2">
                            <Button className="w-[200px] cursor-pointer" onClick={handleSubmit}>
                                <ExternalLink className="h-4 w-4" /> Create Issue on GitHub
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            </TabsContent>

            <TabsContent value="faq" className="mt-4 space-y-4">
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
            </TabsContent>

            <TabsContent value="projects" className="mt-4 space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                    <Card className="hover:bg-muted/50 hover:border-primary/50 transition-colors cursor-pointer" onClick={() => openExternal("https://exyezed.cc/")}>
                        <CardHeader>
                            <CardTitle>Browser Extensions & Scripts</CardTitle>
                            <CardDescription className="flex gap-3 pt-2">
                                <img src={AudioTTSProIcon} className="h-8 w-8 rounded-md shadow-sm" alt="AudioTTS Pro" />
                                <img src={ChatGPTTTSIcon} className="h-8 w-8 rounded-md shadow-sm" alt="ChatGPT TTS" />
                                <img src={XProIcon} className="h-8 w-8 rounded-md shadow-sm" alt="X Pro" />
                            </CardDescription>
                        </CardHeader>
                    </Card>
                    <Card className="hover:bg-muted/50 hover:border-primary/50 transition-colors cursor-pointer" onClick={() => openExternal("https://spotubedl.com/")}>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2"><img src={SpotubeDLIcon} className="h-5 w-5" alt="SpotubeDL" /> SpotubeDL</CardTitle>
                            <CardDescription>Download Spotify Tracks, Albums, Playlists as MP3/OGG/Opus with High Quality.</CardDescription>
                        </CardHeader>
                    </Card>
                    <Card className="hover:bg-muted/50 hover:border-primary/50 transition-colors cursor-pointer" onClick={() => openExternal("https://github.com/afkarxyz/SpotiDownloader")}>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2"><img src={SpotiDownloaderIcon} className="h-5 w-5" alt="SpotiDownloader" /> SpotiDownloader</CardTitle>
                            <CardDescription>Get Spotify tracks in MP3 and FLAC via the spotidownloader.com API.</CardDescription>
                        </CardHeader>
                        {repoStats['SpotiDownloader'] && (<CardContent className="space-y-3">
                            <div className="flex flex-wrap gap-2 text-xs">
                                {repoStats['SpotiDownloader'].languages?.map((lang: string) => (<span key={lang} className="px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: getLangColor(lang) + '20', color: getLangColor(lang) }}>{lang}</span>))}
                            </div>
                            <div className="flex items-center gap-4 text-xs text-muted-foreground">
                                <span className="flex items-center gap-1"><Star className="h-3.5 w-3.5 fill-amber-500 text-amber-500" /> {formatNumber(repoStats['SpotiDownloader'].stars)}</span>
                                <span className="flex items-center gap-1"><GitFork className="h-3.5 w-3.5" /> {repoStats['SpotiDownloader'].forks}</span>
                                <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> {formatTimeAgo(repoStats['SpotiDownloader'].createdAt)}</span>
                            </div>
                            <div className="flex items-center gap-4 text-xs text-muted-foreground">
                                <span className="flex items-center gap-1"><Download className="h-3.5 w-3.5" /> TOTAL: {formatNumber(repoStats['SpotiDownloader'].totalDownloads)}</span>
                                <span className="flex items-center gap-1 text-green-600 dark:text-green-400"><Download className="h-3.5 w-3.5" /> LATEST: {formatNumber(repoStats['SpotiDownloader'].latestDownloads)}</span>
                            </div>
                        </CardContent>)}
                    </Card>
                    <Card className="hover:bg-muted/50 hover:border-primary/50 transition-colors cursor-pointer" onClick={() => openExternal("https://github.com/afkarxyz/Twitter-X-Media-Batch-Downloader")}>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2"><img src={XBatchDLIcon} className="h-5 w-5" alt="Twitter/X Media Batch Downloader" /> Twitter/X Media Batch Downloader</CardTitle>
                            <CardDescription>A GUI tool to download original-quality images and videos from Twitter/X accounts, powered by gallery-dl by @mikf</CardDescription>
                        </CardHeader>
                        {repoStats['Twitter-X-Media-Batch-Downloader'] && (<CardContent className="space-y-3">
                            <div className="flex flex-wrap gap-2 text-xs">
                                {repoStats['Twitter-X-Media-Batch-Downloader'].languages?.map((lang: string) => (<span key={lang} className="px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: getLangColor(lang) + '20', color: getLangColor(lang) }}>{lang}</span>))}
                            </div>
                            <div className="flex items-center gap-4 text-xs text-muted-foreground">
                                <span className="flex items-center gap-1"><Star className="h-3.5 w-3.5 fill-amber-500 text-amber-500" /> {formatNumber(repoStats['Twitter-X-Media-Batch-Downloader'].stars)}</span>
                                <span className="flex items-center gap-1"><GitFork className="h-3.5 w-3.5" /> {repoStats['Twitter-X-Media-Batch-Downloader'].forks}</span>
                                <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> {formatTimeAgo(repoStats['Twitter-X-Media-Batch-Downloader'].createdAt)}</span>
                            </div>
                            <div className="flex items-center gap-4 text-xs text-muted-foreground">
                                <span className="flex items-center gap-1"><Download className="h-3.5 w-3.5" /> TOTAL: {formatNumber(repoStats['Twitter-X-Media-Batch-Downloader'].totalDownloads)}</span>
                                <span className="flex items-center gap-1 text-green-600 dark:text-green-400"><Download className="h-3.5 w-3.5" /> LATEST: {formatNumber(repoStats['Twitter-X-Media-Batch-Downloader'].latestDownloads)}</span>
                            </div>
                        </CardContent>)}
                    </Card>
                </div>
            </TabsContent>
        </Tabs>
    </div>);
}
