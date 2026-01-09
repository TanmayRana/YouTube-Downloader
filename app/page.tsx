"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "react-hot-toast";
import {
  Download,
  Video,
  Loader2,
  AlertCircle,
  List,
  CheckCircle,
  Folder,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";

interface Format {
  format_id: string;
  ext: string;
  resolution?: string;
  type: "audio" | "video" | "video+audio";
  filesize?: number;
  vcodec?: string;
  acodec?: string;
}

interface VideoData {
  id: string;
  title: string;
  thumbnail: string;
  formats_data: Format[];
  duration?: number;
  uploader?: string;
  channel?: string;
  webpage_url?: string;
}

interface PlaylistVideo {
  id: string;
  title: string;
  url: string;
}

interface PlaylistData {
  id: string;
  title: string;
  thumbnail?: string;
  video_count: number;
  videos: PlaylistVideo[];
  uploader?: string;
  channel?: string;
  webpage_url?: string;
}

// Use local Next.js API routes
const API_BASE = "/api";

const Index = () => {
  const [url, setUrl] = useState("");
  const [filename, setFilename] = useState("");
  const [videoData, setVideoData] = useState<VideoData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [playlistUrl, setPlaylistUrl] = useState("");
  const [playlistData, setPlaylistData] = useState<PlaylistData | null>(null);
  const [playlistLoading, setPlaylistLoading] = useState(false);
  const [playlistError, setPlaylistError] = useState("");
  const [playlistDownloadLoading, setPlaylistDownloadLoading] = useState(false);
  const [playlistDownloadOpen, setPlaylistDownloadOpen] = useState(false);
  const [directoryHandle, setDirectoryHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const [tabTrigger, setTabTrigger] = useState("video");

  // Download progress tracking
  const [downloadProgress, setDownloadProgress] = useState({
    current: 0,
    total: 0,
    currentVideo: "",
    successCount: 0,
    failCount: 0,
  });

  const [sheetOpen, setSheetOpen] = useState(false);
  const [pendingDialogOpen, setPendingDialogOpen] = useState(false);

  // Playlist download options - DEFAULT TO STREAM FOR BROWSER SAVE DIALOG
  const [playlistDownloadOptions, setPlaylistDownloadOptions] = useState({
    download_path: "",
    download_all: true,
    stream: true, // Always true for browser save dialog
    qualityaudiovideo: "video+audio" as "audio" | "video+audio",
    quality: "720p" as "144p" | "240p" | "360p" | "480p" | "720p" | "1080p",
  });

  // console.log("playlistDownloadOptions", playlistDownloadOptions);

  // Open format dialog after analyzing video from playlist
  useEffect(() => {
    if (pendingDialogOpen && videoData) {
      setSheetOpen(true);
      setPendingDialogOpen(false);
    }
  }, [videoData, pendingDialogOpen]);

  const analyzeVideo = useCallback(async () => {
    if (!url.trim()) {
      toast.error("Please enter a YouTube URL");
      return;
    }

    setLoading(true);
    setError("");
    setVideoData(null);

    try {
      const response = await fetch(`${API_BASE}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Failed to analyze video");
      }

      const data = await response.json();
      const mappedData: VideoData = {
        id: data.id,
        title: data.title,
        thumbnail: data.thumbnail,
        formats_data: data.formats ?? data.formats_data ?? [],
        duration: data.duration,
        uploader: data.uploader,
        channel: data.channel,
        webpage_url: data.webpage_url,
      };

      setVideoData(mappedData);
      if (tabTrigger !== "video") {
        setSheetOpen(true);
      }
      toast.success("Video analyzed successfully!");
    } catch (err: any) {
      const errorMsg = err.message || "Failed to analyze video";
      setError(errorMsg);
      toast.error(errorMsg);
    } finally {
      setLoading(false);
    }
  }, [url]);

  const downloadPlaylistVideos = useCallback(async () => {
    const downloadUrl = playlistData?.webpage_url || playlistUrl;
    if (!downloadUrl?.trim()) {
      toast.error("Please analyze a playlist first");
      return;
    }

    // Check if folder is selected
    if (!directoryHandle) {
      toast.error("Please select a download folder first");
      return;
    }

    setPlaylistDownloadLoading(true);

    // Reset progress
    setDownloadProgress({
      current: 0,
      total: 0,
      currentVideo: "",
      successCount: 0,
      failCount: 0,
    });

    try {
      const payload = {
        url: downloadUrl,
        media_type: playlistDownloadOptions.qualityaudiovideo,
        quality: playlistDownloadOptions.quality,
      };

      const response = await fetch(`${API_BASE}/playlist/download`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(
          data.error || data.detail || "Failed to prepare playlist downloads"
        );
      }

      const data = await response.json();

      if (!Array.isArray(data.videos) || data.videos.length === 0) {
        throw new Error("No downloadable videos were found in this playlist");
      }

      // Download each video to the selected folder
      let successCount = 0;
      let failCount = 0;
      const totalVideos = data.videos.length;

      // Set initial progress
      setDownloadProgress({
        current: 0,
        total: totalVideos,
        currentVideo: "Starting downloads...",
        successCount: 0,
        failCount: 0,
      });

      toast.success(`Starting download of ${totalVideos} videos...`, { duration: 3000 });

      // Download videos in batches to speed up connectivity while avoiding browser limits
      const BATCH_SIZE = 3;
      for (let i = 0; i < data.videos.length; i += BATCH_SIZE) {
        const batch = data.videos.slice(i, i + BATCH_SIZE);

        await Promise.all(batch.map(async (video: any, index: number) => {
          const videoIndex = i + index;
          const videoTitle = video.title || `video_${videoIndex + 1}`;

          // Update current video being processed (showing the last one in batch for simplicity)
          setDownloadProgress(prev => ({
            ...prev,
            current: Math.min(prev.current + 1, totalVideos),
            currentVideo: `Dataset ${Math.ceil((videoIndex + 1) / BATCH_SIZE)}: ${videoTitle}`,
          }));

          if (!video?.download_url) {
            failCount++;
            setDownloadProgress(prev => ({
              ...prev,
              failCount: failCount,
            }));
            return;
          }

          try {
            // Fetch the video file
            const videoResponse = await fetch(video.download_url);
            if (!videoResponse.ok) throw new Error("Download failed");

            const blob = await videoResponse.blob();

            // Sanitize filename - remove invalid characters
            const sanitizedTitle = videoTitle
              .replace(/[<>:"/\\|?*]/g, "")
              .replace(/\s+/g, " ")
              .trim()
              .substring(0, 200);

            const ext = video.format?.ext || "mp4";
            const filename = `${sanitizedTitle}.${ext}`;

            // Write to selected folder
            const fileHandle = await directoryHandle.getFileHandle(filename, {
              create: true,
            });
            const writable = await fileHandle.createWritable();
            await writable.write(blob);
            await writable.close();

            successCount++;
            setDownloadProgress(prev => ({
              ...prev,
              successCount: successCount,
            }));

            // Toast only for every few successes to avoid spamming
            if (successCount % 3 === 0) {
              toast.success(`Progress: ${successCount}/${totalVideos} downloaded`, {
                duration: 2000
              });
            }
          } catch (err) {
            console.error(`Failed to download ${videoTitle}:`, err);
            failCount++;
            setDownloadProgress(prev => ({
              ...prev,
              failCount: failCount,
            }));
            toast.error(`Failed: ${videoTitle?.substring(0, 30)}...`, { duration: 2000 });
          }
        }));
      }

      // Final update
      setDownloadProgress(prev => ({
        ...prev,
        currentVideo: "Complete!",
      }));

      // Close dialog after a short delay
      setTimeout(() => {
        setPlaylistDownloadOpen(false);

        if (successCount > 0) {
          toast.success(
            `Download complete! ${successCount} succeeded${failCount > 0 ? `, ${failCount} failed` : ""}`,
            { duration: 8000 }
          );
        } else {
          toast.error("All downloads failed. Please check console for errors.");
        }
      }, 2000);
    } catch (err: any) {
      const errorMsg = err.message || "Failed to download playlist";
      toast.error(errorMsg);
      setPlaylistDownloadOpen(false);
    } finally {
      setPlaylistDownloadLoading(false);
    }
  }, [playlistData, playlistUrl, playlistDownloadOptions, directoryHandle]);


  const downloadFormat = (formatId: string) => {
    const downloadUrl = new URL(`${API_BASE}/download`, window.location.origin);
    downloadUrl.searchParams.append("url", url);
    downloadUrl.searchParams.append("format_id", formatId);
    if (filename.trim()) {
      downloadUrl.searchParams.append("filename", filename.trim());
    }

    window.location.href = downloadUrl.toString();
    toast.success(
      "Download started! Your file should begin downloading shortly."
    );
    setSheetOpen(false);
  };

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return "Unknown";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024)
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  };

  const formatDuration = (seconds?: number) => {
    if (!seconds) return "Unknown";
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case "audio":
        return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200";
      case "video":
        return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200";
      case "video+audio":
        return "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200";
      default:
        return "bg-muted text-muted-foreground";
    }
  };

  const analyzePlaylist = useCallback(async () => {
    if (!playlistUrl.trim()) {
      toast.error("Please enter a playlist URL");
      return;
    }

    setPlaylistLoading(true);
    setPlaylistError("");
    setPlaylistData(null);

    try {
      const response = await fetch(`${API_BASE}/playlist/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: playlistUrl }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Failed to analyze playlist");
      }

      const data = await response.json();
      setPlaylistData(data);
      toast.success(`Playlist loaded! ${data.video_count} videos found.`);
    } catch (err: any) {
      const errorMsg = err.message || "Failed to analyze playlist";
      setPlaylistError(errorMsg);
      toast.error(errorMsg);
    } finally {
      setPlaylistLoading(false);
    }
  }, [playlistUrl]);

  const visibleFormats = useMemo(
    () =>
      videoData?.formats_data.filter(
        (format) => format.ext !== "mhtml" && format.resolution !== "storyboard"
      ) ?? [],
    [videoData]
  );

  const formatCounts = useMemo(
    () => ({
      audio: visibleFormats.filter((f) => f.type === "audio").length,
      video: visibleFormats.filter((f) => f.type === "video").length,
      videoAudio: visibleFormats.filter((f) => f.type === "video+audio").length,
    }),
    [visibleFormats]
  );

  const performFolderSelection = async () => {
    try {
      // Modern browsers: Directory Picker API
      if ("showDirectoryPicker" in window) {
        const dirHandle = await (window as any).showDirectoryPicker();
        setDirectoryHandle(dirHandle);
        setPlaylistDownloadOptions((prev) => ({
          ...prev,
          download_path: dirHandle.name,
        }));
        toast.success(`Selected folder: ${dirHandle.name}`);
        setFolderDialogOpen(false);
        return;
      }

      // Fallback for unsupported browsers
      toast.error("Folder selection not supported in this browser. Downloads will use default folder.");
      setFolderDialogOpen(false);
    } catch (error) {
      const err = error as any;
      if (err?.name !== "AbortError") {
        console.error("Folder selection failed:", err);
        toast.error("Failed to select folder");
      }
      // Don't close dialog on error so user can try again or cancel
    }
  };

  const handleSelectSaveLocation = () => {
    setFolderDialogOpen(true);
  };

  // console.log("tabTrigger", tabTrigger);

  useEffect(() => {
    if (tabTrigger === "playlist") {
      setPlaylistUrl("");
      setPlaylistData(null);
    }

    if (tabTrigger === "video") {
      setUrl("");
      setVideoData(null);
    }
  }, [tabTrigger]);



  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-secondary/20 py-12 px-4">
      <div className="container max-w-5xl mx-auto">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-3 mb-4">
            <Video className="w-10 h-10 text-primary" />
            <h1 className="text-4xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              YouTube Downloader
            </h1>
          </div>
          <p className="text-muted-foreground text-lg">
            Download videos and audio in your preferred format
          </p>
        </div>

        <Card className="shadow-lg hover:shadow-xl transition-shadow duration-300">
          <Tabs defaultValue="video" className="w-full"
            onValueChange={(value) => setTabTrigger(value)}
          >
            <CardHeader>
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div>
                  <CardTitle>YouTube Downloader</CardTitle>
                  <CardDescription>
                    Choose between single video or playlist download
                  </CardDescription>
                </div>
                <TabsList className="grid grid-cols-2 w-full sm:w-auto">
                  <TabsTrigger value="video" className="gap-2">
                    <Video className="w-4 h-4" /> Single Video
                  </TabsTrigger>
                  <TabsTrigger value="playlist" className="gap-2">
                    <List className="w-4 h-4" /> Playlist
                  </TabsTrigger>
                </TabsList>
              </div>
            </CardHeader>

            <CardContent className="space-y-4">
              {error && (
                <div className="flex items-center gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-md text-destructive">
                  <AlertCircle className="w-5 h-5 flex-shrink-0" />
                  <p>{error}</p>
                </div>
              )}

              <TabsContent value="video" className="space-y-4">
                <div className="flex gap-2">
                  <Input
                    type="url"
                    placeholder="https://www.youtube.com/watch?v=..."
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && analyzeVideo()}
                    className="flex-1"
                    disabled={loading}
                  />
                  <Button
                    onClick={analyzeVideo}
                    disabled={loading || !url.trim()}
                    size="lg"
                  >
                    {loading ? (
                      <>
                        <Loader2 className="animate-spin mr-2 w-4 h-4" />
                        Analyzing...
                      </>
                    ) : (
                      "Analyze"
                    )}
                  </Button>
                </div>

                {videoData && (
                  <div className="space-y-6">
                    <div className="flex gap-4 p-4 bg-muted/50 rounded-lg border">
                      <img
                        src={videoData.thumbnail}
                        alt={videoData.title}
                        className="w-32 h-24 object-cover rounded-md shadow-md flex-shrink-0"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = "none";
                        }}
                      />
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-lg mb-2 line-clamp-2">
                          {videoData.title}
                        </h3>
                        <p className="text-sm text-muted-foreground mb-1">
                          {videoData.channel ||
                            videoData.uploader ||
                            "Unknown channel"}
                        </p>
                        <p className="text-xs text-muted-foreground mb-2">
                          Duration: {formatDuration(videoData.duration)}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          <Badge className={getTypeColor("audio")}>
                            Audio: {formatCounts.audio}
                          </Badge>
                          <Badge className={getTypeColor("video")}>
                            Video: {formatCounts.video}
                          </Badge>
                          <Badge className={getTypeColor("video+audio")}>
                            Video+Audio: {formatCounts.videoAudio}
                          </Badge>
                        </div>
                      </div>
                    </div>

                    <Input
                      type="text"
                      placeholder="Custom filename (optional)"
                      value={filename}
                      onChange={(e) => setFilename(e.target.value)}
                    />

                    <div className="space-y-3">
                      <h4 className="font-semibold">Available Formats</h4>
                      <div className="border rounded-lg overflow-hidden">
                        <div className="overflow-x-auto">
                          <table className="w-full min-w-[600px]">
                            <thead className="bg-muted/50">
                              <tr>
                                <th className="px-4 py-3 text-left text-sm font-semibold">
                                  Type
                                </th>
                                <th className="px-4 py-3 text-left text-sm font-semibold">
                                  Resolution
                                </th>
                                <th className="px-4 py-3 text-left text-sm font-semibold">
                                  Format
                                </th>
                                <th className="px-4 py-3 text-left text-sm font-semibold">
                                  Size
                                </th>
                                <th className="px-4 py-3 text-right text-sm font-semibold">
                                  Action
                                </th>
                              </tr>
                            </thead>
                            <tbody className="divide-y">
                              {visibleFormats.map((format) => (
                                <tr
                                  key={format.format_id}
                                  className="hover:bg-muted/30 transition-colors"
                                >
                                  <td className="px-4 py-3">
                                    <Badge
                                      className={getTypeColor(format.type)}
                                    >
                                      {format.type}
                                    </Badge>
                                  </td>
                                  <td className="px-4 py-3 text-sm">
                                    {format.resolution || "N/A"}
                                  </td>
                                  <td className="px-4 py-3 text-sm">
                                    {format.ext}
                                  </td>
                                  <td className="px-4 py-3 text-sm text-muted-foreground">
                                    {formatFileSize(format.filesize)}
                                  </td>

                                  {/* table download button */}
                                  <td className="px-4 py-3 text-right">
                                    <Button
                                      size="sm"
                                      onClick={() =>
                                        downloadFormat(format.format_id)
                                      }
                                      variant="default"
                                    >
                                      <Download className="mr-1 w-4 h-4" />
                                      Download
                                    </Button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="playlist" className="space-y-4">
                <div className="flex gap-2">
                  <Input
                    type="url"
                    placeholder="https://www.youtube.com/playlist?list=..."
                    value={playlistUrl}
                    onChange={(e) => setPlaylistUrl(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && analyzePlaylist()}
                    className="flex-1"
                    disabled={playlistLoading}
                  />
                  <Button
                    onClick={analyzePlaylist}
                    disabled={playlistLoading || !playlistUrl.trim()}
                    size="lg"
                  >
                    {playlistLoading ? (
                      <>
                        <Loader2 className="animate-spin mr-2 w-4 h-4" />
                        Analyzing...
                      </>
                    ) : (
                      "Analyze"
                    )}
                  </Button>
                </div>

                {playlistError && (
                  <div className="flex items-center gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-md text-destructive">
                    <AlertCircle className="w-5 h-5 flex-shrink-0" />
                    <p>{playlistError}</p>
                  </div>
                )}

                {playlistData && (
                  <div className="space-y-6">
                    <div className="flex gap-4 p-4 bg-muted/50 rounded-lg border">
                      {playlistData.thumbnail && (
                        <img
                          src={playlistData.thumbnail}
                          alt={playlistData.title}
                          className="w-32 h-24 object-cover rounded-md shadow-md flex-shrink-0"
                        />
                      )}
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-lg mb-2 line-clamp-2">
                          {playlistData.title}
                        </h3>
                        {playlistData.channel && (
                          <p className="text-sm text-muted-foreground mb-1">
                            <span className="font-medium">Channel:</span>{" "}
                            {playlistData.channel}
                          </p>
                        )}
                        <p className="text-sm text-muted-foreground mb-2">
                          <span className="font-medium">Videos:</span>{" "}
                          {playlistData.video_count}
                        </p>
                        {playlistData.webpage_url && (
                          <a
                            href={playlistData.webpage_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline text-sm"
                          >
                            View on YouTube →
                          </a>
                        )}
                      </div>
                    </div>

                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h4 className="font-semibold">
                          Videos ({playlistData.videos.length})
                        </h4>
                        <Button
                          onClick={() => setPlaylistDownloadOpen(true)}
                          disabled={playlistDownloadLoading}
                          className="gap-2"
                        >
                          <Download className="w-4 h-4" />
                          Download All
                        </Button>
                      </div>
                      <div className="border rounded-lg overflow-hidden max-h-96 overflow-y-auto">
                        <div className="divide-y">
                          {playlistData.videos.map((video, index) => (
                            <div
                              key={video.id}
                              className="flex items-center gap-3 p-3 hover:bg-muted/30"
                            >
                              <span className="text-muted-foreground font-medium w-10 text-center flex-shrink-0">
                                {index + 1}
                              </span>
                              <div className="flex-1 min-w-0">
                                <p className="font-medium truncate">
                                  {video.title}
                                </p>
                              </div>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setUrl(video.url);
                                  setPendingDialogOpen(true);
                                  analyzeVideo();
                                }}
                                disabled={loading}
                                className="flex-shrink-0"
                              >
                                <Download className="mr-1 w-4 h-4" />
                                Single
                              </Button>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </TabsContent>
            </CardContent>
          </Tabs>
        </Card>

        {/* Format Selection Dialog */}
        <Dialog open={sheetOpen} onOpenChange={setSheetOpen}>
          <DialogContent className="sm:max-w-5xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Select Format to Download</DialogTitle>
              <DialogDescription>
                Choose the quality and format for your download
              </DialogDescription>
            </DialogHeader>
            {videoData && (
              <>
                <div className="space-y-6">
                  <div className="flex gap-4 p-4 bg-muted/50 rounded-lg border">
                    <img
                      src={videoData.thumbnail}
                      alt={videoData.title}
                      className="w-32 h-24 object-cover rounded-md shadow-md flex-shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-lg mb-2 line-clamp-2">
                        {videoData.title}
                      </h3>
                      <div className="flex flex-wrap gap-2">
                        <Badge className={getTypeColor("audio")}>
                          Audio: {formatCounts.audio}
                        </Badge>
                        <Badge className={getTypeColor("video")}>
                          Video: {formatCounts.video}
                        </Badge>
                        <Badge className={getTypeColor("video+audio")}>
                          Video+Audio: {formatCounts.videoAudio}
                        </Badge>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <h4 className="font-semibold">Available Formats</h4>
                    <div className="border rounded-lg overflow-hidden">
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[600px]">
                          <thead className="bg-muted/50">
                            <tr>
                              <th className="px-4 py-3 text-left text-sm font-semibold">
                                Type
                              </th>
                              <th className="px-4 py-3 text-left text-sm font-semibold">
                                Resolution
                              </th>
                              <th className="px-4 py-3 text-left text-sm font-semibold">
                                Format
                              </th>
                              <th className="px-4 py-3 text-left text-sm font-semibold">
                                Size
                              </th>
                              <th className="px-4 py-3 text-right text-sm font-semibold">
                                Action
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y">
                            {visibleFormats.map((format) => (
                              <tr
                                key={format.format_id}
                                className="hover:bg-muted/30 transition-colors"
                              >
                                <td className="px-4 py-3">
                                  <Badge className={getTypeColor(format.type)}>
                                    {format.type}
                                  </Badge>
                                </td>
                                <td className="px-4 py-3 text-sm">
                                  {format.resolution || "N/A"}
                                </td>
                                <td className="px-4 py-3 text-sm">
                                  {format.ext}
                                </td>
                                <td className="px-4 py-3 text-sm text-muted-foreground">
                                  {formatFileSize(format.filesize)}
                                </td>
                                <td className="px-4 py-3 text-right">
                                  <Button
                                    size="sm"
                                    onClick={() =>
                                      downloadFormat(format.format_id)
                                    }
                                    variant="default"
                                  >
                                    <Download className="mr-1 w-4 h-4" />
                                    Download
                                  </Button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}
          </DialogContent>
        </Dialog>



        <Dialog
          open={playlistDownloadOpen}
          onOpenChange={setPlaylistDownloadOpen}
        >
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Download className="w-5 h-5" />
                Download Playlist Videos
              </DialogTitle>
              <DialogDescription className="space-y-1">
                Download all{" "}
                <span className="font-semibold">
                  {playlistData?.video_count || 0}
                </span>{" "}
                videos individually.
                <br />
                <span className="text-xs text-muted-foreground">
                  Each video triggers a browser download. Choose save location
                  for each file.
                </span>
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              {/* Enhanced Playlist Preview */}
              <div className="p-4 bg-gradient-to-r from-muted/50 to-muted rounded-xl border border-border/50 hover:shadow-md transition-all duration-200 group">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-gradient-to-br from-primary/10 to-primary/20 rounded-xl flex items-center justify-center flex-shrink-0 group-hover:scale-105 transition-transform">
                    <List className="w-6 h-6 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    {/* <h4 className="font-semibold text-foreground truncate group-hover:text-primary transition-colors">
                      {playlistData?.title}
                    </h4>
                     */}
                    <h4 className="font-semibold text-foreground group-hover:text-primary transition-colors line-clamp-2">
                      {playlistData?.title}
                    </h4>

                    <p className="text-sm text-muted-foreground">
                      {playlistData?.video_count || 0} videos
                    </p>
                  </div>
                </div>
              </div>



              {/* custom save location */}
              {/* Enhanced Save Location Picker */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">Save Location</Label>
                <div className="relative group">
                  <Input
                    type="text"
                    value={playlistDownloadOptions.download_path}
                    onChange={(e) =>
                      setPlaylistDownloadOptions((prev) => ({
                        ...prev,
                        download_path: e.target.value,
                      }))
                    }
                    placeholder="Click 'Select' to choose folder (e.g., D:\tr)"
                    className={`pr-10 transition-colors ${playlistDownloadOptions.download_path
                      ? "border-green-500 ring-1 ring-green-500/20 bg-green-500/5"
                      : ""
                      }`}
                    readOnly // Prevents manual typing for better UX
                  />
                  <Button
                    type="button"
                    size="sm"
                    className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-28 rounded-l-none border-l-0 shadow-none hover:shadow-md transition-all duration-200"
                    onClick={handleSelectSaveLocation}
                    disabled={playlistDownloadLoading}
                  >
                    {playlistDownloadLoading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      "Select Folder"
                    )}
                  </Button>
                </div>

                {playlistDownloadOptions.download_path && (
                  <div className="flex items-center justify-between p-2 bg-muted/50 rounded-md text-xs">
                    <span
                      className="truncate font-mono"
                      title={playlistDownloadOptions.download_path}
                    >
                      📁 {playlistDownloadOptions.download_path}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-xs"
                      onClick={() => {
                        navigator.clipboard.writeText(
                          playlistDownloadOptions.download_path
                        );
                      }}
                    >
                      Copy
                    </Button>
                  </div>
                )}

                <p className="text-xs text-muted-foreground">
                  💡 Videos will download to selected folder. Browser permission
                  required.
                </p>
              </div>

              {/* Media Type & Quality Controls */}
              <div className="space-y-3">
                <Label className="text-sm font-medium">
                  Media Type & Quality
                </Label>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  <Select
                    value={playlistDownloadOptions.qualityaudiovideo}
                    onValueChange={(value) =>
                      setPlaylistDownloadOptions((prev) => ({
                        ...prev,
                        qualityaudiovideo: value as "audio" | "video+audio",
                      }))
                    }
                  >
                    <SelectTrigger className="h-11">
                      <SelectValue placeholder="Select media type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="audio">
                        <div className="flex items-center gap-2">
                          <span>🎵</span>
                          Audio Only
                        </div>
                      </SelectItem>
                      <SelectItem value="video+audio">
                        <div className="flex items-center gap-2">
                          <span>🎥</span>
                          Video + Audio
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>

                  <Select
                    value={playlistDownloadOptions.quality}
                    onValueChange={(value) =>
                      setPlaylistDownloadOptions((prev) => ({
                        ...prev,
                        quality: value as any,
                      }))
                    }
                  >
                    <SelectTrigger className="h-11">
                      <SelectValue placeholder="Select quality" />
                    </SelectTrigger>
                    <SelectContent>
                      {["144p", "240p", "360p", "480p", "720p", "1080p"].map(
                        (q) => (
                          <SelectItem key={q} value={q}>
                            {q}
                          </SelectItem>
                        )
                      )}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <div className="flex items-start gap-2 p-3 bg-muted/30 rounded-lg text-xs">
                    <span className="text-yellow-500 mt-0.5">💡</span>
                    <span>
                      Start confirmation to view files in the selected directory.
                    </span>
                  </div>
                </div>
              </div>

              {/* Download Progress Bar */}
              {playlistDownloadLoading && downloadProgress.total > 0 && (
                <div className="space-y-3 p-4 bg-gradient-to-r from-primary/5 to-accent/5 rounded-lg border border-primary/20">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-foreground">
                      Downloading...
                    </span>
                    <span className="text-muted-foreground">
                      {downloadProgress.current} / {downloadProgress.total}
                    </span>
                  </div>

                  {/* Progress Bar */}
                  <div className="relative w-full h-3 bg-muted rounded-full overflow-hidden">
                    <div
                      className="absolute top-0 left-0 h-full bg-gradient-to-r from-primary to-accent transition-all duration-300 ease-out rounded-full"
                      style={{
                        width: `${(downloadProgress.current / downloadProgress.total) * 100}%`,
                      }}
                    />
                  </div>

                  {/* Current Video */}
                  {/* <div className="text-xs text-muted-foreground truncate">
                    <span className="font-medium">Current:</span> {downloadProgress.currentVideo}
                  </div> */}
                  <div className="text-xs text-muted-foreground truncate max-w-[250px]">
                    <span className="font-medium">Current:</span>{" "}
                    {downloadProgress.currentVideo}
                  </div>


                  {/* Success/Fail Counts */}
                  <div className="flex items-center gap-4 text-xs">
                    <div className="flex items-center gap-1">
                      <CheckCircle className="w-4 h-4 text-green-500" />
                      <span className="text-green-600 dark:text-green-400 font-medium">
                        {downloadProgress.successCount} succeeded
                      </span>
                    </div>
                    {downloadProgress.failCount > 0 && (
                      <div className="flex items-center gap-1">
                        <AlertCircle className="w-4 h-4 text-red-500" />
                        <span className="text-red-600 dark:text-red-400 font-medium">
                          {downloadProgress.failCount} failed
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Progress Preview (Optional) */}
              {/* {playlistDownloadLoading && (
                <div className="space-y-2 p-3 bg-destructive/5 border border-destructive/20 rounded-lg">
                  <div className="flex items-center gap-2 text-sm text-destructive">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Preparing {playlistData?.video_count || 0} downloads...
                  </div>
                  <div className="w-full bg-muted rounded-full h-2">
                    <div
                      className="bg-destructive h-2 rounded-full transition-all duration-300"
                      style={{ width: `${Math.min((downloadProgress || 0) * 100, 100)}%` }}
                    />
                  </div>
                </div>
              )} */}
            </div>

            <DialogFooter className="gap-3 pt-6">
              <Button
                variant="outline"
                onClick={() => setPlaylistDownloadOpen(false)}
                disabled={playlistDownloadLoading}
                className="px-4 h-11"
              >
                Cancel
              </Button>
              <Button
                onClick={downloadPlaylistVideos}
                disabled={playlistDownloadLoading || !playlistData}
                className="flex-1 h-11 gap-2 font-medium"
              >
                {playlistDownloadLoading ? (
                  downloadProgress.total > 0 ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Downloading...
                    </>
                  ) : (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Preparing...
                    </>
                  )
                ) : (
                  <>
                    <Download className="w-4 h-4" />
                    Download {playlistData?.video_count || 0} Videos
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <AlertDialog open={folderDialogOpen} onOpenChange={setFolderDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Select Download Folder</AlertDialogTitle>
              <AlertDialogDescription>
                We need your permission to access the folder where you want to save the videos.
                <br /><br />
                Please select a folder in the next step. Your browser will ask for confirmation to view files in the selected directory.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setFolderDialogOpen(false)}>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={performFolderSelection}>
                Continue to Select Folder
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <div className="mt-8 text-center text-sm text-muted-foreground space-y-2">
          <p>
            Connected to backend at de <code>{API_BASE}</code>
          </p>
          <p className="text-xs">
            Make sure your Django backend is running with CORS enabled
          </p>
        </div>
      </div>
    </div>
  );
};

export default Index;
