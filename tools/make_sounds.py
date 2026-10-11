"""Render the game's synthesized sounds to WAV files (port of core/audio.js).

Usage:  python tools/make_sounds.py

Writes godot/assets/sfx/<name>.wav for every effect and
godot/assets/music/<style>.wav for the looping beds ('menu', 'tension').
Python standard library only. The recipes are the web version's: oscillator
bursts with exponential pitch sweeps and filtered-noise bursts, shaped by
attack + exponential decay envelopes.
"""
import math
import os
import random
import struct
import wave

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SFX_DIR = os.path.join(ROOT, "godot", "assets", "sfx")
MUSIC_DIR = os.path.join(ROOT, "godot", "assets", "music")
SR = 32000
random.seed(4242)
NOISE = [random.random() * 2 - 1 for _ in range(SR * 2)]


def osc(kind, phase):
    p = phase % 1.0
    if kind == "sine":
        return math.sin(p * math.tau)
    if kind == "square":
        return 1.0 if p < 0.5 else -1.0
    if kind == "sawtooth":
        return 2.0 * p - 1.0
    if kind == "triangle":
        return 4.0 * abs(p - 0.5) - 1.0
    return 0.0


def envelope(t, attack, peak, decay, sustain=0.0):
    """Web Audio: linear ramp 0.0001 -> peak over attack, then exponential to sustain over decay."""
    if t < 0:
        return 0.0
    if t < attack:
        return 0.0001 + (peak - 0.0001) * (t / attack)
    s = max(0.0001, sustain)
    k = min(1.0, (t - attack) / max(decay, 1e-6))
    if k >= 1.0:
        return s if sustain > 0 else 0.0
    return peak * (s / peak) ** k if peak > 0 else 0.0


class Biquad:
    """RBJ cookbook biquad with coefficients refreshed as the cutoff moves."""

    def __init__(self, kind, q):
        self.kind, self.q = kind, q
        self.x1 = self.x2 = self.y1 = self.y2 = 0.0
        self.set(1000.0)

    def set(self, f):
        f = min(max(f, 10.0), SR * 0.45)
        w = math.tau * f / SR
        cw, sw = math.cos(w), math.sin(w)
        alpha = sw / (2 * max(self.q, 1e-4))
        if self.kind == "lowpass":
            b0, b1, b2 = (1 - cw) / 2, 1 - cw, (1 - cw) / 2
        elif self.kind == "highpass":
            b0, b1, b2 = (1 + cw) / 2, -(1 + cw), (1 + cw) / 2
        else:  # bandpass (constant 0 dB peak gain)
            b0, b1, b2 = alpha, 0.0, -alpha
        a0, a1, a2 = 1 + alpha, -2 * cw, 1 - alpha
        self.b = (b0 / a0, b1 / a0, b2 / a0)
        self.a = (a1 / a0, a2 / a0)

    def run(self, x):
        b0, b1, b2 = self.b
        a1, a2 = self.a
        y = b0 * x + b1 * self.x1 + b2 * self.x2 - a1 * self.y1 - a2 * self.y2
        self.x2, self.x1 = self.x1, x
        self.y2, self.y1 = self.y1, y
        return y


class Mix:
    def __init__(self, seconds):
        self.buf = [0.0] * int(seconds * SR)

    def _add(self, start, samples):
        i0 = int(start * SR)
        for i, v in enumerate(samples):
            j = i0 + i
            if 0 <= j < len(self.buf):
                self.buf[j] += v

    def tone(self, type="square", freq=440, to=None, dur=0.15, vol=0.3, attack=0.005, delay=0.0):
        n = int((attack + dur + 0.05) * SR)
        out, phase = [], random.random() * 0
        for i in range(n):
            t = i / SR
            f = freq if to is None else freq * (max(1.0, to) / freq) ** min(1.0, t / dur)
            phase += f / SR
            out.append(osc(type, phase) * envelope(t, attack, vol, dur))
        self._add(delay, out)

    def noise(self, dur=0.2, vol=0.4, filter="lowpass", freq=2000, to=None, q=1.0, attack=0.002, delay=0.0):
        n = int((attack + dur + 0.05) * SR)
        bq = Biquad(filter, q)
        start = random.randrange(len(NOISE))
        out = []
        for i in range(n):
            t = i / SR
            if i % 32 == 0:
                bq.set(freq if to is None else freq * (max(20.0, to) / freq) ** min(1.0, t / dur))
            out.append(bq.run(NOISE[(start + i) % len(NOISE)]) * envelope(t, attack, vol, dur))
        self._add(delay, out)


def write_wav(path, samples, sr=SR):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    peak = max(1e-9, max(abs(s) for s in samples))
    gain = 1.0 if peak <= 0.98 else 0.98 / peak
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(b"".join(struct.pack("<h", int(max(-1, min(1, s * gain)) * 32767)) for s in samples))


def trim(buf):
    end = len(buf)
    while end > 1 and abs(buf[end - 1]) < 1e-4:
        end -= 1
    return buf[:max(end, 1)]


SFX = {
    "click": lambda m: m.tone(type="square", freq=900, dur=0.03, vol=0.12),
    "select": lambda m: (m.tone(type="square", freq=520, dur=0.06, vol=0.15), m.tone(type="square", freq=780, dur=0.08, vol=0.12, delay=0.05)),
    "back": lambda m: m.tone(type="square", freq=400, to=200, dur=0.1, vol=0.12),
    "join": lambda m: (m.tone(type="sawtooth", freq=220, to=660, dur=0.18, vol=0.15), m.noise(dur=0.1, vol=0.1, freq=4000)),
    "tick": lambda m: m.tone(type="square", freq=1200, dur=0.02, vol=0.08),
    "beep": lambda m: m.tone(type="square", freq=880, dur=0.12, vol=0.18),
    "go": lambda m: (m.tone(type="sawtooth", freq=440, dur=0.4, vol=0.2), m.tone(type="sawtooth", freq=660, dur=0.4, vol=0.15)),
    "horn": lambda m: (m.tone(type="sawtooth", freq=110, dur=0.9, vol=0.3, attack=0.05), m.tone(type="sawtooth", freq=138, dur=0.9, vol=0.25, attack=0.05)),
    "buzz": lambda m: m.tone(type="sawtooth", freq=90, dur=0.35, vol=0.25),
    "ding": lambda m: (m.tone(type="sine", freq=1320, dur=0.5, vol=0.2), m.tone(type="sine", freq=1980, dur=0.4, vol=0.08)),
    "wrong": lambda m: (m.tone(type="square", freq=200, dur=0.12, vol=0.18), m.tone(type="square", freq=150, dur=0.2, vol=0.18, delay=0.1)),
    "shot": lambda m: (m.noise(dur=0.25, vol=0.8, freq=3000, to=300), m.tone(type="square", freq=160, to=40, dur=0.15, vol=0.4)),
    "reload": lambda m: (m.noise(dur=0.04, vol=0.3, filter="bandpass", freq=3000, q=5), m.noise(dur=0.05, vol=0.3, filter="bandpass", freq=2000, q=5, delay=0.15)),
    "explode": lambda m: (m.noise(dur=1.0, vol=0.9, freq=1200, to=60), m.tone(type="sine", freq=80, to=25, dur=0.8, vol=0.6)),
    "crunch": lambda m: (m.noise(dur=0.18, vol=0.6, filter="bandpass", freq=900, q=2), m.noise(dur=0.12, vol=0.4, filter="bandpass", freq=1800, q=3, delay=0.06)),
    "splat": lambda m: (m.noise(dur=0.3, vol=0.5, freq=600, to=120), m.tone(type="sine", freq=120, to=50, dur=0.2, vol=0.3)),
    "snap": lambda m: (m.noise(dur=0.05, vol=0.7, filter="highpass", freq=2500), m.noise(dur=0.08, vol=0.5, filter="bandpass", freq=1200, q=4, delay=0.04)),
    "thud": lambda m: (m.tone(type="sine", freq=110, to=40, dur=0.18, vol=0.5), m.noise(dur=0.08, vol=0.2, freq=500)),
    "shove": lambda m: (m.noise(dur=0.12, vol=0.35, freq=1500, to=400), m.tone(type="sine", freq=180, to=90, dur=0.1, vol=0.25)),
    "whoosh": lambda m: m.noise(dur=0.35, vol=0.3, filter="bandpass", freq=400, to=2500, q=2),
    "metal": lambda m: (m.tone(type="triangle", freq=640, dur=0.4, vol=0.18), m.tone(type="triangle", freq=1013, dur=0.3, vol=0.12), m.noise(dur=0.05, vol=0.3, filter="highpass", freq=3000)),
    "clank": lambda m: (m.tone(type="square", freq=300, to=180, dur=0.12, vol=0.2), m.noise(dur=0.08, vol=0.3, filter="bandpass", freq=2500, q=3)),
    "saw": lambda m: m.tone(type="sawtooth", freq=900, to=1400, dur=0.25, vol=0.12),
    "grind": lambda m: (m.noise(dur=0.6, vol=0.4, filter="bandpass", freq=300, q=3), m.tone(type="sawtooth", freq=55, dur=0.6, vol=0.3)),
    "train": lambda m: (m.noise(dur=2.2, vol=0.7, freq=400, to=2000, attack=0.6), m.tone(type="sawtooth", freq=70, dur=2.0, vol=0.3, attack=0.5)),
    "trainHorn": lambda m: (m.tone(type="sawtooth", freq=311, dur=1.0, vol=0.2, attack=0.05), m.tone(type="sawtooth", freq=370, dur=1.0, vol=0.2, attack=0.05)),
    "sonar": lambda m: m.tone(type="sine", freq=1500, to=900, dur=0.6, vol=0.18),
    "burn": lambda m: m.noise(dur=0.6, vol=0.35, filter="bandpass", freq=800, to=300, q=1),
    "puff": lambda m: m.noise(dur=0.5, vol=0.18, filter="bandpass", freq=600, to=1600, q=1, attack=0.15),
    "inhale": lambda m: m.noise(dur=0.3, vol=0.1, filter="bandpass", freq=1200, q=2, attack=0.1),
    "cough": lambda m: [m.noise(dur=0.12, vol=0.4, filter="bandpass", freq=500, q=1.5, delay=i * 0.18) for i in range(3)],
    "chew": lambda m: m.noise(dur=0.07, vol=0.2, filter="bandpass", freq=700, q=3),
    "fork": lambda m: m.tone(type="triangle", freq=2400, dur=0.06, vol=0.08),
    "chisel": lambda m: (m.noise(dur=0.07, vol=0.4, filter="bandpass", freq=2200, q=4), m.tone(type="triangle", freq=1700, dur=0.06, vol=0.1)),
    "engine": lambda m: m.tone(type="sawtooth", freq=60, to=80, dur=0.3, vol=0.12),
    "step": lambda m: m.noise(dur=0.04, vol=0.12, freq=900),
    "spider": lambda m: [m.tone(type="square", freq=2200 + i * 80, dur=0.02, vol=0.06, delay=i * 0.03) for i in range(4)],
    "inject": lambda m: (m.noise(dur=0.1, vol=0.3, filter="highpass", freq=3000), m.tone(type="sine", freq=300, to=900, dur=0.3, vol=0.15)),
    "search": lambda m: (m.noise(dur=0.15, vol=0.2, filter="bandpass", freq=1200, q=2), m.tone(type="square", freq=200, dur=0.05, vol=0.06, delay=0.08)),
    "win": lambda m: [m.tone(type="square", freq=f, dur=0.18, vol=0.12, delay=i * 0.12) for i, f in enumerate((523, 659, 784, 1046))],
    "sting": lambda m: (m.tone(type="sawtooth", freq=60, dur=1.6, vol=0.4, attack=0.01), m.noise(dur=1.4, vol=0.4, freq=500, to=80), m.tone(type="sawtooth", freq=63, dur=1.6, vol=0.3)),
}


def render_sfx():
    for name, recipe in SFX.items():
        m = Mix(3.0)
        recipe(m)
        write_wav(os.path.join(SFX_DIR, name + ".wav"), trim(m.buf))
    print(len(SFX), "effects written to", SFX_DIR)


def render_music(style):
    sr = 22050
    menu = style == "menu"
    bpm = 84 if menu else 112
    step = 60 / bpm / 2
    patterns = 5 if menu else 8
    pattern = ["k", "", "", "m", "", "", "k", "", "k", "", "n", "", "", "m", "", "n"] if menu else \
              ["k", "", "n", "", "k", "k", "n", "", "k", "", "n", "m", "k", "", "n", "n"]
    loop = step * 16 * patterns
    lfo_f = round((0.07 if menu else 0.25) * loop) / loop
    cutoff, depth = (260, 160) if menu else (380, 120)
    root = 41.2 if menu else 49.0
    freqs = [round(root * 2 ** (c / 1200) * loop) / loop for c in (0, 7, -5)]  # whole cycles per loop
    total = int(loop * 3 * sr)
    out = [0.0] * total
    # Drone: three detuned saws through a slowly sweeping resonant low-pass.
    global SR
    keep_sr, SR = SR, sr
    bq = Biquad("lowpass", 6)
    for i in range(total):
        t = i / sr
        if i % 64 == 0:
            bq.set(cutoff + depth * math.sin(math.tau * lfo_f * t))
        x = sum(osc("sawtooth", f * t) for f in freqs)
        out[i] = bq.run(x) * 0.12
    # Percussion on the grid.
    m = Mix(loop * 3 + 1)
    for k in range(16 * patterns * 3):
        hit = pattern[k % 16]
        at = k * step
        if hit == "k":
            m.tone(type="sine", freq=90, to=35, dur=0.25, vol=0.5, delay=at)
        elif hit == "n":
            m.noise(dur=0.08, vol=0.18, filter="highpass", freq=5000, delay=at)
        elif hit == "m":
            m.tone(type="triangle", freq=330, dur=0.5, vol=0.08, delay=at)
            m.noise(dur=0.15, vol=0.12, filter="bandpass", freq=2500, q=8, delay=at)
    for i in range(total):
        out[i] += m.buf[i]
    SR = keep_sr
    # The middle loop is in steady state (tails from the previous loop included) and repeats seamlessly.
    n = int(loop * sr)
    seg = out[n:2 * n]
    write_wav(os.path.join(MUSIC_DIR, style + ".wav"), seg, sr)
    print("music", style, f"{loop:.2f}s")


if __name__ == "__main__":
    render_sfx()
    render_music("menu")
    render_music("tension")
