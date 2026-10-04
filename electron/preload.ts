import { contextBridge, ipcRenderer } from "electron";
import type { Bridge } from "../src/core/types.ts";
const api: Bridge = {
  snapshot: () => ipcRenderer.invoke("app:snapshot"),
  command: (command) => ipcRenderer.invoke("app:command", command),
  bounds: (bounds) => ipcRenderer.invoke("browser:bounds", bounds),
  onChange: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("app:changed", listener);
    return () => ipcRenderer.removeListener("app:changed", listener);
  },
};
contextBridge.exposeInMainWorld("masterChat", api);
