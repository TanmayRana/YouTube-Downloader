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

/** Sanitize a filename to ASCII-only and remove illegal path chars */
function makeSafeFilename(name: string): string {
  return name
    .replace(/[\\\/:*?"<>|]/g, "") // remove invalid filename chars
    .replace(/[^\x20-\x7E]/g, "?") // replace non-ASCII with '?'
    .trim();
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

/** Build yt-dlp args similar to your Django YDL options */
function makeYtDlpArgs(url: string) {
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

/** Try yt-dlp binary, then python -m yt_dlp */
async function tryYtDlpJson(url: string) {
  const args = makeYtDlpArgs(url);

  // 1) yt-dlp executable
  try {
    const res = await runCommand("yt-dlp", args, false);
    if (res.code === 0 && res.stdout) {
      return JSON.parse(res.stdout);
    }
    throw new Error(`yt-dlp failed (code ${res.code}): ${res.stderr}`);
  } catch (err: any) {
    const ytErr = String(err?.message ?? err);

    // 2) python -m yt_dlp fallback
    try {
      const pyRes = await runCommand(
        "python",
        ["-m", "yt_dlp", ...args],
        false
      );
      if (pyRes.code === 0 && pyRes.stdout) {
        return JSON.parse(pyRes.stdout);
      }
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

/** pick_best like in Django code */
function pickBest(candidates: any[]) {
  if (!candidates || candidates.length === 0) return null;
  return candidates.reduce((best, f) => {
    const bestScore = (best?.tbr ?? best?.abr ?? 0) as number;
    const score = (f?.tbr ?? f?.abr ?? 0) as number;
    return score > bestScore ? f : best;
  });
}

/** normalize a format_id like "95-4" or "140-drc" -> "95" / "140" */
function normalizeFormatId(raw?: string | null) {
  if (!raw) return undefined;
  return raw.split("-")[0];
}

export async function GET(req: NextRequest) {
  try {
    const search = req.nextUrl.searchParams;

    const url = search.get("url");
    const rawFormatId = search.get("format_id");
    const normFormatId = normalizeFormatId(rawFormatId);
    let media_type = search.get("media_type") ?? undefined; // "audio" | "video" | "both"
    const custom_filename = search.get("filename") ?? undefined;

    if (!isValidUrl(url)) {
      return NextResponse.json(
        { error: "Invalid or missing URL" },
        { status: 400 }
      );
    }

    let info: any;
    try {
      info = await tryYtDlpJson(url!);
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
            hint: "This video requires authentication / bot verification. Configure YTDLP_COOKIE_FILE with a cookies.txt file.",
          },
          { status: 403 }
        );
      }
      return NextResponse.json(
        {
          error: "Failed to retrieve video information",
          detail: ytMsg,
        },
        { status: 502 }
      );
    }

    const formats: any[] = (info.formats ?? []) || [];

    // ---------- Decide which format_id we want ----------
    let selectedFormatId = normFormatId ?? rawFormatId ?? undefined;

    if (!selectedFormatId) {
      media_type = (media_type || "both").toLowerCase();
      let chosen: any = null;

      if (media_type === "audio") {
        const audio_formats = formats.filter((f) => f.vcodec === "none");
        chosen = pickBest(audio_formats);
      } else if (media_type === "video") {
        const video_only = formats.filter(
          (f) => f.acodec === "none" && f.vcodec && f.vcodec !== "none"
        );
        chosen = pickBest(video_only);
      } else {
        const both_av = formats.filter(
          (f) =>
            f.vcodec && f.vcodec !== "none" && f.acodec && f.acodec !== "none"
        );
        chosen = pickBest(both_av) || pickBest(formats);
      }

      if (!chosen) {
        return NextResponse.json(
          { error: "Could not determine a suitable format to download" },
          { status: 400 }
        );
      }

      selectedFormatId = String(chosen.format_id);
    }

    // ---------- Find selected format (tolerant to suffix) ----------
    const selected_format = formats.find((f) => {
      const fid = String(f.format_id);
      if (rawFormatId && fid === rawFormatId) return true; // exact
      if (normFormatId && fid === normFormatId) return true; // normalized
      if (rawFormatId && rawFormatId.startsWith(fid + "-")) return true; // "95-4" vs "95"
      return false;
    });

    if (!selected_format) {
      return NextResponse.json(
        { error: "Requested format_id not found" },
        { status: 400 }
      );
    }

    const direct_url = selected_format.url as string | undefined;
    if (!direct_url) {
      return NextResponse.json(
        {
          error: "No direct URL available for the requested format.",
        },
        { status: 500 }
      );
    }

    // ---------- Proxy stream so we can set a filename ----------
    const rangeHeader = req.headers.get("range") || undefined;
    const upstream = await fetch(direct_url, {
      headers: rangeHeader ? { Range: rangeHeader } : undefined,
      redirect: "follow",
    });

    if (!upstream.ok && upstream.status !== 206) {
      return NextResponse.json(
        {
          error: "Upstream responded with error",
          status_code: upstream.status,
        },
        { status: 502 }
      );
    }

    const respHeaders = new Headers();
    const contentType =
      upstream.headers.get("content-type") || "application/octet-stream";
    const contentLength = upstream.headers.get("content-length");
    const acceptRanges = upstream.headers.get("accept-ranges") || "bytes";
    const contentRange = upstream.headers.get("content-range");

    respHeaders.set("Content-Type", contentType);

    const rawTitle = String(info.title || "download");
    const safeTitle = makeSafeFilename(rawTitle) || "download";
    const ext =
      selected_format.ext ||
      (selected_format.acodec === "none" ? "mp3" : "mp4");
    const baseName = custom_filename
      ? makeSafeFilename(custom_filename)
      : safeTitle;
    const filename = baseName.includes(".") ? baseName : `${baseName}.${ext}`;

    respHeaders.set(
      "Content-Disposition",
      `attachment; filename="${filename}"`
    );
    if (contentLength) respHeaders.set("Content-Length", contentLength);
    if (acceptRanges) respHeaders.set("Accept-Ranges", acceptRanges);
    if (contentRange) respHeaders.set("Content-Range", contentRange);

    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: respHeaders,
    });
  } catch (err: any) {
    console.error("download handler error:", err);
    return NextResponse.json(
      {
        error: "Unexpected error while analyzing for download",
        detail: String(err),
      },
      { status: 500 }
    );
  }
}
