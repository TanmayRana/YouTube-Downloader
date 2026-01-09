// // app/api/_lib/yt.ts
// import { execFile } from "child_process";
// import { promisify } from "util";
// import path from "path";
// import fs from "fs";

// const execFileAsync = promisify(execFile);

// const MAX_STDOUT = 30 * 1024 * 1024; // 30 MB

// function safeJSONParse(s: string) {
//   try {
//     return JSON.parse(s);
//   } catch (e) {
//     return null;
//   }
// }

// function isValidCookieFile(p?: string) {
//   if (!p) return false;
//   try {
//     const abs = path.resolve(p);
//     return fs.existsSync(abs) && fs.statSync(abs).isFile();
//   } catch {
//     return false;
//   }
// }

// /**
//  * Run yt-dlp and return parsed JSON.
//  * Tries yt-dlp-exec (npm) if available; otherwise runs system 'yt-dlp'.
//  * Retries a couple times for transient failures.
//  */
// export async function runYtDlpJson(
//   url: string,
//   opts: { cookieFile?: string; flat?: boolean; timeoutMs?: number } = {}
// ) {
//   const cookieFile =
//     opts.cookieFile && isValidCookieFile(opts.cookieFile)
//       ? opts.cookieFile
//       : undefined;
//   const baseArgs = [];
//   if (opts.flat) baseArgs.push("--flat-playlist");
//   baseArgs.push("-j", "--no-warnings", "--skip-download", url);

//   const tryExec = async (cmd: string, args: string[]) => {
//     const execOpts: any = { maxBuffer: MAX_STDOUT };
//     if (opts.timeoutMs) execOpts.timeout = opts.timeoutMs;
//     const { stdout } = await execFileAsync(cmd, args, execOpts);
//     return stdout;
//   };

//   // If yt-dlp-exec installed, prefer it (it will be at node_modules/.bin/yt-dlp)
//   const localExec = path.join(process.cwd(), "node_modules", ".bin", "yt-dlp");
//   const commandsToTry = [];

//   // try local bin (npm-installed)
//   if (fs.existsSync(localExec)) commandsToTry.push(localExec);
//   // try system command
//   commandsToTry.push("yt-dlp");

//   let lastErr: any = null;
//   for (const cmd of commandsToTry) {
//     const args = cookieFile
//       ? ["--cookies", cookieFile, ...baseArgs]
//       : baseArgs.slice();
//     try {
//       const out = await tryExec(cmd, args);
//       const parsed = safeJSONParse(out);
//       if (parsed) return parsed;
//       // sometimes yt-dlp prints multiple JSON lines; attempt parse first line
//       const firstLine = out.split("\n").find(Boolean);
//       if (firstLine) {
//         const p2 = safeJSONParse(firstLine);
//         if (p2) return p2;
//       }
//       // fallback: return raw output in error
//       throw new Error("yt-dlp returned invalid JSON");
//     } catch (err) {
//       lastErr = err;
//       // try next command
//     }
//   }

//   // If nothing worked, throw
//   const e = new Error("yt-dlp invocation failed: " + String(lastErr));
//   (e as any).inner = lastErr;
//   throw e;
// }

// export function sanitizeFilename(name: string) {
//   // remove control chars and reserved windows chars
//   return name.replace(/[\x00-\x1f<>:"/\\|?*\u2028\u2029]/g, "").trim();
// }

// export function chooseExtension(format: any) {
//   if (format && format.ext) return format.ext;
//   if (format && format.acodec === "none") return "mp3";
//   return "mp4";
// }

// app/api/_lib/yt.ts
// import { execFile } from "child_process";
// import { promisify } from "util";
// import path from "path";
// import fs from "fs";

// const execFileAsync = promisify(execFile);
// const MAX_STDOUT = 30 * 1024 * 1024; // 30 MB

// function safeJSONParse(s: string | undefined) {
//   if (!s) return null;
//   try {
//     return JSON.parse(s);
//   } catch {
//     return null;
//   }
// }

// function isValidCookieFile(p?: string) {
//   if (!p) return false;
//   try {
//     const abs = path.resolve(p);
//     return fs.existsSync(abs) && fs.statSync(abs).isFile();
//   } catch {
//     return false;
//   }
// }

// /**
//  * Try to run yt-dlp in several ways:
//  * 1) prefer require('yt-dlp-exec') if installed (uses bundled binary)
//  * 2) try local node_modules/.bin/yt-dlp
//  * 3) try system 'yt-dlp'
//  *
//  * Returns parsed JSON (yt-dlp -j). Throws on failure.
//  */
// export async function runYtDlpJson(
//   url: string,
//   opts: { cookieFile?: string; flat?: boolean; timeoutMs?: number } = {}
// ) {
//   const cookieFile =
//     opts.cookieFile && isValidCookieFile(opts.cookieFile)
//       ? opts.cookieFile
//       : undefined;
//   const baseArgs = [];
//   if (opts.flat) baseArgs.push("--flat-playlist");
//   baseArgs.push("-j", "--no-warnings", "--skip-download", url);

//   const makeArgs = (cmdCookie?: string) =>
//     cmdCookie ? ["--cookies", cmdCookie, ...baseArgs] : baseArgs.slice();

//   // 1) try using yt-dlp-exec via require (preferred)
//   try {
//     // require at runtime so code doesn't crash if not installed
//     // eslint-disable-next-line @typescript-eslint/no-var-requires
//     const ytDlpExec = require("yt-dlp-exec");
//     // yt-dlp-exec supports a promise-style: ytDlpExec(args, { ... })
//     const args = makeArgs(cookieFile);
//     const spawnRes: any = await ytDlpExec(args, {
//       stdio: "pipe",
//       maxBuffer: MAX_STDOUT,
//     });
//     // yt-dlp-exec may return a string or object; ensure JSON parse
//     const out =
//       typeof spawnRes === "string" ? spawnRes : spawnRes?.stdout ?? "";
//     const parsed = safeJSONParse(out);
//     if (parsed) return parsed;
//     // sometimes multiple JSON lines; pick first non-empty
//     const first = (out || "").split("\n").find(Boolean);
//     if (first) {
//       const p2 = safeJSONParse(first);
//       if (p2) return p2;
//     }
//     throw new Error("yt-dlp-exec returned invalid JSON");
//   } catch (e) {
//     // swallow and fall back
//   }

//   // Helper to run an executable command
//   const tryExecCmd = async (cmd: string) => {
//     const args = makeArgs(cookieFile);
//     const execOpts: any = { maxBuffer: MAX_STDOUT };
//     if (opts.timeoutMs) execOpts.timeout = opts.timeoutMs;
//     const { stdout } = await execFileAsync(cmd, args, execOpts);
//     return stdout;
//   };

//   // 2) try local node_modules/.bin/yt-dlp (npm-installed binary)
//   try {
//     const localBin = path.join(
//       process.cwd(),
//       "node_modules",
//       ".bin",
//       process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp"
//     );
//     if (fs.existsSync(localBin)) {
//       const out = await tryExecCmd(localBin);
//       const parsed = safeJSONParse(out);
//       if (parsed) return parsed;
//       const first = (out || "").split("\n").find(Boolean);
//       if (first) {
//         const p2 = safeJSONParse(first);
//         if (p2) return p2;
//       }
//       throw new Error("local yt-dlp returned invalid JSON");
//     }
//   } catch (e) {
//     // fall through
//   }

//   // 3) try system 'yt-dlp'
//   try {
//     const out = await tryExecCmd("yt-dlp");
//     const parsed = safeJSONParse(out);
//     if (parsed) return parsed;
//     const first = (out || "").split("\n").find(Boolean);
//     if (first) {
//       const p2 = safeJSONParse(first);
//       if (p2) return p2;
//     }
//     throw new Error("system yt-dlp returned invalid JSON");
//   } catch (err) {
//     const e = new Error("yt-dlp invocation failed: " + String(err));
//     // attach inner error for logging if needed
//     (e as any).inner = err;
//     throw e;
//   }
// }

// export function sanitizeFilename(name: string) {
//   return name.replace(/[\x00-\x1f<>:"/\\|?*\u2028\u2029]/g, "").trim();
// }

// export function chooseExtension(format: any) {
//   if (format && format.ext) return format.ext;
//   if (format && format.acodec === "none") return "mp3";
//   return "mp4";
// }

// app/api/_lib/yt.ts
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs";

const execFileAsync = promisify(execFile);
const MAX_STDOUT = 30 * 1024 * 1024; // 30 MB

function toStr(v: unknown): string {
  if (typeof v === "string") return v;
  // Node Buffer type -> call toString
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (v && typeof (v as any).toString === "function")
    return (v as any).toString("utf8");
  return String(v ?? "");
}

function safeJSONParse(s: unknown) {
  const str = toStr(s);
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

function isValidCookieFile(p?: string) {
  if (!p) return false;
  try {
    const abs = path.resolve(p);
    return fs.existsSync(abs) && fs.statSync(abs).isFile();
  } catch {
    return false;
  }
}

/** Normalize execFile stdout (string | Buffer) to string safely */
async function tryExecCmd(cmd: string, args: string[], timeoutMs?: number) {
  const execOpts: any = { maxBuffer: MAX_STDOUT };
  if (timeoutMs) execOpts.timeout = timeoutMs;
  // Important: do NOT set encoding here if you want Buffer; we handle both.
  const { stdout } = await execFileAsync(cmd, args, execOpts);
  return toStr(stdout);
}

/**
 * Run yt-dlp and return parsed JSON. Tries multiple invocation strategies.
 */
export async function runYtDlpJson(
  url: string,
  opts: { cookieFile?: string; flat?: boolean; timeoutMs?: number } = {}
) {
  const cookieFile =
    opts.cookieFile && isValidCookieFile(opts.cookieFile)
      ? opts.cookieFile
      : undefined;
  const baseArgs: any = [];
  if (opts.flat) baseArgs.push("--flat-playlist");
  baseArgs.push("-j", "--no-warnings", "--skip-download", url);

  const makeArgs = (cmdCookie?: string) =>
    cmdCookie ? ["--cookies", cmdCookie, ...baseArgs] : baseArgs.slice();

  // 1) Try yt-dlp-exec if available (require at runtime)
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-explicit-any
    const ytDlpExec: any = require("yt-dlp-exec");
    const args = makeArgs(cookieFile);
    // yt-dlp-exec often returns a Promise<string> or { stdout } style; normalize:
    const execRes = await ytDlpExec(args, {
      stdio: "pipe",
      maxBuffer: MAX_STDOUT,
    });
    const out = toStr(execRes && (execRes.stdout ?? execRes)); // covers both shapes
    const parsed = safeJSONParse(out);
    if (parsed) return parsed;

    const first = out.split("\n").find(Boolean);
    if (first) {
      const p2 = safeJSONParse(first);
      if (p2) return p2;
    }
    throw new Error("yt-dlp-exec returned invalid JSON");
  } catch {
    // fallthrough to next strategies
  }

  // 2) Try local node_modules/.bin/yt-dlp
  try {
    const localBin = path.join(
      process.cwd(),
      "node_modules",
      ".bin",
      process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp"
    );
    if (fs.existsSync(localBin)) {
      const out = await tryExecCmd(
        localBin,
        makeArgs(cookieFile),
        opts.timeoutMs
      );
      const parsed = safeJSONParse(out);
      if (parsed) return parsed;
      const first = out.split("\n").find(Boolean);
      if (first) {
        const p2 = safeJSONParse(first);
        if (p2) return p2;
      }
      throw new Error("local yt-dlp returned invalid JSON");
    }
  } catch {
    // fallthrough
  }

  // 3) Try system 'yt-dlp'
  try {
    const out = await tryExecCmd(
      "yt-dlp",
      makeArgs(cookieFile),
      opts.timeoutMs
    );
    const parsed = safeJSONParse(out);
    if (parsed) return parsed;
    const first = out.split("\n").find(Boolean);
    if (first) {
      const p2 = safeJSONParse(first);
      if (p2) return p2;
    }
    throw new Error("system yt-dlp returned invalid JSON");
  } catch (err) {
    const e = new Error("yt-dlp invocation failed: " + String(err));
    (e as any).inner = err;
    throw e;
  }
}

export function sanitizeFilename(name: string) {
  return name.replace(/[\x00-\x1f<>:"/\\|?*\u2028\u2029]/g, "").trim();
}

export function chooseExtension(format: any) {
  if (format && format.ext) return format.ext;
  if (format && format.acodec === "none") return "mp3";
  return "mp4";
}
