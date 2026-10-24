package cz.mega.mytubefeed;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashMap;

public class MainActivity extends Activity {
    // Rozhraní se servíruje z assets na falešné https adrese, aby vložený přehrávač dostal platný Referer/origin.
    static final String HOST = "mytubefeed.local";
    private static final String UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";

    private WebView web;
    private String shared = "";
    private View customView;
    private WebChromeClient.CustomViewCallback customCb;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        getWindow().setStatusBarColor(Color.parseColor("#0f0f0f"));
        getWindow().setNavigationBarColor(Color.parseColor("#0f0f0f"));

        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#0f0f0f"));
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onShowCustomView(View view, CustomViewCallback callback) {
                customView = view;
                customCb = callback;
                setContentView(view);
                view.setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
            }

            @Override
            public void onHideCustomView() {
                hideCustom();
            }
        });

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
                Uri u = r.getUrl();
                if (HOST.equals(u.getHost())) {
                    return asset(u.getPath());
                }
                return null;
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                // hlavní stránka se nikdy nepřepne mimo aplikaci
                return r.isForMainFrame() && !HOST.equals(r.getUrl().getHost());
            }
        });

        web.addJavascriptInterface(new Bridge(), "Android");
        handleIntent(getIntent());
        web.loadUrl("https://" + HOST + "/index.html");
    }

    private WebResourceResponse asset(String path) {
        try {
            if (path == null || path.isEmpty() || "/".equals(path)) {
                path = "/index.html";
            }
            InputStream in = getAssets().open(path.substring(1));
            String mime = "application/octet-stream";
            if (path.endsWith(".html")) mime = "text/html";
            else if (path.endsWith(".js")) mime = "application/javascript";
            else if (path.endsWith(".css")) mime = "text/css";
            else if (path.endsWith(".png")) mime = "image/png";
            return new WebResourceResponse(mime, "utf-8", in);
        } catch (Exception e) {
            return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found",
                    new HashMap<String, String>(), new ByteArrayInputStream(new byte[0]));
        }
    }

    private boolean hideCustom() {
        if (customView == null) {
            return false;
        }
        setContentView(web);
        web.setSystemUiVisibility(View.SYSTEM_UI_FLAG_VISIBLE);
        customCb.onCustomViewHidden();
        customView = null;
        customCb = null;
        return true;
    }

    private void handleIntent(Intent i) {
        if (i != null && Intent.ACTION_SEND.equals(i.getAction())) {
            String t = i.getStringExtra(Intent.EXTRA_TEXT);
            if (t != null) {
                shared = t;
            }
        }
    }

    @Override
    protected void onNewIntent(Intent i) {
        super.onNewIntent(i);
        handleIntent(i);
        web.evaluateJavascript("window.onShared&&window.onShared()", null);
    }

    @Override
    public void onBackPressed() {
        if (hideCustom()) {
            return;
        }
        web.evaluateJavascript("window.__back?window.__back():false", value -> {
            if (!"true".equals(value)) {
                finish();
            }
        });
    }

    @Override
    protected void onPause() {
        super.onPause();
        web.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
    }

    private void toast(String msg) {
        Toast.makeText(this, msg, Toast.LENGTH_LONG).show();
    }

    private void openExternal(String target, String url) {
        boolean libre = "libretube".equals(target);
        String[] pkgs = libre
                ? new String[]{"com.github.libretube", "com.github.libretube.debug"}
                : new String[]{"org.mozilla.firefox", "org.mozilla.firefox_beta", "org.mozilla.fenix", "org.mozilla.fennec_fdroid"};
        for (String p : pkgs) {
            try {
                Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                i.setPackage(p);
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(i);
                return;
            } catch (ActivityNotFoundException e) {
                // zkusí další balíček
            }
        }
        toast(libre ? "LibreTube není nainstalované – otevírám ve výchozím prohlížeči." : "Firefox nenalezen – otevírám ve výchozím prohlížeči.");
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(i);
        } catch (Exception e) {
            toast("Odkaz se nepodařilo otevřít.");
        }
    }

    /** Most JavaScript <-> Java. Metody běží na vlákně WebView, UI práce se přesouvá přes runOnUiThread. */
    public class Bridge {
        @JavascriptInterface
        public void http(final int id, final String url) {
            new Thread(() -> {
                int status;
                String body = "";
                try {
                    HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
                    c.setConnectTimeout(15000);
                    c.setReadTimeout(20000);
                    c.setRequestProperty("User-Agent", UA);
                    c.setRequestProperty("Accept-Language", "cs,en;q=0.8");
                    c.setRequestProperty("Cookie", "SOCS=CAI; CONSENT=YES+cb");
                    status = c.getResponseCode();
                    InputStream in = status >= 400 ? c.getErrorStream() : c.getInputStream();
                    if (in != null) {
                        ByteArrayOutputStream o = new ByteArrayOutputStream();
                        byte[] buf = new byte[16384];
                        int n;
                        while ((n = in.read(buf)) > 0) {
                            o.write(buf, 0, n);
                            if (o.size() > 6000000) {
                                break;
                            }
                        }
                        body = o.toString("UTF-8");
                        in.close();
                    }
                    if (c.getURL().getHost().startsWith("consent.")) {
                        status = 451;
                    }
                } catch (Exception e) {
                    status = -1;
                    body = String.valueOf(e);
                }
                final String js = "window.__http(" + id + "," + status + "," + JSONObject.quote(body) + ")";
                runOnUiThread(() -> web.evaluateJavascript(js, null));
            }).start();
        }

        @JavascriptInterface
        public void open(final String target, final String url) {
            runOnUiThread(() -> openExternal(target, url));
        }

        @JavascriptInterface
        public void share(final String title, final String text) {
            runOnUiThread(() -> {
                Intent i = new Intent(Intent.ACTION_SEND);
                i.setType("text/plain");
                i.putExtra(Intent.EXTRA_SUBJECT, title);
                i.putExtra(Intent.EXTRA_TEXT, text);
                startActivity(Intent.createChooser(i, title));
            });
        }

        @JavascriptInterface
        public void copy(final String text) {
            runOnUiThread(() -> {
                ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                cm.setPrimaryClip(ClipData.newPlainText("MyTube Feed", text));
            });
        }

        @JavascriptInterface
        public String paste() {
            ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
            ClipData d = cm.getPrimaryClip();
            if (d != null && d.getItemCount() > 0) {
                return String.valueOf(d.getItemAt(0).coerceToText(MainActivity.this));
            }
            return "";
        }

        @JavascriptInterface
        public String getShared() {
            String s = shared;
            shared = "";
            return s;
        }
    }
}
