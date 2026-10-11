/*
 * tss_eos.c — Epic Online Services for the Android app (JNI).
 *
 * The C twin of eos_bridge.py: anonymous login (Connect + device ID), a
 * lobby tagged with a 6-letter room code, and EOS P2P messages between the
 * players (through Epic's relays when needed). Messages of any size are
 * split into EOS packets (1 header byte: 1 = last fragment) and reassembled.
 *
 * Every function here runs on the app's main thread (EosBridge.java posts
 * all calls there and ticks the SDK every few milliseconds); results go back
 * to Java through EosBridge.onEvent(type, peer, channel, data, code, text).
 */
#include <jni.h>
#include <stdlib.h>
#include <string.h>
#include <android/log.h>

#include "eos_sdk.h"
#include "eos_logging.h"
#include "eos_connect.h"
#include "eos_lobby.h"
#include "eos_p2p.h"
#include "Android/eos_Android.h"

#define TAG "tss_eos"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, TAG, __VA_ARGS__)
#define LOGW(...) __android_log_print(ANDROID_LOG_WARN, TAG, __VA_ARGS__)

#define MAX_PACKET 1170
#define FRAG_PAYLOAD (MAX_PACKET - 1)
#define MAX_PARTS 32
#define PUID_LEN (EOS_PRODUCTUSERID_MAX_LENGTH + 1)

static const char *SOCKET_NAME = "TSS";
static const char *LOBBY_BUCKET = "tss:v1";
static const char *CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

static JNIEnv *g_env;          /* main thread's env, valid during calls from Java */
static jobject g_bridge;       /* EosBridge instance (global ref) */
static jmethodID g_onEvent;

static EOS_HPlatform g_platform;
static EOS_HConnect g_connect;
static EOS_HLobby g_lobby;
static EOS_HP2P g_p2p;
static EOS_ProductUserId g_user;
static char *g_lobbyId;
static EOS_P2P_SocketId g_socket;

/* Reassembly buffers, one per (peer, channel). */
typedef struct { char peer[PUID_LEN]; int ch; char *buf; int len, cap; } Part;
static Part g_parts[MAX_PARTS];

/* ------------------------------------------------------------------ events */

static void emit(const char *type, const char *peer, int ch, const char *data, int len, int code, const char *text) {
    JNIEnv *env = g_env;
    if (!env || !g_bridge) return;
    jstring jt = (*env)->NewStringUTF(env, type);
    jstring jp = peer ? (*env)->NewStringUTF(env, peer) : NULL;
    jbyteArray jd = NULL;
    if (data) {
        jd = (*env)->NewByteArray(env, len);
        (*env)->SetByteArrayRegion(env, jd, 0, len, (const jbyte *) data);
    }
    jstring jm = text ? (*env)->NewStringUTF(env, text) : NULL;
    (*env)->CallVoidMethod(env, g_bridge, g_onEvent, jt, jp, ch, jd, code, jm);
    if ((*env)->ExceptionCheck(env)) (*env)->ExceptionClear(env);
    (*env)->DeleteLocalRef(env, jt);
    if (jp) (*env)->DeleteLocalRef(env, jp);
    if (jd) (*env)->DeleteLocalRef(env, jd);
    if (jm) (*env)->DeleteLocalRef(env, jm);
}

static void fail(const char *op, EOS_EResult r, const char *text) {
    LOGW("%s failed (%d): %s", op, (int) r, text);
    emit("error", op, 0, NULL, 0, (int) r, text);
}

static int puid_str(EOS_ProductUserId id, char *out) {
    int32_t n = PUID_LEN;
    out[0] = 0;
    return id && EOS_ProductUserId_ToString(id, out, &n) == EOS_Success;
}

static void EOS_CALL on_log(const EOS_LogMessage *m) {
    __android_log_print(m->Level <= EOS_LOG_Error ? ANDROID_LOG_ERROR : ANDROID_LOG_WARN, TAG, "[%s] %s",
                        m->Category ? m->Category : "", m->Message ? m->Message : "");
}

/* ------------------------------------------------------------------- login */

static void login(void);

static void EOS_CALL on_device_created(const EOS_Connect_CreateDeviceIdCallbackInfo *info) {
    if (info->ResultCode != EOS_Success && info->ResultCode != EOS_DuplicateNotAllowed) {
        fail("login", info->ResultCode, "could not create a device ID");
        return;
    }
    login();
}

static void create_device(void) {
    EOS_Connect_CreateDeviceIdOptions o = {0};
    o.ApiVersion = EOS_CONNECT_CREATEDEVICEID_API_LATEST;
    o.DeviceModel = "Android";
    EOS_Connect_CreateDeviceId(g_connect, &o, NULL, on_device_created);
}

static void EOS_CALL on_p2p_request(const EOS_P2P_OnIncomingConnectionRequestInfo *info) {
    EOS_P2P_AcceptConnectionOptions o = {0};
    o.ApiVersion = EOS_P2P_ACCEPTCONNECTION_API_LATEST;
    o.LocalUserId = g_user;
    o.RemoteUserId = info->RemoteUserId;
    o.SocketId = &g_socket;
    EOS_P2P_AcceptConnection(g_p2p, &o);
}

static void EOS_CALL on_p2p_open(const EOS_P2P_OnPeerConnectionEstablishedInfo *info) {
    char peer[PUID_LEN];
    puid_str(info->RemoteUserId, peer);
    emit("peer-open", peer, 0, NULL, 0, 0, NULL);
}

static void EOS_CALL on_p2p_closed(const EOS_P2P_OnRemoteConnectionClosedInfo *info) {
    char peer[PUID_LEN];
    puid_str(info->RemoteUserId, peer);
    emit("peer-closed", peer, 0, NULL, 0, (int) info->Reason, NULL);
}

static void ready(EOS_ProductUserId user) {
    char id[PUID_LEN];
    g_user = user;
    puid_str(user, id);

    EOS_P2P_AddNotifyPeerConnectionRequestOptions rq = {0};
    rq.ApiVersion = EOS_P2P_ADDNOTIFYPEERCONNECTIONREQUEST_API_LATEST;
    rq.LocalUserId = user;
    rq.SocketId = &g_socket;
    EOS_P2P_AddNotifyPeerConnectionRequest(g_p2p, &rq, NULL, on_p2p_request);

    EOS_P2P_AddNotifyPeerConnectionEstablishedOptions est = {0};
    est.ApiVersion = EOS_P2P_ADDNOTIFYPEERCONNECTIONESTABLISHED_API_LATEST;
    est.LocalUserId = user;
    est.SocketId = &g_socket;
    EOS_P2P_AddNotifyPeerConnectionEstablished(g_p2p, &est, NULL, on_p2p_open);

    EOS_P2P_AddNotifyPeerConnectionClosedOptions cl = {0};
    cl.ApiVersion = EOS_P2P_ADDNOTIFYPEERCONNECTIONCLOSED_API_LATEST;
    cl.LocalUserId = user;
    cl.SocketId = &g_socket;
    EOS_P2P_AddNotifyPeerConnectionClosed(g_p2p, &cl, NULL, on_p2p_closed);

    LOGI("logged in as %s", id);
    emit("ready", id, 0, NULL, 0, 0, NULL);
}

static void EOS_CALL on_user_created(const EOS_Connect_CreateUserCallbackInfo *info) {
    if (info->ResultCode == EOS_Success) ready(info->LocalUserId);
    else fail("login", info->ResultCode, "could not create the user");
}

static void EOS_CALL on_login(const EOS_Connect_LoginCallbackInfo *info) {
    if (info->ResultCode == EOS_Success) {
        ready(info->LocalUserId);
    } else if (info->ResultCode == EOS_InvalidUser && info->ContinuanceToken) {
        EOS_Connect_CreateUserOptions o = {0};
        o.ApiVersion = EOS_CONNECT_CREATEUSER_API_LATEST;
        o.ContinuanceToken = info->ContinuanceToken;
        EOS_Connect_CreateUser(g_connect, &o, NULL, on_user_created);
    } else if (info->ResultCode == EOS_NotFound) {
        create_device();
    } else {
        fail("login", info->ResultCode, "login failed");
    }
}

static void login(void) {
    EOS_Connect_Credentials creds = {0};
    creds.ApiVersion = EOS_CONNECT_CREDENTIALS_API_LATEST;
    creds.Token = NULL;
    creds.Type = EOS_ECT_DEVICEID_ACCESS_TOKEN;
    EOS_Connect_UserLoginInfo info = {0};
    info.ApiVersion = EOS_CONNECT_USERLOGININFO_API_LATEST;
    info.DisplayName = "Subject";
    EOS_Connect_LoginOptions o = {0};
    o.ApiVersion = EOS_CONNECT_LOGIN_API_LATEST;
    o.Credentials = &creds;
    o.UserLoginInfo = &info;
    EOS_Connect_Login(g_connect, &o, NULL, on_login);
}

/* ----------------------------------------------------------------- lobbies */

static void EOS_CALL on_lobby_destroyed(const EOS_Lobby_DestroyLobbyCallbackInfo *info) { (void) info; }

static void close_all(void) {
    if (g_user) {
        EOS_P2P_CloseConnectionsOptions o = {0};
        o.ApiVersion = EOS_P2P_CLOSECONNECTIONS_API_LATEST;
        o.LocalUserId = g_user;
        o.SocketId = &g_socket;
        EOS_P2P_CloseConnections(g_p2p, &o);
    }
    if (g_lobbyId) {
        EOS_Lobby_DestroyLobbyOptions o = {0};
        o.ApiVersion = EOS_LOBBY_DESTROYLOBBY_API_LATEST;
        o.LocalUserId = g_user;
        o.LobbyId = g_lobbyId;
        EOS_Lobby_DestroyLobby(g_lobby, &o, NULL, on_lobby_destroyed);
        free(g_lobbyId);
        g_lobbyId = NULL;
    }
    for (int i = 0; i < MAX_PARTS; i++) { free(g_parts[i].buf); memset(&g_parts[i], 0, sizeof(Part)); }
}

static char g_code[8];

static void EOS_CALL on_lobby_updated(const EOS_Lobby_UpdateLobbyCallbackInfo *info) {
    if (info->ResultCode != EOS_Success) { fail("host", info->ResultCode, "could not publish the lobby code"); return; }
    emit("hosted", NULL, 0, NULL, 0, 0, g_code);
}

static void EOS_CALL on_lobby_created(const EOS_Lobby_CreateLobbyCallbackInfo *info) {
    if (info->ResultCode != EOS_Success) { fail("host", info->ResultCode, "could not create the lobby"); return; }
    g_lobbyId = strdup(info->LobbyId);
    EOS_HLobbyModification mod = NULL;
    EOS_Lobby_UpdateLobbyModificationOptions mo = {0};
    mo.ApiVersion = EOS_LOBBY_UPDATELOBBYMODIFICATION_API_LATEST;
    mo.LocalUserId = g_user;
    mo.LobbyId = g_lobbyId;
    EOS_EResult r = EOS_Lobby_UpdateLobbyModification(g_lobby, &mo, &mod);
    if (r != EOS_Success) { fail("host", r, "could not edit the lobby"); return; }
    EOS_Lobby_AttributeData attr = {0};
    attr.ApiVersion = EOS_LOBBY_ATTRIBUTEDATA_API_LATEST;
    attr.Key = "CODE";
    attr.Value.AsUtf8 = g_code;
    attr.ValueType = EOS_AT_STRING;
    EOS_LobbyModification_AddAttributeOptions ao = {0};
    ao.ApiVersion = EOS_LOBBYMODIFICATION_ADDATTRIBUTE_API_LATEST;
    ao.Attribute = &attr;
    ao.Visibility = EOS_LAT_PUBLIC;
    EOS_LobbyModification_AddAttribute(mod, &ao);
    EOS_Lobby_UpdateLobbyOptions uo = {0};
    uo.ApiVersion = EOS_LOBBY_UPDATELOBBY_API_LATEST;
    uo.LobbyModificationHandle = mod;
    EOS_Lobby_UpdateLobby(g_lobby, &uo, NULL, on_lobby_updated);
    EOS_LobbyModification_Release(mod);
}

static void host(void) {
    close_all();
    for (int i = 0; i < 6; i++) g_code[i] = CODE_ALPHABET[arc4random_uniform(32)];
    g_code[6] = 0;
    EOS_Lobby_CreateLobbyOptions o = {0};
    o.ApiVersion = EOS_LOBBY_CREATELOBBY_API_LATEST;
    o.LocalUserId = g_user;
    o.MaxLobbyMembers = 8;
    o.PermissionLevel = EOS_LPL_PUBLICADVERTISED;
    o.bPresenceEnabled = EOS_FALSE;
    o.bAllowInvites = EOS_FALSE;
    o.BucketId = LOBBY_BUCKET;
    o.bDisableHostMigration = EOS_TRUE;
    o.bEnableRTCRoom = EOS_FALSE;
    EOS_Lobby_CreateLobby(g_lobby, &o, NULL, on_lobby_created);
}

static void EOS_CALL on_found(const EOS_LobbySearch_FindCallbackInfo *info) {
    EOS_HLobbySearch search = (EOS_HLobbySearch) info->ClientData;
    EOS_LobbySearch_GetSearchResultCountOptions co = {0};
    co.ApiVersion = EOS_LOBBYSEARCH_GETSEARCHRESULTCOUNT_API_LATEST;
    if (info->ResultCode != EOS_Success || EOS_LobbySearch_GetSearchResultCount(search, &co) == 0) {
        EOS_EResult r = (info->ResultCode == EOS_Success || info->ResultCode == EOS_NotFound) ? EOS_NotFound : info->ResultCode;
        fail("join", r, "no such room");
        EOS_LobbySearch_Release(search);
        return;
    }
    EOS_HLobbyDetails details = NULL;
    EOS_LobbySearch_CopySearchResultByIndexOptions io = {0};
    io.ApiVersion = EOS_LOBBYSEARCH_COPYSEARCHRESULTBYINDEX_API_LATEST;
    io.LobbyIndex = 0;
    char host[PUID_LEN] = {0};
    if (EOS_LobbySearch_CopySearchResultByIndex(search, &io, &details) == EOS_Success) {
        EOS_LobbyDetails_GetLobbyOwnerOptions oo = {0};
        oo.ApiVersion = EOS_LOBBYDETAILS_GETLOBBYOWNER_API_LATEST;
        puid_str(EOS_LobbyDetails_GetLobbyOwner(details, &oo), host);
        EOS_LobbyDetails_Release(details);
    }
    EOS_LobbySearch_Release(search);
    if (!host[0]) { fail("join", EOS_NotFound, "no such room"); return; }
    emit("joined", host, 0, NULL, 0, 0, NULL);
}

static void join(const char *code) {
    close_all();
    EOS_HLobbySearch search = NULL;
    EOS_Lobby_CreateLobbySearchOptions so = {0};
    so.ApiVersion = EOS_LOBBY_CREATELOBBYSEARCH_API_LATEST;
    so.MaxResults = 1;
    EOS_EResult r = EOS_Lobby_CreateLobbySearch(g_lobby, &so, &search);
    if (r != EOS_Success) { fail("join", r, "could not start the search"); return; }
    EOS_Lobby_AttributeData attr = {0};
    attr.ApiVersion = EOS_LOBBY_ATTRIBUTEDATA_API_LATEST;
    attr.Key = "CODE";
    attr.Value.AsUtf8 = code;
    attr.ValueType = EOS_AT_STRING;
    EOS_LobbySearch_SetParameterOptions po = {0};
    po.ApiVersion = EOS_LOBBYSEARCH_SETPARAMETER_API_LATEST;
    po.Parameter = &attr;
    po.ComparisonOp = EOS_CO_EQUAL;
    EOS_LobbySearch_SetParameter(search, &po);
    EOS_LobbySearch_FindOptions fo = {0};
    fo.ApiVersion = EOS_LOBBYSEARCH_FIND_API_LATEST;
    fo.LocalUserId = g_user;
    EOS_LobbySearch_Find(search, &fo, search, on_found);
}

/* ---------------------------------------------------------------- messages */

static void send_msg(const char *peer, int ch, int mode, const char *data, int len) {
    EOS_ProductUserId remote = EOS_ProductUserId_FromString(peer);
    if (!remote) return;
    int chunks = len > 0 ? (len + FRAG_PAYLOAD - 1) / FRAG_PAYLOAD : 1;
    if (chunks > 1) mode = EOS_PR_ReliableOrdered; /* fragments must arrive in order */
    char packet[MAX_PACKET];
    for (int i = 0; i < chunks; i++) {
        int off = i * FRAG_PAYLOAD;
        int n = len - off < FRAG_PAYLOAD ? len - off : FRAG_PAYLOAD;
        if (n < 0) n = 0;
        packet[0] = (char) (i == chunks - 1 ? 1 : 0);
        if (n) memcpy(packet + 1, data + off, n);
        EOS_P2P_SendPacketOptions o = {0};
        o.ApiVersion = EOS_P2P_SENDPACKET_API_LATEST;
        o.LocalUserId = g_user;
        o.RemoteUserId = remote;
        o.SocketId = &g_socket;
        o.Channel = (uint8_t) ch;
        o.DataLengthBytes = (uint32_t) (n + 1);
        o.Data = packet;
        o.bAllowDelayedDelivery = EOS_TRUE;
        o.Reliability = (EOS_EPacketReliability) mode;
        o.bDisableAutoAcceptConnection = EOS_FALSE;
        EOS_EResult r = EOS_P2P_SendPacket(g_p2p, &o);
        if (r != EOS_Success) { LOGW("send failed (%d)", (int) r); return; }
    }
}

static Part *part_for(const char *peer, int ch) {
    Part *free_slot = NULL;
    for (int i = 0; i < MAX_PARTS; i++) {
        Part *p = &g_parts[i];
        if (p->peer[0] && p->ch == ch && strcmp(p->peer, peer) == 0) return p;
        if (!p->peer[0] && !free_slot) free_slot = p;
    }
    if (!free_slot) return NULL;
    strncpy(free_slot->peer, peer, PUID_LEN - 1);
    free_slot->ch = ch;
    free_slot->len = 0;
    return free_slot;
}

static void receive(void) {
    char buf[MAX_PACKET + 16];
    EOS_P2P_GetNextReceivedPacketSizeOptions so = {0};
    so.ApiVersion = EOS_P2P_GETNEXTRECEIVEDPACKETSIZE_API_LATEST;
    so.LocalUserId = g_user;
    EOS_P2P_ReceivePacketOptions ro = {0};
    ro.ApiVersion = EOS_P2P_RECEIVEPACKET_API_LATEST;
    ro.LocalUserId = g_user;
    ro.MaxDataSizeBytes = sizeof(buf);
    for (int k = 0; k < 512; k++) {
        uint32_t size = 0;
        if (EOS_P2P_GetNextReceivedPacketSize(g_p2p, &so, &size) != EOS_Success) return;
        EOS_ProductUserId from = NULL;
        EOS_P2P_SocketId sock;
        uint8_t ch = 0;
        uint32_t written = 0;
        if (EOS_P2P_ReceivePacket(g_p2p, &ro, &from, &sock, &ch, buf, &written) != EOS_Success) return;
        if (written == 0) continue;
        char peer[PUID_LEN];
        puid_str(from, peer);
        Part *p = part_for(peer, ch);
        if (!p) continue;
        int n = (int) written - 1;
        if (p->len + n > p->cap) {
            int cap = (p->len + n) * 2 + 256;
            char *nb = realloc(p->buf, cap);
            if (!nb) { p->len = 0; continue; }
            p->buf = nb;
            p->cap = cap;
        }
        memcpy(p->buf + p->len, buf + 1, n);
        p->len += n;
        if (buf[0] == 1) {
            emit("msg", peer, ch, p->buf, p->len, 0, NULL);
            p->len = 0;
        }
    }
}

/* -------------------------------------------------------------- JNI entry */

#define JNI_FN(name) Java_com_testsubjectsocial_game_EosBridge_##name

static char *dupstr(JNIEnv *env, jstring s) {
    if (!s) return NULL;
    const char *c = (*env)->GetStringUTFChars(env, s, NULL);
    char *out = strdup(c);
    (*env)->ReleaseStringUTFChars(env, s, c);
    return out;
}

JNIEXPORT jboolean JNICALL JNI_FN(nativeInit)(JNIEnv *env, jobject thiz, jstring name, jstring version,
        jstring productId, jstring sandboxId, jstring deploymentId, jstring clientId, jstring clientSecret,
        jstring dir) {
    g_env = env;
    if (!g_bridge) {
        g_bridge = (*env)->NewGlobalRef(env, thiz);
        jclass cls = (*env)->GetObjectClass(env, thiz);
        g_onEvent = (*env)->GetMethodID(env, cls, "onEvent", "(Ljava/lang/String;Ljava/lang/String;I[BILjava/lang/String;)V");
    }
    char *cdir = dupstr(env, dir);
    static EOS_Android_InitializeOptions android = {0};
    android.ApiVersion = EOS_ANDROID_INITIALIZEOPTIONS_API_LATEST;
    android.OptionalInternalDirectory = cdir;
    android.OptionalExternalDirectory = cdir;
    EOS_InitializeOptions init = {0};
    init.ApiVersion = EOS_INITIALIZE_API_LATEST;
    init.ProductName = dupstr(env, name);
    init.ProductVersion = dupstr(env, version);
    init.SystemInitializeOptions = &android;
    EOS_EResult r = EOS_Initialize(&init);
    if (r != EOS_Success && r != EOS_AlreadyConfigured) { fail("init", r, "EOS_Initialize failed"); return JNI_FALSE; }
    EOS_Logging_SetCallback(on_log);
    EOS_Logging_SetLogLevel(EOS_LC_ALL_CATEGORIES, EOS_LOG_Warning);

    EOS_Platform_Options o = {0};
    o.ApiVersion = EOS_PLATFORM_OPTIONS_API_LATEST;
    o.ProductId = dupstr(env, productId);
    o.SandboxId = dupstr(env, sandboxId);
    o.DeploymentId = dupstr(env, deploymentId);
    o.ClientCredentials.ClientId = dupstr(env, clientId);
    o.ClientCredentials.ClientSecret = dupstr(env, clientSecret);
    o.bIsServer = EOS_FALSE;
    o.Flags = EOS_PF_DISABLE_OVERLAY;
    o.CacheDirectory = cdir;
    double timeout = 10.0;
    o.TaskNetworkTimeoutSeconds = &timeout;
    g_platform = EOS_Platform_Create(&o);
    if (!g_platform) { fail("init", EOS_InvalidParameters, "EOS_Platform_Create failed (check the product IDs)"); return JNI_FALSE; }
    EOS_Platform_SetNetworkStatus(g_platform, EOS_NS_Online);
    g_connect = EOS_Platform_GetConnectInterface(g_platform);
    g_lobby = EOS_Platform_GetLobbyInterface(g_platform);
    g_p2p = EOS_Platform_GetP2PInterface(g_platform);
    g_socket.ApiVersion = EOS_P2P_SOCKETID_API_LATEST;
    strncpy(g_socket.SocketName, SOCKET_NAME, sizeof(g_socket.SocketName) - 1);
    EOS_P2P_SetRelayControlOptions rc = {0};
    rc.ApiVersion = EOS_P2P_SETRELAYCONTROL_API_LATEST;
    rc.RelayControl = EOS_RC_AllowRelays;
    EOS_P2P_SetRelayControl(g_p2p, &rc);
    create_device();
    return JNI_TRUE;
}

JNIEXPORT void JNICALL JNI_FN(nativeTick)(JNIEnv *env, jobject thiz) {
    (void) thiz;
    g_env = env;
    if (!g_platform) return;
    EOS_Platform_Tick(g_platform);
    if (g_user) receive();
}

JNIEXPORT void JNICALL JNI_FN(nativeHost)(JNIEnv *env, jobject thiz) {
    (void) thiz;
    g_env = env;
    if (g_user) host(); else fail("host", EOS_NotConfigured, "online service not ready");
}

JNIEXPORT void JNICALL JNI_FN(nativeJoin)(JNIEnv *env, jobject thiz, jstring code) {
    (void) thiz;
    g_env = env;
    if (!g_user) { fail("join", EOS_NotConfigured, "online service not ready"); return; }
    const char *c = (*env)->GetStringUTFChars(env, code, NULL);
    join(c);
    (*env)->ReleaseStringUTFChars(env, code, c);
}

JNIEXPORT void JNICALL JNI_FN(nativeSend)(JNIEnv *env, jobject thiz, jstring peer, jint ch, jint mode, jbyteArray data) {
    (void) thiz;
    g_env = env;
    if (!g_user) return;
    const char *p = (*env)->GetStringUTFChars(env, peer, NULL);
    jsize len = (*env)->GetArrayLength(env, data);
    jbyte *bytes = (*env)->GetByteArrayElements(env, data, NULL);
    send_msg(p, ch, mode, (const char *) bytes, len);
    (*env)->ReleaseByteArrayElements(env, data, bytes, JNI_ABORT);
    (*env)->ReleaseStringUTFChars(env, peer, p);
}

JNIEXPORT void JNICALL JNI_FN(nativeStop)(JNIEnv *env, jobject thiz) {
    (void) thiz;
    g_env = env;
    if (g_platform) close_all();
}

JNIEXPORT void JNICALL JNI_FN(nativeSetForeground)(JNIEnv *env, jobject thiz, jboolean foreground) {
    (void) thiz;
    g_env = env;
    if (g_platform) EOS_Platform_SetApplicationStatus(g_platform, foreground ? EOS_AS_Foreground : EOS_AS_BackgroundConstrained);
}
