// Il ponte tra l'app per computer e le pagine di Natan: solo poche funzioni, niente accesso ai file.
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("natanDesktop", {
  versione: process.env.NATAN_APP_VERSION || "",
  piattaforma: process.platform,
  stato: (s) => { try { ipcRenderer.send("stato", JSON.parse(JSON.stringify(s || {}))); } catch (e) {} },
  apri: () => ipcRenderer.send("apri"),
  onComando: (cb) => ipcRenderer.on("comando", (_e, c) => { try { cb(c); } catch (e) {} }),
});
