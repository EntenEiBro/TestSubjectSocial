package com.testsubjectsocial.game;

import android.content.res.AssetManager;
import android.util.Base64;

import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Collections;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * Tiny HTTP + WebSocket server running inside the app — the Android
 * counterpart of serve.py.
 *
 *   GET /...        game files from the APK assets (assets/game/...)
 *   GET /netinfo    {"lan": "<wifi ip>", "port": 8765, "lanEnabled": true}
 *   GET /ws?room=CODE&role=host|client
 *                   signaling relay for online play (same protocol as serve.py)
 *
 * It listens on all interfaces so a friend's phone on the same Wi-Fi (or on
 * this phone's hotspot) can load the remote-player page from it.
 */
public final class GameServer {
    public static final int PORT = 8765;
    private static final String WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
    private static final int MAX_FRAME = 1 << 20;

    private final AssetManager assets;
    private ServerSocket server;
    private volatile boolean running;

    // ---- signaling rooms: code -> host + clients
    private static final class Room {
        WebSocket host;
        final Map<Integer, WebSocket> clients = new HashMap<>();
    }
    private final Map<String, Room> rooms = new HashMap<>();
    private int nextClientId = 1;

    public GameServer(AssetManager assets) {
        this.assets = assets;
    }

    /** Start listening; returns false if the port is unavailable. */
    public boolean start() {
        try {
            server = new ServerSocket();
            server.setReuseAddress(true);
            server.bind(new InetSocketAddress(PORT));
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

    // ------------------------------------------------------------------ HTTP

    private void handle(Socket socket) {
        try (Socket s = socket) {
            InputStream in = new BufferedInputStream(s.getInputStream());
            OutputStream out = new BufferedOutputStream(s.getOutputStream());
            String requestLine = readLine(in);
            if (requestLine == null || requestLine.isEmpty()) return;
            Map<String, String> headers = new HashMap<>();
            for (String line; (line = readLine(in)) != null && !line.isEmpty(); ) {
                int c = line.indexOf(':');
                if (c > 0) headers.put(line.substring(0, c).trim().toLowerCase(Locale.ROOT), line.substring(c + 1).trim());
            }
            String[] parts = requestLine.split(" ");
            if (parts.length < 2) return;
            String target = parts[1];
            String path = target, query = "";
            int q = target.indexOf('?');
            if (q >= 0) { path = target.substring(0, q); query = target.substring(q + 1); }

            if ("/ws".equals(path) && "websocket".equalsIgnoreCase(headers.get("upgrade"))) {
                handleWebSocket(in, out, headers, parseQuery(query));
            } else if ("/netinfo".equals(path)) {
                JSONObject info = new JSONObject();
                String ip = lanAddress();
                info.put("lan", ip != null ? ip : "127.0.0.1");
                info.put("port", PORT);
                info.put("lanEnabled", ip != null);
                send(out, 200, "application/json", info.toString().getBytes(StandardCharsets.UTF_8));
            } else {
                serveAsset(out, path);
            }
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

    // ------------------------------------------------------------- WebSocket

    /** Minimal RFC 6455 text-frame connection. */
    private static final class WebSocket {
        private final InputStream in;
        private final OutputStream out;
        volatile boolean open = true;

        WebSocket(InputStream in, OutputStream out) { this.in = in; this.out = out; }

        /** Next text message, or null when closed. */
        String recv() throws IOException {
            while (open) {
                int b1 = in.read(), b2 = in.read();
                if (b1 < 0 || b2 < 0) return null;
                int opcode = b1 & 0x0F;
                boolean masked = (b2 & 0x80) != 0;
                long len = b2 & 0x7F;
                if (len == 126) len = ((long) readByte() << 8) | readByte();
                else if (len == 127) { len = 0; for (int i = 0; i < 8; i++) len = (len << 8) | readByte(); }
                if (len > MAX_FRAME) throw new IOException("frame too large");
                byte[] mask = new byte[4];
                if (masked) readFully(mask);
                byte[] payload = new byte[(int) len];
                readFully(payload);
                if (masked) for (int i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
                if (opcode == 0x8) { close(); return null; }
                if (opcode == 0x9) { frame(0xA, payload); continue; }
                if (opcode == 0x1 || opcode == 0x0) return new String(payload, StandardCharsets.UTF_8);
            }
            return null;
        }

        void send(JSONObject obj) {
            if (!open) return;
            try { frame(0x1, obj.toString().getBytes(StandardCharsets.UTF_8)); }
            catch (IOException e) { open = false; }
        }

        synchronized void frame(int opcode, byte[] payload) throws IOException {
            ByteArrayOutputStream h = new ByteArrayOutputStream();
            h.write(0x80 | opcode);
            int n = payload.length;
            if (n < 126) h.write(n);
            else if (n < 65536) { h.write(126); h.write(n >> 8); h.write(n & 0xFF); }
            else { h.write(127); for (int i = 7; i >= 0; i--) h.write((int) (((long) n) >> (8 * i)) & 0xFF); }
            out.write(h.toByteArray());
            out.write(payload);
            out.flush();
        }

        void close() {
            if (!open) return;
            open = false;
            try { frame(0x8, new byte[0]); } catch (IOException ignored) { }
        }

        private int readByte() throws IOException {
            int b = in.read();
            if (b < 0) throw new IOException("closed");
            return b;
        }

        private void readFully(byte[] buf) throws IOException {
            int off = 0;
            while (off < buf.length) {
                int r = in.read(buf, off, buf.length - off);
                if (r < 0) throw new IOException("closed");
                off += r;
            }
        }
    }

    private void handleWebSocket(InputStream in, OutputStream out, Map<String, String> headers,
                                 Map<String, String> query) throws Exception {
        String key = headers.get("sec-websocket-key");
        if (key == null) { send(out, 400, "text/plain", "Missing key".getBytes()); return; }
        MessageDigest sha1 = MessageDigest.getInstance("SHA-1");
        String accept = Base64.encodeToString(sha1.digest((key + WS_GUID).getBytes(StandardCharsets.US_ASCII)), Base64.NO_WRAP);
        out.write(("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                + "Sec-WebSocket-Accept: " + accept + "\r\n\r\n").getBytes(StandardCharsets.US_ASCII));
        out.flush();

        WebSocket ws = new WebSocket(in, out);
        String code = query.getOrDefault("room", "").toUpperCase(Locale.ROOT);
        if (code.length() > 8) code = code.substring(0, 8);
        if ("host".equals(query.get("role"))) runHost(ws, code); else runClient(ws, code);
    }

    private void runHost(WebSocket ws, String code) throws Exception {
        synchronized (rooms) {
            if (code.isEmpty() || rooms.containsKey(code)) { ws.send(error("room unavailable")); return; }
            Room r = new Room();
            r.host = ws;
            rooms.put(code, r);
        }
        try {
            for (String text; (text = ws.recv()) != null; ) {
                JSONObject msg = new JSONObject(text);
                WebSocket target;
                synchronized (rooms) {
                    Room r = rooms.get(code);
                    target = r == null ? null : r.clients.get(msg.optInt("to", -1));
                }
                if (target != null) target.send(new JSONObject().put("type", "msg").put("data", msg.opt("data")));
            }
        } finally {
            Room r;
            synchronized (rooms) { r = rooms.remove(code); }
            if (r != null) for (WebSocket c : r.clients.values()) { c.send(error("host left")); c.close(); }
        }
    }

    private void runClient(WebSocket ws, String code) throws Exception {
        int id;
        WebSocket host;
        synchronized (rooms) {
            Room r = rooms.get(code);
            if (r == null) { ws.send(error("no such room")); return; }
            id = nextClientId++;
            r.clients.put(id, ws);
            host = r.host;
        }
        host.send(new JSONObject().put("type", "join").put("id", id));
        ws.send(new JSONObject().put("type", "welcome").put("id", id));
        try {
            for (String text; (text = ws.recv()) != null; ) {
                JSONObject msg = new JSONObject(text);
                host.send(new JSONObject().put("type", "msg").put("from", id).put("data", msg.opt("data")));
            }
        } finally {
            synchronized (rooms) {
                Room r = rooms.get(code);
                if (r != null) r.clients.remove(id);
            }
            host.send(new JSONObject().put("type", "leave").put("id", id));
        }
    }

    private static JSONObject error(String reason) throws Exception {
        return new JSONObject().put("type", "error").put("reason", reason);
    }

    // --------------------------------------------------------------- helpers

    /** This phone's Wi-Fi / hotspot IPv4 address, or null when offline. */
    public static String lanAddress() {
        String fallback = null;
        try {
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!ni.isUp() || ni.isLoopback()) continue;
                String name = ni.getName().toLowerCase(Locale.ROOT);
                for (InetAddress a : Collections.list(ni.getInetAddresses())) {
                    if (!(a instanceof Inet4Address) || !a.isSiteLocalAddress()) continue;
                    // Prefer Wi-Fi / hotspot interfaces over mobile data or VPNs.
                    if (name.startsWith("wlan") || name.startsWith("ap") || name.startsWith("swlan")) return a.getHostAddress();
                    if (fallback == null) fallback = a.getHostAddress();
                }
            }
        } catch (Exception ignored) { }
        return fallback;
    }

    private static Map<String, String> parseQuery(String q) {
        Map<String, String> m = new HashMap<>();
        for (String pair : q.split("&")) {
            int e = pair.indexOf('=');
            if (e <= 0) continue;
            try { m.put(URLDecoder.decode(pair.substring(0, e), "UTF-8"), URLDecoder.decode(pair.substring(e + 1), "UTF-8")); }
            catch (Exception ignored) { }
        }
        return m;
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
