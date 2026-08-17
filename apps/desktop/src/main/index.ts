import { createReadStream, statSync, writeFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import {
  BrowserWindow,
  app,
  dialog,
  ipcMain,
  protocol,
  shell,
} from "electron";
import { assertPlan, exportCut, normalizePlan, buildReport } from "@roughcut/core";
import { MediaSession, fromMediaUrl } from "./session.js";

const session = new MediaSession();

const smokeIndex = process.argv.indexOf("--smoke");
const SMOKE = smokeIndex >= 0;
const smokeVideo = SMOKE ? process.argv[smokeIndex + 1] : undefined;
/** With --smoke-play, start compact preview and capture a burst of frames. */
const SMOKE_PLAY = process.argv.includes("--smoke-play");
const SMOKE_OUT = resolve(process.cwd(), "smoke.png");

protocol.registerSchemesAsPrivileged([
  {
    scheme: "rcmedia",
    privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, bypassCSP: true },
  },
]);

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: "#131313",
    title: "RoughCut",
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.mjs"),
      contextIsolation: true,
      sandbox: false,
    },
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void win.loadFile(join(import.meta.dirname, "../renderer/index.html"));
  }
  return win;
}

/** Capture N frames during playback to prove the preview actually moves. */
async function captureSeries(win: BrowserWindow, count: number, gapMs: number): Promise<void> {
  for (let i = 1; i <= count; i++) {
    const out = resolve(process.cwd(), `smoke-play-${String(i).padStart(2, "0")}.png`);
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const image = await win.webContents.capturePage();
        if (image.isEmpty()) throw new Error("empty capture");
        writeFileSync(out, image.toPNG());
        console.log(`frame ${i}/${count} -> ${out}`);
        break;
      } catch (err) {
        console.error(`frame ${i} attempt ${attempt} failed:`, err);
        await new Promise((r) => setTimeout(r, 250));
      }
    }
    await new Promise((r) => setTimeout(r, gapMs));
  }
  app.exit(0);
}

async function captureSmoke(win: BrowserWindow): Promise<void> {
  // capturePage can transiently fail (compositor "UnknownVizError"); retry.
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      win.focus();
      const image = await win.webContents.capturePage();
      if (image.isEmpty()) throw new Error("empty capture");
      writeFileSync(SMOKE_OUT, image.toPNG());
      console.log(`smoke screenshot -> ${SMOKE_OUT}`);
      app.exit(0);
      return;
    } catch (err) {
      console.error(`smoke capture attempt ${attempt} failed:`, err);
      await new Promise((r) => setTimeout(r, 900));
    }
  }
  app.exit(1);
}

void app.whenReady().then(() => {
  const MIME: Record<string, string> = {
    ".mp4": "video/mp4",
    ".m4v": "video/mp4",
    ".mov": "video/quicktime",
    ".mkv": "video/x-matroska",
    ".webm": "video/webm",
    ".wav": "audio/wav",
    ".m4a": "audio/mp4",
    ".mp3": "audio/mpeg",
    ".flac": "audio/flac",
  };

  // Serve local media with proper HTTP Range support. Chromium's media stack
  // seeks by issuing Range requests; without a 206 response it assumes the
  // source is unseekable and every seek snaps back to 0 — which shows up as
  // "the preview freezes on the first frame".
  protocol.handle("rcmedia", (request) => {
    try {
      const filePath = fromMediaUrl(request.url);
      const stat = statSync(filePath);
      const mime = MIME[extname(filePath).toLowerCase()] ?? "application/octet-stream";
      const range = request.headers.get("Range");
      const m = range ? /bytes=(\d+)-(\d*)/.exec(range) : null;
      if (m) {
        const start = Number(m[1]);
        const end = m[2] ? Math.min(Number(m[2]), stat.size - 1) : stat.size - 1;
        if (start >= stat.size || end < start) {
          return new Response(null, {
            status: 416,
            headers: { "Content-Range": `bytes */${stat.size}` },
          });
        }
        const stream = Readable.toWeb(
          createReadStream(filePath, { start, end }),
        ) as ReadableStream;
        return new Response(stream, {
          status: 206,
          headers: {
            "Content-Type": mime,
            "Accept-Ranges": "bytes",
            "Content-Range": `bytes ${start}-${end}/${stat.size}`,
            "Content-Length": String(end - start + 1),
          },
        });
      }
      const stream = Readable.toWeb(createReadStream(filePath)) as ReadableStream;
      return new Response(stream, {
        status: 200,
        headers: {
          "Content-Type": mime,
          "Accept-Ranges": "bytes",
          "Content-Length": String(stat.size),
        },
      });
    } catch (err) {
      console.error(`[rcmedia] failed for ${request.url}:`, err);
      return new Response(`Bad media request: ${String(err)}`, { status: 400 });
    }
  });

  const win = createWindow();

  ipcMain.handle("dialog:selectVideo", async () => {
    const res = await dialog.showOpenDialog(win, {
      title: "选择口播视频",
      filters: [
        { name: "媒体文件", extensions: ["mp4", "mov", "mkv", "m4v", "webm", "wav", "mp3", "m4a", "flac"] },
        { name: "所有文件", extensions: ["*"] },
      ],
      properties: ["openFile"],
    });
    return res.canceled ? null : res.filePaths[0];
  });

  ipcMain.handle("dialog:selectSave", async (_e, defaultPath: string) => {
    const res = await dialog.showSaveDialog(win, {
      title: "导出成片",
      defaultPath,
      filters: [{ name: "MP4 视频", extensions: ["mp4"] }],
    });
    return res.canceled ? null : res.filePath;
  });

  ipcMain.handle("session:open", async (_e, path: string) => {
    return session.open(
      path,
      (url) => {
        if (!win.isDestroyed()) win.webContents.send("session:proxy-ready", url);
      },
      (ratio) => {
        if (!win.isDestroyed()) win.webContents.send("session:proxy-progress", ratio);
      },
      (thumbs) => {
        if (!win.isDestroyed()) win.webContents.send("session:thumbs-ready", thumbs);
      },
    );
  });

  ipcMain.handle("session:export", async (_e, planJson: unknown, opts: {
    output?: string;
    audioOutput?: string;
    crf?: number;
    preset?: string;
    writeReport?: boolean;
  }) => {
    const plan = normalizePlan(assertPlan(planJson));
    const result = await exportCut(plan, {
      output: opts.output,
      audioOutput: opts.audioOutput,
      crf: opts.crf,
      preset: opts.preset,
      onProgress: (ratio) => {
        if (!win.isDestroyed()) win.webContents.send("export:progress", ratio);
      },
    });
    const report = buildReport(plan, result);
    let reportPath: string | null = null;
    if (opts.writeReport !== false) {
      const base = opts.output ?? opts.audioOutput;
      if (base) {
        reportPath = `${base}.report.json`;
        writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
      }
    }
    return { ...result, reportPath };
  });

  ipcMain.handle("plan:save", async (_e, planJson: unknown, defaultPath: string) => {
    const res = await dialog.showSaveDialog(win, {
      title: "保存剪辑计划",
      defaultPath,
      filters: [{ name: "RoughCut 计划", extensions: ["json"] }],
    });
    if (res.canceled || !res.filePath) return null;
    writeFileSync(res.filePath, JSON.stringify(planJson, null, 2), "utf8");
    return res.filePath;
  });

  ipcMain.handle("shell:reveal", (_e, path: string) => {
    shell.showItemInFolder(path);
  });

  ipcMain.handle("app:info", () => ({
    version: app.getVersion(),
    platform: process.platform,
  }));

  // --- smoke mode -----------------------------------------------------------
  if (SMOKE) {
    win.webContents.on("console-message", (details) => {
      console.log(`[renderer:${details.level}] ${details.message}`);
    });
    const timeout = setTimeout(() => void captureSmoke(win), 25_000);
    ipcMain.handleOnce("smoke:done", async () => {
      clearTimeout(timeout);
      if (SMOKE_PLAY) {
        win.webContents.send("smoke:play");
        // Let playback spin up, then capture a burst across several seconds.
        setTimeout(() => void captureSeries(win, 8, 650), 900);
      } else {
        // Give the canvas one more frame to paint.
        setTimeout(() => void captureSmoke(win), 600);
      }
    });
    win.webContents.once("did-finish-load", () => {
      if (smokeVideo && !smokeVideo.startsWith("--")) {
        win.webContents.send("smoke:open", resolve(smokeVideo));
      } else {
        setTimeout(() => void captureSmoke(win), 2500);
      }
    });
  }
});

app.on("window-all-closed", () => {
  session.dispose();
  app.quit();
});
