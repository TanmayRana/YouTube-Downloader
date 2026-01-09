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

/** Replace any non-Latin-1 chars with '?' so Windows ByteString APIs don't choke */
function toLatin1Safe(s: string): string {
  return s.replace(/[^\x00-\xff]/g, "?");
}

/** Build a safe environment with only Latin-1 values */
function buildSafeEnv(): NodeJS.ProcessEnv {
  const requiredEnv: NodeJS.ProcessEnv = {
    NODE_ENV: process.env.NODE_ENV || "development",
    PATH: process.env.PATH || "",
  };

  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value !== "string") continue;
    if (key === "NODE_ENV" || key === "PATH") continue;
    if (/^[\x00-\xff]*$/.test(value)) {
      requiredEnv[key] = value;
    }
  }
  return requiredEnv;
}

/** Spawn helper with sanitized env (fixes ByteString error on Windows) */
function runCommand(cmd: string, args: string[], shell = false) {
  const safeArgs = args.map(toLatin1Safe);
  console.log("SPAWN:", cmd, safeArgs.join(" "));

  return new Promise<{ stdout: string; stderr: string; code: number | null }>(
    (resolve, reject) => {
      try {
        const proc = spawn(cmd, safeArgs, {
          shell,
          windowsHide: true,
          env: buildSafeEnv(),
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

/** Build yt-dlp args for playlist (flat like extract_flat=True) */
function makeYtDlpPlaylistArgs(url: string) {
  // --flat-playlist -> lightweight entries, -J -> JSON, --skip-download -> no media download
  const safeUrl = toLatin1Safe(url);
  const args = [
    "--flat-playlist",
    "-J",
    "--no-warnings",
    "--skip-download",
    safeUrl,
  ];
  const cookieFile = process.env.YTDLP_COOKIE_FILE;
  if (cookieFile) {
    const abs = path.resolve(toLatin1Safe(cookieFile));
    if (fs.existsSync(abs)) {
      args.unshift("--cookies", abs);
    }
  }
  return args;
}

/** Try yt-dlp binary, then python -m yt_dlp for playlist */
async function tryYtDlpPlaylistJson(url: string) {
  const args = makeYtDlpPlaylistArgs(url);

  // 1) yt-dlp executable
  try {
    const res = await runCommand("yt-dlp", args, false);
    if (res.code === 0 && res.stdout) {
      return JSON.parse(res.stdout);
    }
    throw new Error(`yt-dlp failed (code ${res.code}): ${res.stderr}`);
  } catch (err: any) {
    const ytErr = String(err?.message ?? err);

    // 2) python -m yt_dlp
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

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get("content-type") || "";
    let url: string | undefined;

    if (contentType.includes("application/json")) {
      const body = await req.json().catch(() => ({} as any));
      url = typeof body?.url === "string" ? body.url : undefined;
    } else {
      // support form-data / x-www-form-urlencoded
      const fd = await req.formData().catch(() => null);
      const raw = fd?.get("url");
      url = typeof raw === "string" ? raw : undefined;
    }

    if (!isValidUrl(url)) {
      return NextResponse.json(
        { error: "Missing or invalid 'url' parameter" },
        { status: 400 }
      );
    }

    let info: any;
    try {
      info = await tryYtDlpPlaylistJson(url!);
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

    const entries: any[] = (info.entries ?? []) || [];
    const videos = entries.map((entry) => {
      const video_title = entry.title || "<<unavailable or removed video>>";
      const video_id = entry.id || "";
      let video_url = entry.url || entry.webpage_url || "";

      if (!video_url && video_id) {
        video_url = `https://www.youtube.com/watch?v=${video_id}`;
      }

      return {
        title: video_title,
        id: video_id,
        url: video_url,
      };
    });

    // Try to find a thumbnail at playlist level
    let thumbnail: string | undefined = info.thumbnail;
    if (
      !thumbnail &&
      Array.isArray(info.thumbnails) &&
      info.thumbnails.length
    ) {
      const first = info.thumbnails[0];
      if (first && typeof first === "object" && first.url) {
        thumbnail = first.url;
      }
    }

    const response = {
      video_count: videos.length,
      videos,
      id: info.id ?? null,
      title: info.title ?? null,
      thumbnail,
      uploader: info.uploader ?? null,
      channel: info.channel ?? null,
      webpage_url: info.webpage_url ?? url,
    };

    return NextResponse.json(response, { status: 200 });
  } catch (err: any) {
    console.error("playlist handler error:", err);
    return NextResponse.json(
      { error: "Internal server error", detail: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}
