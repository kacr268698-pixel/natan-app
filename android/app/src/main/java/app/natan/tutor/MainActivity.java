package app.natan.tutor;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.View;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

/** Natan per Android: l'app vera, con Natan dentro (niente barre del browser). */
public class MainActivity extends Activity {
    private static final int FOTO = 11, MICROFONO = 12;
    private WebView web;
    private ValueCallback<Uri[]> attesaFoto;
    private PermissionRequest attesaMicrofono;
    private String sito;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle stato) {
        super.onCreate(stato);
        sito = BuildConfig.SITO.endsWith("/") ? BuildConfig.SITO : BuildConfig.SITO + "/";
        web = new WebView(this);
        web.setBackgroundColor(0xFF15161C);
        setContentView(web);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setSupportMultipleWindows(false);
        s.setUserAgentString(s.getUserAgentString() + " NatanAndroid/" + BuildConfig.VERSION_NAME);
        CookieManager.getInstance().setAcceptCookie(true);
        web.addJavascriptInterface(new Ponte(), "NatanAndroid");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                Uri u = r.getUrl();
                String url = u.toString();
                if (url.startsWith(sito) && !url.matches(".*\\.(apk|exe|dmg|AppImage)(\\?.*)?$")) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception e) { }
                return true;
            }

            @Override
            public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {
                if (r.isForMainFrame()) v.loadUrl("file:///android_asset/offline.html");
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams p) {
                if (attesaFoto != null) attesaFoto.onReceiveValue(null);
                attesaFoto = cb;
                try { startActivityForResult(p.createIntent(), FOTO); }
                catch (Exception e) { attesaFoto = null; return false; }
                return true;
            }

            @Override
            public void onPermissionRequest(PermissionRequest r) {
                runOnUiThread(() -> {
                    if (!r.getOrigin().toString().startsWith(Uri.parse(sito).getScheme() + "://" + Uri.parse(sito).getHost())) { r.deny(); return; }
                    if (Build.VERSION.SDK_INT >= 23 && checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                        attesaMicrofono = r;
                        requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, MICROFONO);
                    } else r.grant(r.getResources());
                });
            }
        });

        // i file creati da Natan (documenti, PDF, presentazioni) arrivano come blob: li salvo nei Download
        web.setDownloadListener((url, ua, cd, mime, len) -> {
            if (url.startsWith("blob:")) {
                web.evaluateJavascript("(async()=>{const r=await fetch('" + url + "');const b=await r.blob();const f=new FileReader();" +
                        "f.onload=()=>NatanAndroid.salva(f.result.split(',')[1],document.__natanNome||'Natan-file','" + (mime == null ? "" : mime) + "');f.readAsDataURL(b)})()", null);
            } else {
                try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); } catch (Exception e) { }
            }
        });

        if (stato != null) web.restoreState(stato);
        else web.loadUrl(sito + "app/");
    }

    private class Ponte {
        @JavascriptInterface
        public void riprova() { runOnUiThread(() -> web.loadUrl(sito + "app/")); }

        @JavascriptInterface
        public String versione() { return BuildConfig.VERSION_NAME; }

        @JavascriptInterface
        public void salva(String b64, String nome, String mime) {
            try {
                byte[] dati = Base64.decode(b64, Base64.DEFAULT);
                String n = (nome == null || nome.isEmpty()) ? "Natan-file" : nome.replaceAll("[\\\\/:*?\"<>|]", "_");
                if (!n.contains(".") && mime != null) {
                    if (mime.contains("pdf")) n += ".pdf";
                    else if (mime.contains("wordprocessing")) n += ".docx";
                    else if (mime.contains("presentation")) n += ".pptx";
                    else if (mime.contains("png")) n += ".png";
                    else if (mime.contains("jpeg")) n += ".jpg";
                    else if (mime.contains("mp4")) n += ".mp4";
                }
                n = System.currentTimeMillis() / 1000 + "-" + n;
                if (Build.VERSION.SDK_INT >= 29) {
                    ContentValues cv = new ContentValues();
                    cv.put(MediaStore.Downloads.DISPLAY_NAME, n);
                    if (mime != null && !mime.isEmpty()) cv.put(MediaStore.Downloads.MIME_TYPE, mime);
                    cv.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
                    Uri u = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
                    try (OutputStream o = getContentResolver().openOutputStream(u)) { o.write(dati); }
                } else {
                    File d = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                    d.mkdirs();
                    try (FileOutputStream o = new FileOutputStream(new File(d, n))) { o.write(dati); }
                }
                final String fatto = n;
                runOnUiThread(() -> Toast.makeText(MainActivity.this, "Salvato in Download: " + fatto, Toast.LENGTH_LONG).show());
            } catch (Exception e) {
                runOnUiThread(() -> Toast.makeText(MainActivity.this, "Non riesco a salvare il file", Toast.LENGTH_LONG).show());
            }
        }
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        if (req == FOTO && attesaFoto != null) {
            attesaFoto.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(res, data));
            attesaFoto = null;
            return;
        }
        super.onActivityResult(req, res, data);
    }

    @Override
    public void onRequestPermissionsResult(int req, String[] perms, int[] ris) {
        if (req == MICROFONO && attesaMicrofono != null) {
            if (ris.length > 0 && ris[0] == PackageManager.PERMISSION_GRANTED) attesaMicrofono.grant(attesaMicrofono.getResources());
            else attesaMicrofono.deny();
            attesaMicrofono = null;
        }
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else moveTaskToBack(true);
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    protected void onPause() { super.onPause(); CookieManager.getInstance().flush(); }
}
