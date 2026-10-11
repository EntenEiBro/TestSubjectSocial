package com.testsubjectsocial.game;

import android.content.res.AssetManager;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.Locale;

/**
 * Tiny HTTP server running inside the app — the Android counterpart of
 * serve.py. It serves the game files from the APK assets (assets/game/...)
 * to the app's own WebView, on this phone only (127.0.0.1). ES modules need
 * a real http:// origin, which file:// URLs don't provide.
 */
public final class GameServer {
    public static final int PORT = 8765;

    private final AssetManager assets;
    private ServerSocket server;
    private volatile boolean running;

    public GameServer(AssetManager assets) {
        this.assets = assets;
    }

    /** Start listening; returns false if the port is unavailable. */
    public boolean start() {
        try {
            server = new ServerSocket();
            server.setReuseAddress(true);
            // Explicitly IPv4: on Android getLoopbackAddress() is ::1, but the WebView loads 127.0.0.1.
            server.bind(new InetSocketAddress(InetAddress.getByAddress(new byte[] {127, 0, 0, 1}), PORT));
        } catch (IOException e) {
            return false;
        }
        running = true;
        Thread t = new Thread(this::acceptLoop, "game-server");
        t.setDaemon(true);
        t.start();
        return true;
    }

    public void stop() {
        running = false;
        try { if (server != null) server.close(); } catch (IOException ignored) { }
    }

    private void acceptLoop() {
        while (running) {
            try {
                Socket s = server.accept();
                Thread t = new Thread(() -> handle(s), "game-conn");
                t.setDaemon(true);
                t.start();
            } catch (IOException e) {
                if (!running) return;
            }
        }
    }

    private void handle(Socket socket) {
        try (Socket s = socket) {
            InputStream in = new BufferedInputStream(s.getInputStream());
            OutputStream out = new BufferedOutputStream(s.getOutputStream());
            String requestLine = readLine(in);
            if (requestLine == null || requestLine.isEmpty()) return;
            // Skip the headers; nothing in them matters for static files.
            for (String line; (line = readLine(in)) != null && !line.isEmpty(); ) { /* skip */ }
            String[] parts = requestLine.split(" ");
            if (parts.length < 2) return;
            String path = parts[1];
            int q = path.indexOf('?');
            if (q >= 0) path = path.substring(0, q);
            serveAsset(out, path);
        } catch (Exception ignored) {
            // connection dropped or malformed request: nothing to do
        }
    }

    private void serveAsset(OutputStream out, String path) throws IOException {
        String rel = URLDecoder.decode(path, "UTF-8");
        if (rel.contains("..")) { send(out, 403, "text/plain", "Forbidden".getBytes()); return; }
        if (rel.isEmpty() || rel.equals("/")) rel = "/index.html";
        byte[] body;
        try (InputStream a = assets.open("game" + rel)) {
            body = readAll(a);
        } catch (IOException e) {
            send(out, 404, "text/plain", "Not found".getBytes());
            return;
        }
        send(out, 200, mimeType(rel), body);
    }

    private static void send(OutputStream out, int status, String type, byte[] body) throws IOException {
        String reason = status == 200 ? "OK" : status == 404 ? "Not Found" : status == 403 ? "Forbidden" : "Error";
        String head = "HTTP/1.1 " + status + " " + reason + "\r\n"
                + "Content-Type: " + type + "\r\n"
                + "Content-Length: " + body.length + "\r\n"
                + "Cache-Control: no-store\r\n"
                + "Connection: close\r\n\r\n";
        out.write(head.getBytes(StandardCharsets.US_ASCII));
        out.write(body);
        out.flush();
    }

    private static String mimeType(String path) {
        String p = path.toLowerCase(Locale.ROOT);
        if (p.endsWith(".html")) return "text/html; charset=utf-8";
        if (p.endsWith(".js")) return "text/javascript; charset=utf-8";
        if (p.endsWith(".css")) return "text/css; charset=utf-8";
        if (p.endsWith(".json")) return "application/json";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".woff2")) return "font/woff2";
        if (p.endsWith(".txt")) return "text/plain; charset=utf-8";
        return "application/octet-stream";
    }

    private static String readLine(InputStream in) throws IOException {
        StringBuilder sb = new StringBuilder();
        for (int c; (c = in.read()) >= 0; ) {
            if (c == '\n') break;
            if (c != '\r') sb.append((char) c);
            if (sb.length() > 8192) throw new IOException("header too long");
        }
        return sb.toString();
    }

    private static byte[] readAll(InputStream in) throws IOException {
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        byte[] buf = new byte[16384];
        for (int r; (r = in.read(buf)) > 0; ) bos.write(buf, 0, r);
        return bos.toByteArray();
    }
}
