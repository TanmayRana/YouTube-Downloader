export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";

/** Simple URL validation */
function isValidUrl(u?: string) {
  if (!u) return false;
  try {
    const url = new URL(u);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** Spawn helper */
function runCommand(cmd: string, args: string[], shell = false) {
  return new Promise<{ stdout: string; stderr: string; code: number | null }>(
    (resolve, reject) => {
      try {
        const proc = spawn(cmd, args, { shell, windowsHide: true });

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
    const res = await runCommand("yt-dlp", args, true);
    if (res.code === 0 && res.stdout) {
      return JSON.parse(res.stdout);
    }
    throw new Error(`yt-dlp failed (code ${res.code}): ${res.stderr}`);
  } catch (err: any) {
    const ytErr = String(err?.message ?? err);

    // 2) python -m yt_dlp
    try {
      const pyRes = await runCommand("python", ["-m", "yt_dlp", ...args], true);
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

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const url: string | undefined = body?.url;

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
      // handle bot / login protection hints
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
          detail: err,
        },
        { status: 502 }
      );
    }

    // ---------- formats_data (simple classification: audio, video, video+audio) ----------
    const formats_data: any[] = [];
    const formats = (info.formats ?? []) as any[];

    for (const f of formats || []) {
      if (!f || !f.url) continue;

      const vcodec = f.vcodec;
      const acodec = f.acodec;
      const size = f.filesize ?? f.filesize_approx;

      // Include formats even without filesize - YouTube doesn't always provide it upfront
      // UI will show "Unknown" for these formats

      const fmt_type =
        vcodec === "none"
          ? "audio"
          : acodec === "none"
            ? "video"
            : "video+audio";

      formats_data.push({
        format_id: f.format_id ?? f.itag ?? null,
        ext: f.ext ?? null,
        resolution:
          f.format_note ?? `${f.width ?? ""}x${f.height ?? ""}`.trim() ?? null,
        filesize: size,
        fps: f.fps ?? null,
        tbr: f.tbr ?? null,
        vcodec: vcodec ?? null,
        acodec: acodec ?? null,
        type: fmt_type,
      });
    }

    // ---------- thumbnail fallback (match Django logic) ----------
    let thumbnail = info.thumbnail as string | undefined;
    if (!thumbnail) {
      const thumbs = info.thumbnails ?? [];
      if (
        Array.isArray(thumbs) &&
        thumbs.length > 0 &&
        thumbs[0] &&
        typeof thumbs[0] === "object"
      ) {
        thumbnail = thumbs[0].url;
      }
    }

    // ---------- final response_data ----------
    const response_data = {
      id: info.id ?? null,
      title: info.title ?? info.fulltitle ?? null,
      thumbnail,
      duration: info.duration ?? null,
      uploader: info.uploader ?? null,
      channel: info.channel ?? null,
      webpage_url: info.webpage_url ?? url,
      formats: formats_data,
    };

    return NextResponse.json(response_data, { status: 200 });
  } catch (err: any) {
    console.error("analyze unexpected error:", err);
    return NextResponse.json(
      { error: "Internal server error", detail: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}
