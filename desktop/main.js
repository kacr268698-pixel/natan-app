// Natan per computer (Windows, Mac, Linux).
// Una finestra con Natan + un aiutante che resta acceso vicino all'orologio anche con la finestra chiusa:
// risponde alle domande dei telefoni quando il server di Natan è occupato o spento, e tiene aggiornata la biblioteca.
// Chi usa il computer vede solo QUANTE persone ha aiutato, mai le loro domande.
const { app, BrowserWindow, Tray, Menu, nativeImage, shell, powerMonitor, powerSaveBlocker, ipcMain, session, Notification } = require("electron");
const path = require("path");
const fs = require("fs");

const CONF = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8")); } catch (e) { return {}; } })();
const SITO = (CONF.sito || "https://kacr268698-pixel.github.io/natan/").replace(/\/?$/, "/");
const APP_URL = SITO + "app/?desktop=1";
const ORIGINE = new URL(SITO).origin;
process.env.NATAN_APP_VERSION = app.getVersion();

// WebGPU: serve per far girare Natan sul computer (anche su Linux)
app.commandLine.appendSwitch("enable-unsafe-webgpu");
if (process.platform === "linux") app.commandLine.appendSwitch("enable-features", "Vulkan");
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-background-timer-throttling");
app.setAppUserModelId && app.setAppUserModelId("app.natan.tutor");

const NASCOSTO = process.argv.includes("--nascosto") || (process.platform === "darwin" && app.getLoginItemSettings().wasOpenedAsHidden);
let win = null, tray = null, esci = false, blocco = null, avvisato = false;
let stato = { on: false, aiutati: 0, job: false, test: false, biblioteca: 0 };

const PREF_FILE = () => path.join(app.getPath("userData"), "preferenze.json");
function pref() { try { return JSON.parse(fs.readFileSync(PREF_FILE(), "utf8")); } catch (e) { return {}; } }
function setPref(p) { try { fs.writeFileSync(PREF_FILE(), JSON.stringify(Object.assign(pref(), p))); } catch (e) {} }

if (!app.requestSingleInstanceLock()) { app.quit(); }
else app.on("second-instance", () => mostra());

function icona(nome) { return nativeImage.createFromPath(path.join(__dirname, nome)); }

function mostra() {
  if (!win) return crea(false);
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
  if (process.platform === "darwin" && app.dock) app.dock.show();
}

function crea(nascosto) {
  win = new BrowserWindow({
    width: 1200, height: 820, minWidth: 380, minHeight: 560, show: !nascosto, title: "Natan",
    backgroundColor: "#0b0b0f", autoHideMenuBar: true, icon: icona("tray.png"),
    webPreferences: { preload: path.join(__dirname, "preload.js"), backgroundThrottling: false, contextIsolation: true, sandbox: true, spellcheck: false },
  });
  win.removeMenu && process.platform !== "darwin" && win.removeMenu();
  carica();
  win.webContents.on("did-finish-load", () => {      // la pagina sa subito cosa ha scelto chi usa il computer
    if (!String(win.webContents.getURL()).startsWith(ORIGINE)) return;
    invia(pref().aiuto === false ? "aiuto-off" : "aiuto-auto");
    if (stato.pausa) invia("pausa");
  });
  win.webContents.on("did-fail-load", (_e, code, _d, url, isMain) => {
    if (isMain && code !== -3 && !String(url).startsWith("file:"))
      win.loadFile(path.join(__dirname, "offline.html"), { query: { torna: APP_URL } });
  });
  // i link verso altri siti si aprono nel browser normale, Natan resta nella sua finestra
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(ORIGINE) && !/\.(apk|exe|dmg|AppImage|zip)(\?|$)/i.test(url)) return { action: "allow" };
    shell.openExternal(url); return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith(ORIGINE) && !url.startsWith("file:")) { e.preventDefault(); shell.openExternal(url); }
  });
  win.on("close", (e) => {
    if (esci) return;
    e.preventDefault(); win.hide();
    if (process.platform === "darwin" && app.dock) app.dock.hide();
    if (!avvisato && !pref().avvisoChiusura) {
      avvisato = true; setPref({ avvisoChiusura: true });
      notifica("Natan resta acceso", "Continua ad aiutare i telefoni vicino all'orologio. Per chiuderlo davvero: icona di Natan → Esci.");
    }
  });
}

function carica() { win.loadURL(APP_URL).catch(() => {}); }

function notifica(titolo, testo) {
  try { if (Notification.isSupported()) new Notification({ title: titolo, body: testo, icon: icona("tray.png") }).show(); } catch (e) {}
}

function testoStato() {
  if (!stato.test) return "Il computer non aiuta ancora: apri Natan → Aiuta";
  if (stato.pausa) return "In pausa: il computer va a batteria";
  if (!stato.on) return "Aiuto spento";
  return (stato.job ? "Sta rispondendo a un telefono" : "Pronto ad aiutare") + ` · ${stato.aiutati} risposte date`;
}

function menu() {
  if (!tray) return;
  const p = pref();
  tray.setToolTip("Natan · " + testoStato());
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Apri Natan", click: mostra },
    { type: "separator" },
    { label: testoStato(), enabled: false },
    { label: "Aiuta i telefoni degli amici", type: "checkbox", checked: p.aiuto !== false,
      click: (i) => { setPref({ aiuto: i.checked }); invia(i.checked ? "aiuto-on" : "aiuto-off"); } },
    { label: "Aiuta anche a batteria", type: "checkbox", checked: !!p.batteria, click: (i) => { setPref({ batteria: i.checked }); batteria(); } },
    { label: "Avvia Natan con il computer", type: "checkbox", checked: p.avvio !== false, click: (i) => { setPref({ avvio: i.checked }); avvioAutomatico(); } },
    { type: "separator" },
    { label: "Esci", click: () => { esci = true; app.quit(); } },
  ]));
}

function invia(c) { try { win && win.webContents.send("comando", c); } catch (e) {} }

function avvioAutomatico() {
  const on = pref().avvio !== false;
  try {
    if (process.platform === "linux") {
      const dir = path.join(app.getPath("home"), ".config", "autostart"), f = path.join(dir, "natan.desktop");
      if (on) {
        fs.mkdirSync(dir, { recursive: true });
        const exe = process.env.APPIMAGE || process.execPath;
        fs.writeFileSync(f, `[Desktop Entry]\nType=Application\nName=Natan\nExec="${exe}" --nascosto\nX-GNOME-Autostart-enabled=true\n`);
      } else if (fs.existsSync(f)) fs.unlinkSync(f);
    } else {
      app.setLoginItemSettings({ openAtLogin: on, openAsHidden: true, args: ["--nascosto"] });
    }
  } catch (e) {}
}

function batteria() {
  const pausa = powerMonitor.isOnBatteryPower && powerMonitor.isOnBatteryPower() && !pref().batteria;
  if (pausa !== !!stato.pausa) { stato.pausa = pausa; invia(pausa ? "pausa" : "riprendi"); menu(); }
}

app.whenReady().then(() => {
  // permessi: microfono (chiamata con Natan), notifiche e appunti solo per le pagine di Natan
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb, det) => {
    const ok = String(det.requestingUrl || wc.getURL()).startsWith(ORIGINE) && ["media", "notifications", "clipboard-sanitized-write", "fullscreen", "persistent-storage"].includes(perm);
    cb(ok);
  });
  crea(NASCOSTO);
  tray = new Tray(icona(process.platform === "darwin" ? "tray-32.png" : "tray.png").resize({ width: process.platform === "win32" ? 16 : 18 }));
  tray.on("click", mostra); tray.on("double-click", mostra);
  menu();
  if (pref().primoAvvio === undefined) setPref({ primoAvvio: Date.now(), avvio: true, aiuto: true });
  avvioAutomatico();
  powerMonitor.on("on-battery", batteria); powerMonitor.on("on-ac", batteria);
  setTimeout(batteria, 8000);
  if (NASCOSTO && process.platform === "darwin" && app.dock) app.dock.hide();
});

ipcMain.on("stato", (_e, s) => {
  const prima = stato.job;
  stato = Object.assign(stato, s || {});
  if (stato.job && !prima && !blocco) blocco = powerSaveBlocker.start("prevent-app-suspension");
  if (!stato.job && blocco !== null) { try { powerSaveBlocker.stop(blocco); } catch (e) {} blocco = null; }
  menu();
});
ipcMain.on("apri", mostra);

app.on("activate", mostra);
app.on("before-quit", () => { esci = true; });
app.on("window-all-closed", () => { /* resta vicino all'orologio */ });
