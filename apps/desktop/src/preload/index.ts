import { contextBridge, ipcRenderer, webUtils } from "electron";

export interface RoughcutApi {
  /** Resolve the on-disk path of a dropped File (File.path was removed in Electron 32). */
  getPathForFile(file: File): string;
  selectVideo(): Promise<string | null>;
  selectSavePath(defaultPath: string): Promise<string | null>;
  openVideo(path: string): Promise<unknown>;
  exportCut(plan: unknown, opts: unknown): Promise<unknown>;
  savePlan(plan: unknown, defaultPath: string): Promise<string | null>;
  reveal(path: string): Promise<void>;
  onExportProgress(cb: (ratio: number) => void): () => void;
  onProxyReady(cb: (url: string) => void): () => void;
  onProxyProgress(cb: (ratio: number) => void): () => void;
  onThumbsReady(cb: (thumbs: { intervalSec: number; images: ArrayBuffer[] }) => void): () => void;
  onSmokeOpen(cb: (path: string) => void): () => void;
  smokeDone(): Promise<void>;
}

const api: RoughcutApi = {
  getPathForFile: (file) => webUtils.getPathForFile(file),
  selectVideo: () => ipcRenderer.invoke("dialog:selectVideo"),
  selectSavePath: (defaultPath) => ipcRenderer.invoke("dialog:selectSave", defaultPath),
  openVideo: (path) => ipcRenderer.invoke("session:open", path),
  exportCut: (plan, opts) => ipcRenderer.invoke("session:export", plan, opts),
  savePlan: (plan, defaultPath) => ipcRenderer.invoke("plan:save", plan, defaultPath),
  reveal: (path) => ipcRenderer.invoke("shell:reveal", path),
  onExportProgress: (cb) => {
    const listener = (_e: unknown, ratio: number) => cb(ratio);
    ipcRenderer.on("export:progress", listener);
    return () => ipcRenderer.removeListener("export:progress", listener);
  },
  onProxyReady: (cb) => {
    const listener = (_e: unknown, url: string) => cb(url);
    ipcRenderer.on("session:proxy-ready", listener);
    return () => ipcRenderer.removeListener("session:proxy-ready", listener);
  },
  onProxyProgress: (cb) => {
    const listener = (_e: unknown, ratio: number) => cb(ratio);
    ipcRenderer.on("session:proxy-progress", listener);
    return () => ipcRenderer.removeListener("session:proxy-progress", listener);
  },
  onThumbsReady: (cb) => {
    const listener = (_e: unknown, thumbs: { intervalSec: number; images: ArrayBuffer[] }) =>
      cb(thumbs);
    ipcRenderer.on("session:thumbs-ready", listener);
    return () => ipcRenderer.removeListener("session:thumbs-ready", listener);
  },
  onSmokeOpen: (cb) => {
    const listener = (_e: unknown, path: string) => cb(path);
    ipcRenderer.on("smoke:open", listener);
    return () => ipcRenderer.removeListener("smoke:open", listener);
  },
  smokeDone: () => ipcRenderer.invoke("smoke:done"),
};

contextBridge.exposeInMainWorld("roughcut", api);
