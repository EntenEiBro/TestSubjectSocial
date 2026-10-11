"""Epic Online Services bridge for the desktop build (Python + ctypes).

The game page talks to EOS through a tiny message API (play.py exposes it
to JavaScript as window.pywebview.api.eos_*):

    host()                    create a lobby with a 6-letter code  -> 'hosted' {code}
    join(code)                find that lobby, connect to its owner -> 'joined' {host}
    send(peer, ch, mode, txt) P2P message to a peer (mode 0 unreliable, 1 reliable unordered,
                              2 reliable ordered; ordered messages of any size are split into
                              EOS packets and reassembled on the other side)
    stop()                    leave/destroy the lobby, close every connection

Events (dicts) go back to the page through `on_events(list)`:
    ready {user}, hosted {code}, joined {host}, peer-open {peer}, peer-closed {peer, reason},
    msg {peer, ch, data}, error {op, code, message}

All EOS calls happen on one worker thread (the SDK is not thread-safe):
commands are queued, the thread runs EOS_Platform_Tick every few ms and
drains received packets. Login is anonymous (Connect interface + Device ID),
so players need no Epic account.
"""
import ctypes
import json
import os
import queue
import random
import threading
import time
from ctypes import (CFUNCTYPE, POINTER, Structure, Union, byref, c_char, c_char_p, c_double, c_int32,
                    c_int64, c_uint8, c_uint32, c_uint64, c_void_p, cast, create_string_buffer, sizeof)

# --------------------------------------------------------------------- constants
EOS_Success, EOS_InvalidUser, EOS_NotFound, EOS_DuplicateNotAllowed = 0, 3, 18, 24
EOS_ECT_DEVICEID_ACCESS_TOKEN = 10
EOS_LPL_PUBLICADVERTISED = 0
EOS_LAT_PUBLIC = 0
EOS_AT_STRING = 3
EOS_CO_EQUAL = 0
EOS_RC_AllowRelays = 1
EOS_PF_DISABLE_OVERLAY = 0x2
MAX_PACKET = 1170
FRAG_PAYLOAD = MAX_PACKET - 1          # 1 header byte: 1 = last fragment, 0 = more follow
SOCKET_NAME = b"TSS"
CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
LOBBY_BUCKET = b"tss:v1"

# ------------------------------------------------------------------- structures
ProductUserId = c_void_p
CALLBACK = CFUNCTYPE(None, c_void_p)  # every EOS callback receives one const struct pointer


class InitializeOptions(Structure):
    _fields_ = [("ApiVersion", c_int32), ("AllocateMemoryFunction", c_void_p), ("ReallocateMemoryFunction", c_void_p),
                ("ReleaseMemoryFunction", c_void_p), ("ProductName", c_char_p), ("ProductVersion", c_char_p),
                ("Reserved", c_void_p), ("SystemInitializeOptions", c_void_p), ("OverrideThreadAffinity", c_void_p)]


class ClientCredentials(Structure):
    _fields_ = [("ClientId", c_char_p), ("ClientSecret", c_char_p)]


class PlatformOptions(Structure):
    _fields_ = [("ApiVersion", c_int32), ("Reserved", c_void_p), ("ProductId", c_char_p), ("SandboxId", c_char_p),
                ("ClientCredentials", ClientCredentials), ("bIsServer", c_int32), ("EncryptionKey", c_char_p),
                ("OverrideCountryCode", c_char_p), ("OverrideLocaleCode", c_char_p), ("DeploymentId", c_char_p),
                ("Flags", c_uint64), ("CacheDirectory", c_char_p), ("TickBudgetInMilliseconds", c_uint32),
                ("RTCOptions", c_void_p), ("IntegratedPlatformOptionsContainerHandle", c_void_p),
                ("SystemSpecificOptions", c_void_p), ("TaskNetworkTimeoutSeconds", POINTER(c_double))]


class CreateDeviceIdOptions(Structure):
    _fields_ = [("ApiVersion", c_int32), ("DeviceModel", c_char_p)]


class DeleteDeviceIdOptions(Structure):
    _fields_ = [("ApiVersion", c_int32)]


class ResultInfo(Structure):  # common prefix of the simple callback infos
    _fields_ = [("ResultCode", c_int32), ("ClientData", c_void_p)]


class ConnectCredentials(Structure):
    _fields_ = [("ApiVersion", c_int32), ("Token", c_char_p), ("Type", c_int32)]


class UserLoginInfo(Structure):
    _fields_ = [("ApiVersion", c_int32), ("DisplayName", c_char_p), ("NsaIdToken", c_char_p)]


class LoginOptions(Structure):
    _fields_ = [("ApiVersion", c_int32), ("Credentials", POINTER(ConnectCredentials)), ("UserLoginInfo", POINTER(UserLoginInfo))]


class LoginCallbackInfo(Structure):
    _fields_ = [("ResultCode", c_int32), ("ClientData", c_void_p), ("LocalUserId", ProductUserId), ("ContinuanceToken", c_void_p)]


class CreateUserOptions(Structure):
    _fields_ = [("ApiVersion", c_int32), ("ContinuanceToken", c_void_p)]


class CreateUserCallbackInfo(Structure):
    _fields_ = [("ResultCode", c_int32), ("ClientData", c_void_p), ("LocalUserId", ProductUserId)]


class CreateLobbyOptions(Structure):
    _fields_ = [("ApiVersion", c_int32), ("LocalUserId", ProductUserId), ("MaxLobbyMembers", c_uint32),
                ("PermissionLevel", c_int32), ("bPresenceEnabled", c_int32), ("bAllowInvites", c_int32),
                ("BucketId", c_char_p), ("bDisableHostMigration", c_int32), ("bEnableRTCRoom", c_int32),
                ("LocalRTCOptions", c_void_p), ("LobbyId", c_char_p), ("bEnableJoinById", c_int32),
                ("bRejoinAfterKickRequiresInvite", c_int32), ("AllowedPlatformIds", c_void_p),
                ("AllowedPlatformIdsCount", c_uint32), ("bCrossplayOptOut", c_int32), ("RTCRoomJoinActionType", c_int32)]


class LobbyCallbackInfo(Structure):  # Create / Destroy / Update callbacks share this layout
    _fields_ = [("ResultCode", c_int32), ("ClientData", c_void_p), ("LobbyId", c_char_p)]


class DestroyLobbyOptions(Structure):
    _fields_ = [("ApiVersion", c_int32), ("LocalUserId", ProductUserId), ("LobbyId", c_char_p)]


class UpdateLobbyModificationOptions(Structure):
    _fields_ = [("ApiVersion", c_int32), ("LocalUserId", ProductUserId), ("LobbyId", c_char_p)]


class UpdateLobbyOptions(Structure):
    _fields_ = [("ApiVersion", c_int32), ("LobbyModificationHandle", c_void_p)]


class AttributeValue(Union):
    _fields_ = [("AsInt64", c_int64), ("AsDouble", c_double), ("AsBool", c_int32), ("AsUtf8", c_char_p)]


class AttributeData(Structure):
    _fields_ = [("ApiVersion", c_int32), ("Key", c_char_p), ("Value", AttributeValue), ("ValueType", c_int32)]


class AddAttributeOptions(Structure):
    _fields_ = [("ApiVersion", c_int32), ("Attribute", POINTER(AttributeData)), ("Visibility", c_int32)]


class CreateLobbySearchOptions(Structure):
    _fields_ = [("ApiVersion", c_int32), ("MaxResults", c_uint32)]


class SetParameterOptions(Structure):
    _fields_ = [("ApiVersion", c_int32), ("Parameter", POINTER(AttributeData)), ("ComparisonOp", c_int32)]


class FindOptions(Structure):
    _fields_ = [("ApiVersion", c_int32), ("LocalUserId", ProductUserId)]


class ApiVersionOnly(Structure):
    _fields_ = [("ApiVersion", c_int32)]


class CopySearchResultOptions(Structure):
    _fields_ = [("ApiVersion", c_int32), ("LobbyIndex", c_uint32)]


class SocketId(Structure):
    _fields_ = [("ApiVersion", c_int32), ("SocketName", c_char * 33)]


class SendPacketOptions(Structure):
    _fields_ = [("ApiVersion", c_int32), ("LocalUserId", ProductUserId), ("RemoteUserId", ProductUserId),
                ("SocketId", POINTER(SocketId)), ("Channel", c_uint8), ("DataLengthBytes", c_uint32), ("Data", c_void_p),
                ("bAllowDelayedDelivery", c_int32), ("Reliability", c_int32), ("bDisableAutoAcceptConnection", c_int32)]


class NextPacketSizeOptions(Structure):
    _fields_ = [("ApiVersion", c_int32), ("LocalUserId", ProductUserId), ("RequestedChannel", c_void_p)]


class ReceivePacketOptions(Structure):
    _fields_ = [("ApiVersion", c_int32), ("LocalUserId", ProductUserId), ("MaxDataSizeBytes", c_uint32), ("RequestedChannel", c_void_p)]


class NotifyOptions(Structure):  # AddNotifyPeerConnection{Request,Established,Closed}
    _fields_ = [("ApiVersion", c_int32), ("LocalUserId", ProductUserId), ("SocketId", POINTER(SocketId))]


class PeerInfo(Structure):  # common prefix of the P2P notification infos
    _fields_ = [("ClientData", c_void_p), ("LocalUserId", ProductUserId), ("RemoteUserId", ProductUserId),
                ("SocketId", POINTER(SocketId)), ("Extra", c_int32)]


class PeerOptions(Structure):  # Accept / CloseConnection
    _fields_ = [("ApiVersion", c_int32), ("LocalUserId", ProductUserId), ("RemoteUserId", ProductUserId), ("SocketId", POINTER(SocketId))]


class CloseConnectionsOptions(Structure):
    _fields_ = [("ApiVersion", c_int32), ("LocalUserId", ProductUserId), ("SocketId", POINTER(SocketId))]


class RelayControlOptions(Structure):
    _fields_ = [("ApiVersion", c_int32), ("RelayControl", c_int32)]


class LogMessage(Structure):
    _fields_ = [("Category", c_char_p), ("Message", c_char_p), ("Level", c_int32)]


LOGFUNC = CFUNCTYPE(None, POINTER(LogMessage))


# ------------------------------------------------------------------------ bridge
class EOSBridge:
    def __init__(self, dll_path, config, on_events, data_dir=None, log=print):
        self.dll_path = dll_path
        self.cfg = config
        self.on_events = on_events
        self.data_dir = data_dir
        self.log = log
        self.cmds = queue.Queue()
        self.events = queue.Queue()
        self.state = "starting"           # starting | ready | error
        self.message = None               # why, when state == error
        self.user = None                  # our ProductUserId (handle)
        self.user_str = None
        self.lobby_id = None
        self.code = None
        self.peers = {}                   # peer string -> handle
        self.reassembly = {}              # (peer, channel) -> bytearray
        self._keep = []                   # ctypes callbacks / buffers that must stay alive
        self._closing = False
        threading.Thread(target=self._run, name="eos-worker", daemon=True).start()
        threading.Thread(target=self._dispatch, name="eos-events", daemon=True).start()

    # ------------------------------------------------------------- public API
    def host(self):
        self.cmds.put(("host",))

    def join(self, code):
        self.cmds.put(("join", str(code).upper()))

    def send(self, peer, channel, mode, text):
        self.cmds.put(("send", peer, int(channel), int(mode), text))

    def send_many(self, batch):
        """batch: [[peer, channel, mode, text], ...] (one call per game frame)."""
        for item in batch:
            self.cmds.put(("send", str(item[0]), int(item[1]), int(item[2]), item[3]))

    def stop(self):
        self.cmds.put(("stop",))

    def status(self):
        return {"state": self.state, "user": self.user_str, "code": self.code, "message": self.message}

    def shutdown(self):
        self._closing = True
        self.cmds.put(("quit",))

    # ------------------------------------------------------------- internals
    def _emit(self, kind, **data):
        data["type"] = kind
        self.events.put(data)

    def _dispatch(self):
        """Deliver events to the page in batches (keeps the EOS thread free)."""
        while True:
            batch = [self.events.get()]
            time.sleep(0.004)
            while not self.events.empty() and len(batch) < 400:
                batch.append(self.events.get_nowait())
            try:
                self.on_events(batch)
            except Exception as exc:  # page not ready / reloading: drop
                self.log(f"[eos] event delivery failed: {exc}")

    def _cb(self, fn, info_type):
        """Wrap a Python function as an EOS completion callback."""
        def raw(ptr):
            try:
                fn(cast(ptr, POINTER(info_type)).contents)
            except Exception as exc:
                self.log(f"[eos] callback error: {exc}")
        c = CALLBACK(raw)
        self._keep.append(c)
        return c

    def _socket(self):
        s = SocketId(1, SOCKET_NAME)
        self._keep.append(s)
        return s

    def _puid_str(self, handle):
        buf = create_string_buffer(64)
        n = c_int32(64)
        if self.dll.EOS_ProductUserId_ToString(handle, buf, byref(n)) == EOS_Success:
            return buf.value.decode()
        return None

    def _puid(self, text):
        return self.dll.EOS_ProductUserId_FromString(text.encode())

    def _run(self):
        try:
            self._init()
        except Exception as exc:
            self.state = "error"
            self.message = str(exc)
            self._emit("error", op="init", code=-1, message=str(exc))
            self.log(f"[eos] init failed: {exc}")
            return
        while not self._closing:
            try:
                while True:
                    cmd = self.cmds.get_nowait()
                    self._command(cmd)
            except queue.Empty:
                pass
            self.dll.EOS_Platform_Tick(self.platform)
            if self.user:
                self._receive()
            time.sleep(0.003)
        self._close_all()
        self.dll.EOS_Platform_Tick(self.platform)

    def _init(self):
        dll = self.dll = ctypes.CDLL(self.dll_path)
        sig = {
            "EOS_Initialize": (c_int32, [POINTER(InitializeOptions)]),
            "EOS_Platform_Create": (c_void_p, [POINTER(PlatformOptions)]),
            "EOS_Platform_Tick": (None, [c_void_p]),
            "EOS_Platform_GetConnectInterface": (c_void_p, [c_void_p]),
            "EOS_Platform_GetLobbyInterface": (c_void_p, [c_void_p]),
            "EOS_Platform_GetP2PInterface": (c_void_p, [c_void_p]),
            "EOS_Logging_SetCallback": (c_int32, [LOGFUNC]),
            "EOS_Logging_SetLogLevel": (c_int32, [c_int32, c_int32]),
            "EOS_ProductUserId_ToString": (c_int32, [c_void_p, c_char_p, POINTER(c_int32)]),
            "EOS_ProductUserId_FromString": (c_void_p, [c_char_p]),
            "EOS_Connect_CreateDeviceId": (None, [c_void_p, POINTER(CreateDeviceIdOptions), c_void_p, CALLBACK]),
            "EOS_Connect_DeleteDeviceId": (None, [c_void_p, POINTER(DeleteDeviceIdOptions), c_void_p, CALLBACK]),
            "EOS_Connect_Login": (None, [c_void_p, POINTER(LoginOptions), c_void_p, CALLBACK]),
            "EOS_Connect_CreateUser": (None, [c_void_p, POINTER(CreateUserOptions), c_void_p, CALLBACK]),
            "EOS_Lobby_CreateLobby": (None, [c_void_p, POINTER(CreateLobbyOptions), c_void_p, CALLBACK]),
            "EOS_Lobby_DestroyLobby": (None, [c_void_p, POINTER(DestroyLobbyOptions), c_void_p, CALLBACK]),
            "EOS_Lobby_UpdateLobbyModification": (c_int32, [c_void_p, POINTER(UpdateLobbyModificationOptions), POINTER(c_void_p)]),
            "EOS_LobbyModification_AddAttribute": (c_int32, [c_void_p, POINTER(AddAttributeOptions)]),
            "EOS_LobbyModification_Release": (None, [c_void_p]),
            "EOS_Lobby_UpdateLobby": (None, [c_void_p, POINTER(UpdateLobbyOptions), c_void_p, CALLBACK]),
            "EOS_Lobby_CreateLobbySearch": (c_int32, [c_void_p, POINTER(CreateLobbySearchOptions), POINTER(c_void_p)]),
            "EOS_LobbySearch_SetParameter": (c_int32, [c_void_p, POINTER(SetParameterOptions)]),
            "EOS_LobbySearch_Find": (None, [c_void_p, POINTER(FindOptions), c_void_p, CALLBACK]),
            "EOS_LobbySearch_GetSearchResultCount": (c_uint32, [c_void_p, POINTER(ApiVersionOnly)]),
            "EOS_LobbySearch_CopySearchResultByIndex": (c_int32, [c_void_p, POINTER(CopySearchResultOptions), POINTER(c_void_p)]),
            "EOS_LobbySearch_Release": (None, [c_void_p]),
            "EOS_LobbyDetails_GetLobbyOwner": (c_void_p, [c_void_p, POINTER(ApiVersionOnly)]),
            "EOS_LobbyDetails_Release": (None, [c_void_p]),
            "EOS_P2P_SetRelayControl": (c_int32, [c_void_p, POINTER(RelayControlOptions)]),
            "EOS_P2P_AddNotifyPeerConnectionRequest": (c_uint64, [c_void_p, POINTER(NotifyOptions), c_void_p, CALLBACK]),
            "EOS_P2P_AddNotifyPeerConnectionEstablished": (c_uint64, [c_void_p, POINTER(NotifyOptions), c_void_p, CALLBACK]),
            "EOS_P2P_AddNotifyPeerConnectionClosed": (c_uint64, [c_void_p, POINTER(NotifyOptions), c_void_p, CALLBACK]),
            "EOS_P2P_AcceptConnection": (c_int32, [c_void_p, POINTER(PeerOptions)]),
            "EOS_P2P_CloseConnection": (c_int32, [c_void_p, POINTER(PeerOptions)]),
            "EOS_P2P_CloseConnections": (c_int32, [c_void_p, POINTER(CloseConnectionsOptions)]),
            "EOS_P2P_SendPacket": (c_int32, [c_void_p, POINTER(SendPacketOptions)]),
            "EOS_P2P_GetNextReceivedPacketSize": (c_int32, [c_void_p, POINTER(NextPacketSizeOptions), POINTER(c_uint32)]),
            "EOS_P2P_ReceivePacket": (c_int32, [c_void_p, POINTER(ReceivePacketOptions), POINTER(c_void_p), POINTER(SocketId),
                                                POINTER(c_uint8), c_void_p, POINTER(c_uint32)]),
        }
        for name, (res, args) in sig.items():
            f = getattr(dll, name)
            f.restype, f.argtypes = res, args

        cfg = self.cfg
        init = InitializeOptions(5, None, None, None, cfg["productName"].encode(), cfg.get("productVersion", "1.0").encode(), None, None, None)
        r = dll.EOS_Initialize(byref(init))
        if r not in (EOS_Success, 15):  # 15 = AlreadyConfigured (page reload in the same process)
            raise RuntimeError(f"EOS_Initialize failed ({r})")

        def on_log(msg):
            m = msg.contents
            if m.Level <= 300:  # warnings and worse
                self.log(f"[eos:{(m.Category or b'').decode()}] {(m.Message or b'').decode(errors='replace')}")
        self._logfn = LOGFUNC(on_log)
        dll.EOS_Logging_SetCallback(self._logfn)
        dll.EOS_Logging_SetLogLevel(0x7fffffff, 300)

        cache = os.path.join(self.data_dir or os.getcwd(), "eos-cache")
        os.makedirs(cache, exist_ok=True)
        opts = PlatformOptions()
        opts.ApiVersion = 15
        opts.ProductId = cfg["productId"].encode()
        opts.SandboxId = cfg["sandboxId"].encode()
        opts.DeploymentId = cfg["deploymentId"].encode()
        opts.ClientCredentials = ClientCredentials(cfg["clientId"].encode(), cfg["clientSecret"].encode())
        opts.Flags = EOS_PF_DISABLE_OVERLAY
        opts.CacheDirectory = cache.encode()
        self.platform = dll.EOS_Platform_Create(byref(opts))
        if not self.platform:
            raise RuntimeError("EOS_Platform_Create failed (check the product IDs and client credentials)")
        self.connect = dll.EOS_Platform_GetConnectInterface(self.platform)
        self.lobby = dll.EOS_Platform_GetLobbyInterface(self.platform)
        self.p2p = dll.EOS_Platform_GetP2PInterface(self.platform)
        dll.EOS_P2P_SetRelayControl(self.p2p, byref(RelayControlOptions(1, EOS_RC_AllowRelays)))
        self._login(fresh=os.environ.get("TSS_EOS_FRESH_DEVICE") == "1")

    # ---------------------------------------------------------------- login
    def _login(self, fresh=False):
        dll = self.dll

        def create_device():
            def done(info):
                if info.ResultCode not in (EOS_Success, EOS_DuplicateNotAllowed):
                    self._fail("login", info.ResultCode, "could not create a device ID")
                    return
                login()
            dll.EOS_Connect_CreateDeviceId(self.connect, byref(CreateDeviceIdOptions(1, b"PC Windows")), None, self._cb(done, ResultInfo))

        def login():
            creds = ConnectCredentials(1, None, EOS_ECT_DEVICEID_ACCESS_TOKEN)
            info = UserLoginInfo(2, b"Subject", None)
            self._keep += [creds, info]
            opts = LoginOptions(2, ctypes.pointer(creds), ctypes.pointer(info))
            dll.EOS_Connect_Login(self.connect, byref(opts), None, self._cb(logged_in, LoginCallbackInfo))

        def logged_in(info):
            if info.ResultCode == EOS_Success:
                self._ready(info.LocalUserId)
            elif info.ResultCode == EOS_InvalidUser and info.ContinuanceToken:
                opts = CreateUserOptions(1, info.ContinuanceToken)
                dll.EOS_Connect_CreateUser(self.connect, byref(opts), None, self._cb(created, CreateUserCallbackInfo))
            elif info.ResultCode == EOS_NotFound:
                create_device()
            else:
                self._fail("login", info.ResultCode, "login failed")

        def created(info):
            if info.ResultCode == EOS_Success:
                self._ready(info.LocalUserId)
            else:
                self._fail("login", info.ResultCode, "could not create the user")

        if fresh:  # testing only: a brand-new anonymous identity for a second instance on the same PC
            dll.EOS_Connect_DeleteDeviceId(self.connect, byref(DeleteDeviceIdOptions(1)), None, self._cb(lambda i: create_device(), ResultInfo))
        else:
            create_device()

    def _ready(self, user):
        self.user = user
        self.user_str = self._puid_str(user)
        self.state = "ready"
        sock = self._socket()
        n = NotifyOptions(1, user, None)
        self._keep.append(n)

        def on_request(info):
            peer = self._puid_str(info.RemoteUserId)
            self.peers[peer] = info.RemoteUserId
            self.dll.EOS_P2P_AcceptConnection(self.p2p, byref(PeerOptions(1, self.user, info.RemoteUserId, ctypes.pointer(sock))))

        def on_open(info):
            peer = self._puid_str(info.RemoteUserId)
            self.peers[peer] = info.RemoteUserId
            self._emit("peer-open", peer=peer)

        def on_closed(info):
            peer = self._puid_str(info.RemoteUserId)
            self.peers.pop(peer, None)
            self._emit("peer-closed", peer=peer, reason=info.Extra)

        self.dll.EOS_P2P_AddNotifyPeerConnectionRequest(self.p2p, byref(n), None, self._cb(on_request, PeerInfo))
        self.dll.EOS_P2P_AddNotifyPeerConnectionEstablished(self.p2p, byref(n), None, self._cb(on_open, PeerInfo))
        self.dll.EOS_P2P_AddNotifyPeerConnectionClosed(self.p2p, byref(n), None, self._cb(on_closed, PeerInfo))
        self._emit("ready", user=self.user_str)
        self.log(f"[eos] logged in as {self.user_str}")

    def _fail(self, op, code, message):
        if op == "login":
            self.state = "error"
            self.message = f"{message} ({code})"
        self._emit("error", op=op, code=int(code), message=message)
        self.log(f"[eos] {op} failed ({code}): {message}")

    # ------------------------------------------------------------- commands
    def _command(self, cmd):
        kind = cmd[0]
        if kind == "quit":
            self._closing = True
        elif self.state != "ready":
            if kind in ("host", "join"):
                self._fail(kind, -2, "online service not ready")
        elif kind == "host":
            self._host()
        elif kind == "join":
            self._join(cmd[1])
        elif kind == "send":
            self._send(*cmd[1:])
        elif kind == "stop":
            self._close_all()

    def _host(self):
        self._close_all()
        dll = self.dll
        code = "".join(random.choice(CODE_ALPHABET) for _ in range(6))
        opts = CreateLobbyOptions()
        opts.ApiVersion = 10
        opts.LocalUserId = self.user
        opts.MaxLobbyMembers = 8
        opts.PermissionLevel = EOS_LPL_PUBLICADVERTISED
        opts.bPresenceEnabled = 0
        opts.bAllowInvites = 0
        opts.BucketId = LOBBY_BUCKET
        opts.bDisableHostMigration = 1
        opts.bEnableRTCRoom = 0

        def created(info):
            if info.ResultCode != EOS_Success:
                self._fail("host", info.ResultCode, "could not create the lobby")
                return
            self.lobby_id = info.LobbyId
            mod = c_void_p()
            r = dll.EOS_Lobby_UpdateLobbyModification(self.lobby, byref(UpdateLobbyModificationOptions(1, self.user, self.lobby_id)), byref(mod))
            if r != EOS_Success:
                self._fail("host", r, "could not edit the lobby")
                return
            attr = AttributeData(1, b"CODE", AttributeValue(AsUtf8=code.encode()), EOS_AT_STRING)
            dll.EOS_LobbyModification_AddAttribute(mod, byref(AddAttributeOptions(2, ctypes.pointer(attr), EOS_LAT_PUBLIC)))

            def updated(info2):
                dll.EOS_LobbyModification_Release(mod)
                if info2.ResultCode != EOS_Success:
                    self._fail("host", info2.ResultCode, "could not publish the lobby code")
                    return
                self.code = code
                self._emit("hosted", code=code)
            dll.EOS_Lobby_UpdateLobby(self.lobby, byref(UpdateLobbyOptions(1, mod)), None, self._cb(updated, LobbyCallbackInfo))

        dll.EOS_Lobby_CreateLobby(self.lobby, byref(opts), None, self._cb(created, LobbyCallbackInfo))

    def _join(self, code):
        self._close_all()
        dll = self.dll
        search = c_void_p()
        r = dll.EOS_Lobby_CreateLobbySearch(self.lobby, byref(CreateLobbySearchOptions(1, 1)), byref(search))
        if r != EOS_Success:
            self._fail("join", r, "could not start the search")
            return
        attr = AttributeData(1, b"CODE", AttributeValue(AsUtf8=code.encode()), EOS_AT_STRING)
        self._keep.append(attr)
        dll.EOS_LobbySearch_SetParameter(search, byref(SetParameterOptions(1, ctypes.pointer(attr), EOS_CO_EQUAL)))

        def found(info):
            try:
                if info.ResultCode != EOS_Success or dll.EOS_LobbySearch_GetSearchResultCount(search, byref(ApiVersionOnly(1))) == 0:
                    self._fail("join", EOS_NotFound if info.ResultCode in (EOS_Success, EOS_NotFound) else info.ResultCode, "no such room")
                    return
                details = c_void_p()
                dll.EOS_LobbySearch_CopySearchResultByIndex(search, byref(CopySearchResultOptions(1, 0)), byref(details))
                owner = dll.EOS_LobbyDetails_GetLobbyOwner(details, byref(ApiVersionOnly(1)))
                host = self._puid_str(owner)
                dll.EOS_LobbyDetails_Release(details)
                if not host:
                    self._fail("join", EOS_NotFound, "no such room")
                    return
                self.peers[host] = self._puid(host)
                self.code = code
                self._emit("joined", host=host)
            finally:
                dll.EOS_LobbySearch_Release(search)

        dll.EOS_LobbySearch_Find(search, byref(FindOptions(1, self.user)), None, self._cb(found, ResultInfo))

    def _send(self, peer, channel, mode, text):
        handle = self.peers.get(peer) or self._puid(peer)
        self.peers.setdefault(peer, handle)
        data = text.encode("utf-8") if isinstance(text, str) else bytes(text)
        sock = self._socket()
        chunks = [data[i:i + FRAG_PAYLOAD] for i in range(0, len(data), FRAG_PAYLOAD)] or [b""]
        if len(chunks) > 1:
            mode = 2  # fragments must arrive in order
        for i, chunk in enumerate(chunks):
            packet = bytes([1 if i == len(chunks) - 1 else 0]) + chunk
            buf = create_string_buffer(packet, len(packet))
            opts = SendPacketOptions(3, self.user, handle, ctypes.pointer(sock), channel, len(packet),
                                     cast(buf, c_void_p), 1, mode, 0)
            r = self.dll.EOS_P2P_SendPacket(self.p2p, byref(opts))
            if r != EOS_Success:
                self.log(f"[eos] send failed ({r})")
                return

    def _receive(self):
        dll = self.dll
        size = c_uint32()
        opts = NextPacketSizeOptions(2, self.user, None)
        buf = create_string_buffer(MAX_PACKET + 16)
        peer_h = c_void_p()
        sock = SocketId()
        ch = c_uint8()
        written = c_uint32()
        ropts = ReceivePacketOptions(2, self.user, MAX_PACKET + 16, None)
        for _ in range(512):
            if dll.EOS_P2P_GetNextReceivedPacketSize(self.p2p, byref(opts), byref(size)) != EOS_Success:
                return
            if dll.EOS_P2P_ReceivePacket(self.p2p, byref(ropts), byref(peer_h), byref(sock), byref(ch), buf, byref(written)) != EOS_Success:
                return
            raw = buf.raw[:written.value]
            if not raw:
                continue
            peer = self._puid_str(peer_h)
            key = (peer, ch.value)
            part = self.reassembly.setdefault(key, bytearray())
            part += raw[1:]
            if raw[0] == 1:
                del self.reassembly[key]
                self._emit("msg", peer=peer, ch=ch.value, data=part.decode("utf-8", errors="replace"))

    def _close_all(self):
        dll = self.dll
        if self.user:
            sock = self._socket()
            dll.EOS_P2P_CloseConnections(self.p2p, byref(CloseConnectionsOptions(1, self.user, ctypes.pointer(sock))))
        if self.lobby_id:
            lid = self.lobby_id
            self.lobby_id = None
            dll.EOS_Lobby_DestroyLobby(self.lobby, byref(DestroyLobbyOptions(1, self.user, lid)), None,
                                       self._cb(lambda info: None, LobbyCallbackInfo))
        self.code = None
        self.peers.clear()
        self.reassembly.clear()


def load_config(*candidates):
    """First existing eos_config.json among the candidate paths, or None."""
    for path in candidates:
        if path and os.path.exists(path):
            with open(path, encoding="utf-8") as f:
                return json.load(f)
    return None
