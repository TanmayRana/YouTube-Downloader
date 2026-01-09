export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";

/** Simple URL validation */
function isValidUrl(u?: string | null) {
  if (!u) return false;
  try {
    const url = new URL(u);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** Spawn helper with sanitized env (fixes ByteString error on Windows) */
function runCommand(cmd: string, args: string[], shell = false) {
  const cleanEnv: NodeJS.ProcessEnv = {
    NODE_ENV: process.env.NODE_ENV || "development",
    PATH: process.env.PATH || "",
  };
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value !== "string") continue;
    if (key === "NODE_ENV" || key === "PATH") continue;
    if (/^[\x00-\xff]*$/.test(value)) {
      cleanEnv[key] = value;
    }
  }

  return new Promise<{ stdout: string; stderr: string; code: number | null }>(
    (resolve, reject) => {
      try {
        const proc = spawn(cmd, args, {
          shell,
          windowsHide: true,
          env: cleanEnv,
        });

        let stdout = "";
        let stderr = "";

        proc.stdout.on("data", (d) => (stdout += d.toString()));
        proc.stderr.on("data", (d) => (stderr += d.toString()));

        proc.on("error", (err) => reject(err));
        proc.on("close", (code) => resolve({ stdout, stderr, code }));
      } catch (err) {
        reject(err);
      }
    }
  );
}

/** Build yt-dlp args for playlist (flat) */
function makeYtDlpPlaylistArgs(url: string) {
  const args = [
    "--flat-playlist",
    "-J",
    "--no-warnings",
    "--skip-download",
    url,
  ];
  const cookieFile = process.env.YTDLP_COOKIE_FILE;
  if (cookieFile) {
    const abs = path.resolve(cookieFile);
    if (fs.existsSync(abs)) {
      args.unshift("--cookies", abs);
    }
  }
  return args;
}

/** Build yt-dlp args for single video */
function makeYtDlpVideoArgs(url: string) {
  const args = ["-J", "--no-warnings", "--skip-download", url];
  const cookieFile = process.env.YTDLP_COOKIE_FILE;
  if (cookieFile) {
    const abs = path.resolve(cookieFile);
    if (fs.existsSync(abs)) {
      args.unshift("--cookies", abs);
    }
  }
  return args;
}

/** Try yt-dlp for playlist (flat) */
async function tryYtDlpPlaylistJson(url: string) {
  const args = makeYtDlpPlaylistArgs(url);

  try {
    const res = await runCommand("yt-dlp", args, false);
    if (res.code === 0 && res.stdout) return JSON.parse(res.stdout);
    throw new Error(`yt-dlp failed (code ${res.code}): ${res.stderr}`);
  } catch (err: any) {
    const ytErr = String(err?.message ?? err);
    try {
      const pyRes = await runCommand(
        "python",
        ["-m", "yt_dlp", ...args],
        false
      );
      if (pyRes.code === 0 && pyRes.stdout) return JSON.parse(pyRes.stdout);
      throw new Error(
        `python -m yt_dlp failed (code ${pyRes.code}): ${pyRes.stderr}`
      );
    } catch (pyErr: any) {
      const pyMsg = String(pyErr?.message ?? pyErr);
      throw {
        yt_dlp_attempt: ytErr,
        python_attempt: pyMsg,
      };
    }
  }
}

/** Try yt-dlp for single video */
async function tryYtDlpVideoJson(url: string) {
  const args = makeYtDlpVideoArgs(url);

  try {
    const res = await runCommand("yt-dlp", args, false);
    if (res.code === 0 && res.stdout) return JSON.parse(res.stdout);
    throw new Error(`yt-dlp failed (code ${res.code}): ${res.stderr}`);
  } catch (err: any) {
    const ytErr = String(err?.message ?? err);
    try {
      const pyRes = await runCommand(
        "python",
        ["-m", "yt_dlp", ...args],
        false
      );
      if (pyRes.code === 0 && pyRes.stdout) return JSON.parse(pyRes.stdout);
      throw new Error(
        `python -m yt_dlp failed (code ${pyRes.code}): ${pyRes.stderr}`
      );
    } catch (pyErr: any) {
      const pyMsg = String(pyErr?.message ?? pyErr);
      throw {
        yt_dlp_attempt: ytErr,
        python_attempt: pyMsg,
      };
    }
  }
}

/** Map quality string to target height */
function qualityToHeight(q?: string | null): number | null {
  if (!q) return null;
  const v = q.toLowerCase();
  if (v === "144p") return 144;
  if (v === "240p") return 240;
  if (v === "360p") return 360;
  if (v === "480p") return 480;
  if (v === "720p") return 720;
  if (v === "1080p") return 1080;
  if (v === "1440p") return 1440;
  if (v === "4k" || v === "2160p") return 2160;
  return null;
}

/** Choose best audio-only format (prefer m4a/mp4, highest abr/tbr) */
function chooseAudioFormat(formats: any[]) {
  const audioOnly = formats.filter((f) => f.vcodec === "none");
  if (audioOnly.length === 0) return null;

  const scored = audioOnly.map((f) => {
    const ext = (f.ext || "").toLowerCase();
    const prefScore = ext === "m4a" || ext === "mp4" ? 10 : 0;
    const abr = f.abr ?? f.tbr ?? 0;
    return { f, score: prefScore * 1_000_000 + abr };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0].f;
}

/** Choose best video+audio format for a target height */
function chooseVideoAudioFormat(formats: any[], targetHeight: number | null) {
  const both = formats.filter(
    (f) =>
      (f.vcodec && f.vcodec !== "none" && f.acodec && f.acodec !== "none") ||
      // Explicitly allow known HLS combined formats (91-96 are 144p-1080p HLS)
      ["91", "92", "93", "94", "95", "96"].includes(String(f.format_id))
  );
  if (both.length === 0) return null;

  if (targetHeight == null) {
    // no quality -> highest tbr
    return both.reduce((best, f) => {
      const bestScore = best?.tbr ?? best?.abr ?? 0;
      const score = f.tbr ?? f.abr ?? 0;
      return score > bestScore ? f : best;
    });
  }

  // closest height to target, then highest tbr
  let best: any = null;
  let bestDist = Infinity;
  let bestScore = -Infinity;

  for (const f of both) {
    const h = f.height ?? null;
    if (!h) continue;
    const dist = Math.abs(h - targetHeight);
    const score = f.tbr ?? f.abr ?? 0;
    if (dist < bestDist || (dist === bestDist && score > bestScore)) {
      best = f;
      bestDist = dist;
      bestScore = score;
    }
  }

  if (!best) {
    return both.reduce((b, f) => {
      const s1 = b?.tbr ?? b?.abr ?? 0;
      const s2 = f.tbr ?? f.abr ?? 0;
      return s2 > s1 ? f : b;
    });
  }

  return best;
}

/** Django-style format mapping */
function mapFormatDjangoStyle(
  f: any,
  fmtType: "audio" | "video" | "video+audio"
) {
  return {
    format_id: f.format_id, // can be "140-drc"
    ext: f.ext ?? null,
    resolution:
      f.format_note || `${f.width ?? ""}x${f.height ?? ""}`.trim() || null,
    filesize: f.filesize ?? f.filesize_approx ?? null,
    fps: f.fps ?? null,
    tbr: f.tbr ?? null,
    vcodec: f.vcodec ?? null,
    acodec: f.acodec ?? null,
    type: fmtType,
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({} as any));
    const playlistUrl: string | undefined =
      typeof body?.url === "string" ? body.url : undefined;
    const media_type_raw: string | undefined =
      typeof body?.media_type === "string" ? body.media_type : undefined;
    const quality_raw: string | undefined =
      typeof body?.quality === "string" ? body.quality : undefined;

    if (!isValidUrl(playlistUrl)) {
      return NextResponse.json(
        { error: "Missing or invalid 'url' parameter" },
        { status: 400 }
      );
    }

    const media_type = (media_type_raw || "video+audio").toLowerCase(); // "audio" | "video+audio"
    const targetHeight =
      media_type === "video+audio" ? qualityToHeight(quality_raw) : null;

    let playlistInfo: any;
    try {
      playlistInfo = await tryYtDlpPlaylistJson(playlistUrl!);
    } catch (err: any) {
      const ytMsg = JSON.stringify(err);
      if (
        ytMsg.includes("Sign in to confirm you’re not a bot") ||
        ytMsg.includes("Sign in to confirm you're not a bot")
      ) {
        return NextResponse.json(
          {
            error: "YouTube is blocking this request",
            detail: ytMsg,
            hint: "This playlist requires authentication / bot verification. Configure YTDLP_COOKIE_FILE with a cookies.txt file.",
          },
          { status: 403 }
        );
      }
      return NextResponse.json(
        {
          error: "Failed to retrieve playlist information",
          detail: ytMsg,
        },
        { status: 502 }
      );
    }

    const origin = req.nextUrl.origin; // e.g. http://localhost:3000
    const entries: any[] = (playlistInfo.entries ?? []) || [];

    const results: any[] = [];

    for (const entry of entries) {
      const video_title = entry.title || "<<unavailable or removed video>>";
      const video_id = entry.id || "";
      let video_url = entry.url || entry.webpage_url || "";

      if (!video_url && video_id) {
        video_url = `https://www.youtube.com/watch?v=${video_id}`;
      }

      if (!isValidUrl(video_url)) {
        results.push({
          title: video_title,
          id: video_id,
          url: video_url,
          error: "Invalid video URL, skipped",
        });
        continue;
      }

      try {
        const info = await tryYtDlpVideoJson(video_url);
        const formats: any[] = (info.formats ?? []) || [];

        let chosen: any = null;
        let fmtType: "audio" | "video" | "video+audio" = "video+audio";

        if (media_type === "audio") {
          chosen = chooseAudioFormat(formats);
          fmtType = "audio";
        } else {
          chosen = chooseVideoAudioFormat(formats, targetHeight);
          fmtType = "video+audio";
        }

        if (!chosen || !chosen.format_id) {
          results.push({
            title: video_title,
            id: video_id,
            url: video_url,
            error: "No matching format found",
          });
          continue;
        }

        const format_id = String(chosen.format_id); // may be "140-drc"

        // /api/download already strips "-drc" internally
        const params = new URLSearchParams({
          url: video_url,
          format_id,
        });
        const download_url = `${origin}/api/download?${params.toString()}`;

        const format_data = mapFormatDjangoStyle(chosen, fmtType);

        results.push({
          title: video_title,
          id: video_id,
          url: video_url,
          format: format_data,
          download_url,
        });
      } catch (e: any) {
        results.push({
          title: video_title,
          id: video_id,
          url: video_url,
          error: String(e?.message ?? e),
        });
      }
    }

    let thumbnail: string | undefined = playlistInfo.thumbnail;
    if (
      !thumbnail &&
      Array.isArray(playlistInfo.thumbnails) &&
      playlistInfo.thumbnails.length
    ) {
      const first = playlistInfo.thumbnails[0];
      if (first && typeof first === "object" && first.url) {
        thumbnail = first.url;
      }
    }

    const response = {
      playlist: {
        id: playlistInfo.id ?? null,
        title: playlistInfo.title ?? null,
        thumbnail,
        uploader: playlistInfo.uploader ?? null,
        channel: playlistInfo.channel ?? null,
        webpage_url: playlistInfo.webpage_url ?? playlistUrl,
      },
      media_type,
      quality: quality_raw ?? null,
      video_count: results.length,
      videos: results,
    };

    return NextResponse.json(response, { status: 200 });
  } catch (err: any) {
    console.error("playlist-download handler error:", err);
    return NextResponse.json(
      { error: "Internal server error", detail: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}
