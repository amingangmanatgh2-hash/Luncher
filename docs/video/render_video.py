#!/usr/bin/env python3
"""
Renders the DLCK LNCH setup tutorial video.

This produces an ANIMATED WALKTHROUGH (motion graphics generated from code), not a screen
recording of a physical device. Every frame is drawn here with Pillow and encoded with the
ffmpeg binary that ships with imageio-ffmpeg. The Persian narration tracks live in
.render/audio/ and were generated with text-to-speech.

No real API key is ever displayed: the key is always rendered as a masked placeholder.

Usage:
    python3 -m venv .venv
    .venv/bin/pip install pillow imageio-ffmpeg arabic-reshaper python-bidi
    .venv/bin/python docs/video/render_video.py
"""

from __future__ import annotations

import math
import os
import re
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

import arabic_reshaper
import imageio_ffmpeg
from bidi.algorithm import get_display
from PIL import Image, ImageDraw, ImageFont

# --------------------------------------------------------------------------- setup

ROOT = Path(__file__).resolve().parent
RENDER = ROOT / ".render"
AUDIO = RENDER / "audio"
FONTS = RENDER / "fonts"
OUT = ROOT / "dlck-lnch-setup-tutorial.mp4"

W, H = 1280, 720
FPS = 24
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()

BG = (8, 11, 18)
SURFACE = (13, 17, 26)
SURFACE_2 = (26, 33, 48)
PRIMARY = (34, 211, 238)
PRIMARY_DIM = (14, 116, 144)
TEXT = (236, 239, 245)
MUTED = (150, 162, 180)
GREEN = (34, 197, 94)
AMBER = (245, 158, 11)
RED = (248, 113, 113)
VIOLET = (167, 139, 250)


def font(size: int, weight: str = "Regular") -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(FONTS / f"Vazirmatn-{weight}.ttf"), size)


def fa(text: str) -> str:
    """Shape + reorder Persian text so Pillow can draw it correctly."""
    return get_display(arabic_reshaper.reshape(text))


# --------------------------------------------------------------------------- audio

def audio_duration(path: Path) -> float:
    proc = subprocess.run(
        [FFMPEG, "-i", str(path), "-f", "null", "-"],
        capture_output=True, text=True,
    )
    times = re.findall(r"time=(\d+):(\d+):(\d+\.\d+)", proc.stderr)
    if not times:
        raise RuntimeError(f"could not measure {path}")
    h, m, s = times[-1]
    return int(h) * 3600 + int(m) * 60 + float(s)


def build_narration(segments: list[str], gap: float = 0.75) -> tuple[Path, list[float]]:
    """Pads every clip with trailing silence and concatenates them into one track."""
    work = RENDER / "wav"
    work.mkdir(parents=True, exist_ok=True)
    durations, listing = [], []

    for name in segments:
        src = AUDIO / name
        dst = work / (Path(name).stem + ".wav")
        subprocess.run(
            [FFMPEG, "-y", "-i", str(src), "-af", f"apad=pad_dur={gap}",
             "-ar", "44100", "-ac", "2", str(dst)],
            capture_output=True, check=True,
        )
        durations.append(audio_duration(dst))
        listing.append(f"file '{dst.as_posix()}'")

    list_file = work / "concat.txt"
    list_file.write_text("\n".join(listing), encoding="utf-8")
    narration = work / "narration.wav"
    subprocess.run(
        [FFMPEG, "-y", "-f", "concat", "-safe", "0", "-i", str(list_file),
         "-c", "copy", str(narration)],
        capture_output=True, check=True,
    )
    return narration, durations


# --------------------------------------------------------------------------- drawing

def ease(t: float) -> float:
    t = max(0.0, min(1.0, t))
    return 1 - (1 - t) ** 3


def fade_in(draw_fn, t: float, start: float, dur: float = 0.45):
    """Calls draw_fn(alpha, offset) once the element's start time is reached."""
    if t < start:
        return
    p = ease((t - start) / dur)
    draw_fn(p, int((1 - p) * 18))


def blend(color, alpha: float, bg=BG):
    return tuple(int(bg[i] + (color[i] - bg[i]) * alpha) for i in range(3))


def rounded(d: ImageDraw.ImageDraw, box, radius, fill=None, outline=None, width=2):
    d.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def text_at(d, xy, s, f, fill, anchor="la", persian=False):
    d.text(xy, fa(s) if persian else s, font=f, fill=fill, anchor=anchor)


# Drifting aurora blobs, mirroring the launcher's own AuroraBackground composable.
AURORA = [
    (PRIMARY_DIM, 0.18, 0.14, 0.62, 0.085, 1.00, 0.90),
    (VIOLET, 0.86, 0.30, 0.52, 0.055, 1.30, 0.70),
    (PRIMARY, 0.50, 0.92, 0.70, 0.045, 0.60, 1.10),
]


def background(d: ImageDraw.ImageDraw, t: float):
    d.rectangle([0, 0, W, H], fill=BG)
    for color, bx, by, br, alpha, fx, fy in AURORA:
        cx = (bx + 0.05 * math.cos(t * 0.22 * fx)) * W
        cy = (by + 0.04 * math.sin(t * 0.19 * fy)) * H
        radius = br * W
        # concentric rings approximate a soft radial gradient cheaply
        for i in range(14):
            k = 1 - i / 14
            r = radius * k
            a = alpha * (1 - k) * 0.55
            if a <= 0.002 or r <= 2:
                continue
            d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=blend(color, a))


STEP_LABELS = [
    "Google AI Studio",
    "Create API Key",
    "Set Credential",
    "Test Connection",
    "Run Project",
    "Test AI Launcher",
]


def flow_bar(d: ImageDraw.ImageDraw, active: int, t: float):
    """Bottom pipeline showing the six setup stages."""
    y = H - 62
    x0, x1 = 70, W - 70
    n = len(STEP_LABELS)
    gap = (x1 - x0) / (n - 1)
    f = font(14)

    d.line([x0, y, x1, y], fill=SURFACE_2, width=3)
    if active >= 0:
        prog = min(1.0, active / (n - 1)) if n > 1 else 1
        d.line([x0, y, x0 + (x1 - x0) * prog, y], fill=PRIMARY_DIM, width=3)

    for i, label in enumerate(STEP_LABELS):
        cx = x0 + gap * i
        done = i < active
        current = i == active
        if current:
            pulse = 7 + math.sin(t * 5) * 2.2
            d.ellipse([cx - pulse - 5, y - pulse - 5, cx + pulse + 5, y + pulse + 5],
                      fill=blend(PRIMARY, 0.22))
            d.ellipse([cx - 9, y - 9, cx + 9, y + 9], fill=PRIMARY)
        elif done:
            d.ellipse([cx - 7, y - 7, cx + 7, y + 7], fill=PRIMARY_DIM)
        else:
            d.ellipse([cx - 6, y - 6, cx + 6, y + 6], fill=SURFACE_2)
        col = TEXT if (current or done) else MUTED
        text_at(d, (cx, y + 22), label, f, col, anchor="ma")


def header(d, title_fa: str, step_text: str, t: float):
    text_at(d, (70, 52), "DLCK LNCH", font(26, "Bold"), PRIMARY)
    text_at(d, (70, 86), "Smart AI Launcher", font(15, "Light"), MUTED)
    if step_text:
        text_at(d, (W - 70, 52), step_text, font(17, "Bold"), VIOLET, anchor="ra")
    if title_fa:
        text_at(d, (W - 70, 92), title_fa, font(28, "Bold"), TEXT, anchor="ra", persian=True)


def bullet_list(d, items, x, y, t, start=0.3, step=0.45, rtl=True, size=19, gap=44):
    f = font(size)
    for i, item in enumerate(items):
        def draw(alpha, off, item=item, i=i):
            col = blend(TEXT, alpha)
            yy = y + i * gap + off
            if rtl:
                d.ellipse([x + 4, yy + 9, x + 12, yy + 17], fill=blend(PRIMARY, alpha))
                text_at(d, (x - 12, yy), item, f, col, anchor="ra", persian=True)
            else:
                d.ellipse([x - 12, yy + 9, x - 4, yy + 17], fill=blend(PRIMARY, alpha))
                text_at(d, (x + 12, yy), item, f, col, anchor="la")
        fade_in(draw, t, start + i * step)


def phone(d, x, y, w=300, h=560, alpha=1.0):
    rounded(d, [x, y, x + w, y + h], 34, fill=blend(SURFACE, alpha), outline=blend(SURFACE_2, alpha), width=3)
    d.rounded_rectangle([x + w / 2 - 38, y + 12, x + w / 2 + 38, y + 24], radius=6,
                        fill=blend((5, 7, 12), alpha))
    return x + 18, y + 40, w - 36


# --------------------------------------------------------------------------- slides

def slide_intro(d, t, dur):
    background(d, t)
    def title(alpha, off):
        text_at(d, (W // 2, 150 + off), "DLCK LNCH", font(78, "Bold"), blend(PRIMARY, alpha), anchor="ma")
        text_at(d, (W // 2, 248 + off), "Smart AI Launcher · Gemini", font(26, "Light"),
                blend(TEXT, alpha), anchor="ma")
    fade_in(title, t, 0.1, 0.6)

    def subtitle(alpha, off):
        text_at(d, (W // 2, 312 + off), "راهنمای راه‌اندازی گام‌به‌گام", font(30, "Bold"),
                blend(TEXT, alpha), anchor="ma", persian=True)
    fade_in(subtitle, t, 0.8)

    # six chips appearing one by one
    f = font(16)
    total = len(STEP_LABELS)
    cw, ch, gx = 186, 52, 14
    total_w = total * cw + (total - 1) * gx
    sx = (W - total_w) // 2
    for i, label in enumerate(STEP_LABELS):
        def draw(alpha, off, i=i, label=label):
            x = sx + i * (cw + gx)
            yy = 400 + off
            rounded(d, [x, yy, x + cw, yy + ch], 14,
                    fill=blend(SURFACE, alpha), outline=blend(PRIMARY_DIM, alpha), width=2)
            text_at(d, (x + cw / 2, yy + ch / 2), label, f, blend(TEXT, alpha), anchor="mm")
            if i < total - 1:
                text_at(d, (x + cw + gx / 2, yy + ch / 2), "›", font(22, "Bold"),
                        blend(MUTED, alpha), anchor="mm")
        fade_in(draw, t, 1.4 + i * 0.32)

    def note(alpha, off):
        text_at(d, (W // 2, 505 + off),
                "کلید شما هرگز داخل سورس‌کد، APK یا Git ذخیره نمی‌شود",
                font(20), blend(GREEN, alpha), anchor="ma", persian=True)
    fade_in(note, t, 3.6)
    flow_bar(d, -1, t)


def slide_create_key(d, t, dur):
    background(d, t)
    header(d, "ساخت کلید Gemini", "STEP 1", t)

    # browser mock
    bx, by, bw, bh = 70, 150, 660, 400
    def browser(alpha, off):
        rounded(d, [bx, by + off, bx + bw, by + bh + off], 16,
                fill=blend(SURFACE, alpha), outline=blend(SURFACE_2, alpha), width=2)
        d.rounded_rectangle([bx, by + off, bx + bw, by + 44 + off], radius=16,
                            fill=blend(SURFACE_2, alpha))
        d.rectangle([bx, by + 30 + off, bx + bw, by + 44 + off], fill=blend(SURFACE_2, alpha))
        for i, c in enumerate([(255, 95, 86), (255, 189, 46), (39, 201, 63)]):
            cx = bx + 22 + i * 20
            d.ellipse([cx - 6, by + 16 + off, cx + 6, by + 28 + off], fill=blend(c, alpha))
        rounded(d, [bx + 90, by + 11 + off, bx + bw - 20, by + 33 + off], 11,
                fill=blend(BG, alpha))
        text_at(d, (bx + 104, by + 15 + off), "aistudio.google.com/app/apikey",
                font(14), blend(MUTED, alpha))
    fade_in(browser, t, 0.1)

    def content(alpha, off):
        text_at(d, (bx + 34, by + 78 + off), "Google AI Studio", font(30, "Bold"),
                blend(TEXT, alpha))
        text_at(d, (bx + 34, by + 122 + off), "API keys", font(18), blend(MUTED, alpha))
        rounded(d, [bx + 34, by + 160 + off, bx + bw - 34, by + 220 + off], 12,
                fill=blend(BG, alpha), outline=blend(SURFACE_2, alpha), width=1)
        text_at(d, (bx + 52, by + 178 + off), "Project · Generative Language API",
                font(15), blend(MUTED, alpha))
        text_at(d, (bx + 52, by + 196 + off), "AIza····································",
                font(15, "Bold"), blend(AMBER, alpha))
    fade_in(content, t, 0.7)

    # highlighted CTA
    if t > 1.6:
        pulse = (math.sin((t - 1.6) * 4) + 1) / 2
        bx0, by0 = bx + 34, by + 260
        rounded(d, [bx0 - 4 - pulse * 4, by0 - 4 - pulse * 4, bx0 + 228 + pulse * 4, by0 + 56 + pulse * 4],
                16, fill=blend(PRIMARY, 0.14 + pulse * 0.1))
        rounded(d, [bx0, by0, bx0 + 228, by0 + 52], 14, fill=PRIMARY)
        text_at(d, (bx0 + 114, by0 + 26), "Create API key", font(20, "Bold"), (4, 18, 26), anchor="mm")

    def masked(alpha, off):
        text_at(d, (bx + 300, by + 286 + off), "→  کپی کنید", font(19),
                blend(TEXT, alpha), anchor="la", persian=True)
    fade_in(masked, t, 2.6)

    bullet_list(d, [
        "با حساب گوگل خود وارد شوید",
        "روی Create API key بزنید",
        "کلید مثل رمز عبور است — منتشرش نکنید",
    ], W - 70, 200, t, start=3.0, step=0.5)
    flow_bar(d, 1, t)


def slide_security(d, t, dur):
    background(d, t)
    header(d, "کلید کجا ذخیره می‌شود؟", "SECURITY", t)

    # key -> encrypted store
    def key_box(alpha, off):
        rounded(d, [80, 200 + off, 360, 300 + off], 16, fill=blend(SURFACE, alpha),
                outline=blend(AMBER, alpha), width=2)
        text_at(d, (220, 224 + off), "GEMINI API KEY", font(17, "Bold"), blend(AMBER, alpha), anchor="ma")
        text_at(d, (220, 254 + off), "AIza························", font(16), blend(MUTED, alpha), anchor="ma")
    fade_in(key_box, t, 0.2)

    def arrow(alpha, off):
        d.line([370, 250, 470, 250], fill=blend(PRIMARY, alpha), width=3)
        d.polygon([(470, 242), (486, 250), (470, 258)], fill=blend(PRIMARY, alpha))
    fade_in(arrow, t, 0.9)

    def store(alpha, off):
        rounded(d, [500, 186 + off, 830, 314 + off], 18, fill=blend(SURFACE, alpha),
                outline=blend(GREEN, alpha), width=3)
        text_at(d, (665, 208 + off), "EncryptedSharedPreferences", font(18, "Bold"),
                blend(GREEN, alpha), anchor="ma")
        text_at(d, (665, 240 + off), "AES-256-GCM · Android Keystore", font(15),
                blend(TEXT, alpha), anchor="ma")
        text_at(d, (665, 268 + off), "روی همین دستگاه، خارج از بکاپ ابری", font(16),
                blend(MUTED, alpha), anchor="ma", persian=True)
    fade_in(store, t, 1.3)

    # never list
    nevers = ["Source Code", "APK", "Git Commit", "Logs", "README"]
    f = font(17, "Bold")
    for i, item in enumerate(nevers):
        def draw(alpha, off, i=i, item=item):
            x = 120 + (i % 3) * 230
            y = 380 + (i // 3) * 64 + off
            rounded(d, [x, y, x + 200, y + 48], 12, fill=blend(SURFACE, alpha),
                    outline=blend(RED, alpha * 0.8), width=2)
            text_at(d, (x + 36, y + 24), item, f, blend(TEXT, alpha), anchor="lm")
            d.line([x + 14, y + 17, x + 26, y + 31], fill=blend(RED, alpha), width=3)
            d.line([x + 26, y + 17, x + 14, y + 31], fill=blend(RED, alpha), width=3)
        fade_in(draw, t, 2.3 + i * 0.28)

    def caption(alpha, off):
        text_at(d, (W - 70, 380 + off), "کلید هرگز در این‌ها نوشته نمی‌شود", font(20, "Bold"),
                blend(RED, alpha), anchor="ra", persian=True)
        text_at(d, (W - 70, 420 + off), "با حذف برنامه، کلید هم پاک می‌شود", font(17),
                blend(MUTED, alpha), anchor="ra", persian=True)
    fade_in(caption, t, 4.0)
    flow_bar(d, 2, t)


def slide_save(d, t, dur):
    background(d, t)
    header(d, "ذخیره کلید در برنامه", "STEP 3", t)

    px, py, pw = phone(d, 110, 138)
    text_at(d, (px + pw / 2, py + 8), "AI Setup", font(20, "Bold"), TEXT, anchor="ma")

    def field(alpha, off):
        rounded(d, [px, py + 60 + off, px + pw, py + 112 + off], 12,
                fill=blend(BG, alpha), outline=blend(PRIMARY, alpha), width=2)
        text_at(d, (px + 14, py + 70 + off), "Gemini API key", font(12), blend(MUTED, alpha))
        shown = min(int((t - 1.0) * 26), 26)
        if shown > 0:
            text_at(d, (px + 14, py + 88 + off), "•" * shown, font(16, "Bold"), blend(TEXT, alpha))
    fade_in(field, t, 0.4)

    def hint(alpha, off):
        text_at(d, (px, py + 124 + off),
                "کلید ذخیره‌شده دیگر نمایش داده نمی‌شود", font(13), blend(MUTED, alpha),
                persian=True)
    fade_in(hint, t, 1.2)

    if t > 2.4:
        pulse = (math.sin((t - 2.4) * 4.4) + 1) / 2
        rounded(d, [px, py + 158, px + 150, py + 204], 12, fill=blend(PRIMARY, 0.75 + pulse * 0.25))
        text_at(d, (px + 75, py + 181), "Save credential", font(15, "Bold"), (4, 18, 26), anchor="mm")

    def saved(alpha, off):
        rounded(d, [px, py + 220 + off, px + pw, py + 262 + off], 10,
                fill=blend((6, 30, 20), alpha), outline=blend(GREEN, alpha), width=1)
        text_at(d, (px + 12, py + 232 + off), "✓  saved to encrypted store", font(14),
                blend(GREEN, alpha))
    fade_in(saved, t, 3.5)

    bullet_list(d, [
        "روی فضای خالی صفحه اصلی نگه دارید",
        "گزینه AI Setup را باز کنید",
        "کلید را بچسبانید و ذخیره را بزنید",
        "کلید فقط یک‌بار وارد می‌شود",
    ], W - 70, 210, t, start=0.6, step=0.55)
    flow_bar(d, 2, t)


def slide_test(d, t, dur):
    background(d, t)
    header(d, "تست اتصال", "STEP 4", t)

    px, py, pw = phone(d, 110, 138)
    text_at(d, (px + pw / 2, py + 8), "Gemini connection status", font(15, "Bold"), TEXT, anchor="ma")

    testing = 0.5 < t < 2.4
    connected = t >= 2.4

    if testing:
        ang = (t * 300) % 360
        cx, cy, r = px + pw / 2, py + 96, 22
        d.arc([cx - r, cy - r, cx + r, cy + r], ang, ang + 260, fill=PRIMARY, width=4)
        text_at(d, (cx, cy + 40), "Testing…", font(16), MUTED, anchor="ma")

    if connected:
        p = ease((t - 2.4) / 0.5)
        cx, cy = px + pw / 2, py + 96
        d.ellipse([cx - 26, cy - 26, cx + 26, cy + 26], fill=blend(GREEN, p * 0.25))
        d.ellipse([cx - 16, cy - 16, cx + 16, cy + 16], fill=blend(GREEN, p))
        text_at(d, (cx, cy + 36), "Connected", font(22, "Bold"), blend(GREEN, p), anchor="ma")
        text_at(d, (cx, cy + 70), "gemini-2.5-flash", font(15), blend(MUTED, p), anchor="ma")

    def errors(alpha, off):
        text_at(d, (W - 70, 180 + off), "اگر خطا دیدید، پیام دقیقاً می‌گوید چرا:", font(20, "Bold"),
                blend(TEXT, alpha), anchor="ra", persian=True)
    fade_in(errors, t, 1.4)

    rows = [
        ("400 / 401", "کلید نامعتبر است — کلید تازه بسازید", RED),
        ("403", "دسترسی API فعال نیست یا محدود شده", AMBER),
        ("429", "سهمیه تمام شده — کمی صبر کنید", AMBER),
        ("5xx", "خطای موقت گوگل — دوباره تلاش کنید", MUTED),
    ]
    for i, (code, desc, col) in enumerate(rows):
        def draw(alpha, off, i=i, code=code, desc=desc, col=col):
            y = 226 + i * 58 + off
            rounded(d, [560, y, W - 70, y + 48], 10, fill=blend(SURFACE, alpha),
                    outline=blend(SURFACE_2, alpha), width=1)
            text_at(d, (578, y + 14), code, font(16, "Bold"), blend(col, alpha))
            text_at(d, (W - 88, y + 14), desc, font(15), blend(TEXT, alpha), anchor="ra", persian=True)
        fade_in(draw, t, 1.9 + i * 0.4)
    flow_bar(d, 3, t)


def slide_install(d, t, dur):
    background(d, t)
    header(d, "نصب و انتخاب به عنوان صفحه اصلی", "STEP 5", t)

    steps = [
        ("1", "APK را نصب کنید", "dlck-lnch-1.0.0-debug.apk"),
        ("2", "Settings › Apps › Default apps", "Android system settings"),
        ("3", "Home app → DLCK LNCH", "select the new launcher"),
    ]
    for i, (num, title, sub) in enumerate(steps):
        def draw(alpha, off, i=i, num=num, title=title, sub=sub):
            y = 175 + i * 96 + off
            rounded(d, [70, y, 690, y + 78], 14, fill=blend(SURFACE, alpha),
                    outline=blend(SURFACE_2, alpha), width=2)
            d.ellipse([92, y + 22, 126, y + 56], fill=blend(PRIMARY, alpha))
            text_at(d, (109, y + 39), num, font(19, "Bold"), (4, 18, 26), anchor="mm")
            text_at(d, (668, y + 16), title, font(20, "Bold"), blend(TEXT, alpha),
                    anchor="ra", persian=True)
            text_at(d, (668, y + 47), sub, font(14), blend(MUTED, alpha), anchor="ra")
        fade_in(draw, t, 0.3 + i * 0.7)

    px, py, pw = phone(d, 840, 130, w=300, h=520)

    def homescreen(alpha, off):
        text_at(d, (px + pw / 2, py + 40 + off), "21:45", font(44, "Light"), blend(TEXT, alpha), anchor="ma")
        text_at(d, (px + pw / 2, py + 96 + off), fa("پنجشنبه ۷ مهر ۱۴۰۴"), font(15),
                blend(MUTED, alpha), anchor="ma")
        for r in range(3):
            for c in range(4):
                x = px + 16 + c * 60
                y = py + 200 + r * 66 + off
                rounded(d, [x, y, x + 46, y + 46], 12, fill=blend(SURFACE_2, alpha))
        rounded(d, [px + 10, py + 410 + off, px + pw - 10, py + 456 + off], 22,
                fill=blend(SURFACE_2, alpha))
        text_at(d, (px + 32, py + 424 + off), "Search apps, ask AI…", font(13), blend(MUTED, alpha))
    fade_in(homescreen, t, 1.2)

    if t > 3.0:
        p = ease((t - 3.0) / 0.8)
        ax = px + pw / 2
        ay = py + 380 - p * 90
        d.line([ax, py + 390, ax, ay], fill=blend(PRIMARY, 0.55), width=3)
        d.polygon([(ax - 10, ay), (ax + 10, ay), (ax, ay - 16)], fill=PRIMARY)
        text_at(d, (ax, py + 400), "swipe up", font(13), PRIMARY, anchor="ma")
    flow_bar(d, 4, t)


def slide_assistant(d, t, dur):
    background(d, t)
    header(d, "اجرای دستیار هوشمند", "STEP 6", t)

    px, py, pw = phone(d, 110, 130, w=310, h=540)
    text_at(d, (px + pw / 2, py + 6), "AI Assistant", font(17, "Bold"), TEXT, anchor="ma")

    def bubble(x, y, w, text_str, mine, alpha, persian=True, height=44):
        col = PRIMARY_DIM if mine else SURFACE_2
        rounded(d, [x, y, x + w, y + height], 14, fill=blend(col, alpha))
        text_at(d, (x + w - 12 if persian else x + 12, y + 12), text_str, font(14),
                blend(TEXT, alpha), anchor="ra" if persian else "la", persian=persian)

    def msg1(alpha, off):
        bubble(px + 60, py + 50 + off, pw - 60, "یوتیوب رو باز کن", True, alpha)
    fade_in(msg1, t, 0.5)

    def msg2(alpha, off):
        bubble(px, py + 108 + off, pw - 70, "باشه، YouTube رو باز می‌کنم", False, alpha)
    fade_in(msg2, t, 1.3)

    def msg3(alpha, off):
        bubble(px + 60, py + 168 + off, pw - 60, "تنظیمات وای‌فای رو باز کن", True, alpha)
    fade_in(msg3, t, 2.2)

    def confirm(alpha, off):
        y = py + 226 + off
        rounded(d, [px, y, px + pw - 40, y + 104], 14, fill=blend(SURFACE_2, alpha))
        text_at(d, (px + pw - 52, y + 10), "تأیید اقدام", font(14, "Bold"),
                blend(AMBER, alpha), anchor="ra", persian=True)
        text_at(d, (px + pw - 52, y + 36), "باز کردن تنظیمات وای‌فای", font(13),
                blend(TEXT, alpha), anchor="ra", persian=True)
        rounded(d, [px + 12, y + 62, px + 96, y + 92], 9, fill=blend(PRIMARY, alpha))
        text_at(d, (px + 54, y + 77), "Confirm", font(13, "Bold"), (4, 18, 26), anchor="mm")
        rounded(d, [px + 108, y + 62, px + 192, y + 92], 9, fill=None,
                outline=blend(MUTED, alpha), width=1)
        text_at(d, (px + 150, y + 77), "Cancel", font(13), blend(TEXT, alpha), anchor="mm")
    fade_in(confirm, t, 3.1)

    def dots(alpha, off):
        for i in range(3):
            a = (math.sin(t * 5 - i * 0.7) + 1) / 2
            d.ellipse([px + 14 + i * 16, py + 350, px + 22 + i * 16, py + 358],
                      fill=blend(PRIMARY, alpha * (0.3 + 0.7 * a)))
    fade_in(dots, t, 4.0)

    text_at(d, (W - 70, 168), fa("۷ اینتنت امن و تعریف‌شده"), font(22, "Bold"), TEXT, anchor="ra")
    intents = ["OPEN_APP", "SEARCH_APP", "OPEN_SETTINGS", "SHOW_APPS",
               "CREATE_TIMER", "SEARCH_WEB", "GENERAL_CHAT"]
    for i, name in enumerate(intents):
        def draw(alpha, off, i=i, name=name):
            x = 520 + (i % 2) * 300
            y = 214 + (i // 2) * 56 + off
            rounded(d, [x, y, x + 272, y + 44], 10, fill=blend(SURFACE, alpha),
                    outline=blend(PRIMARY_DIM, alpha), width=1)
            text_at(d, (x + 16, y + 12), name, font(15, "Bold"), blend(PRIMARY, alpha))
        fade_in(draw, t, 0.5 + i * 0.3)

    def warn(alpha, off):
        text_at(d, (W - 70, 560 + off), "بدون Shell Command · فقط Intentهای استاندارد اندروید",
                font(17, "Bold"), blend(GREEN, alpha), anchor="ra", persian=True)
    fade_in(warn, t, 3.2)
    flow_bar(d, 5, t)


def slide_polish(d, t, dur):
    background(d, t)
    header(d, "چیزهایی که حالش را عوض می‌کند", "POLISH", t)

    features = [
        ("Aurora", "پس‌زمینه شفق متحرک روی والپیپر", PRIMARY),
        ("Glass", "پنل‌های شیشه‌ای با لبه گرادیانی", VIOLET),
        ("Spring", "انیمیشن فنری و بازخورد لمسی", (94, 234, 212)),
        ("Voice", "دیکته با موتور گفتار خود گوشی", GREEN),
        ("Markdown", "نمایش درست bold و code در پاسخ‌ها", AMBER),
        ("Themed icon", "آیکن هماهنگ با رنگ والپیپر", (244, 114, 182)),
    ]

    for i, (title, desc, col) in enumerate(features):
        def draw(alpha, off, i=i, title=title, desc=desc, col=col):
            x = 70 + (i % 2) * 330
            y = 180 + (i // 2) * 118 + off
            rounded(d, [x, y, x + 300, y + 96], 16, fill=blend(SURFACE, alpha),
                    outline=blend(col, alpha * 0.7), width=2)
            d.ellipse([x + 18, y + 20, x + 38, y + 40], fill=blend(col, alpha))
            text_at(d, (x + 50, y + 20), title, font(19, "Bold"), blend(TEXT, alpha))
            text_at(d, (x + 282, y + 56), desc, font(15), blend(MUTED, alpha),
                    anchor="ra", persian=True)
        fade_in(draw, t, 0.25 + i * 0.42)

    # phone mock with the microphone button pulsing
    px, py, pw = phone(d, 790, 130, w=300, h=520)

    def chat(alpha, off):
        text_at(d, (px + pw / 2, py + 6 + off), "AI Assistant", font(16, "Bold"),
                blend(TEXT, alpha), anchor="ma")
        rounded(d, [px + 50, py + 46 + off, px + pw, py + 90 + off], 14,
                fill=blend(PRIMARY_DIM, alpha))
        text_at(d, (px + pw - 12, py + 58 + off), "تایمر ده دقیقه‌ای بذار", font(14),
                blend(TEXT, alpha), anchor="ra", persian=True)
        rounded(d, [px, py + 104 + off, px + pw - 55, py + 168 + off], 14,
                fill=blend(SURFACE_2, alpha))
        text_at(d, (px + pw - 67, py + 116 + off), "تایمر ۱۰ دقیقه", font(14, "Bold"),
                blend(TEXT, alpha), anchor="ra", persian=True)
        text_at(d, (px + pw - 67, py + 140 + off), "CREATE_TIMER", font(13),
                blend(PRIMARY, alpha), anchor="ra")
    fade_in(chat, t, 1.0)

    # input bar with mic
    def bar(alpha, off):
        y = py + 400 + off
        rounded(d, [px, y, px + pw - 58, y + 44], 22, fill=blend(SURFACE_2, alpha))
        text_at(d, (px + pw - 72, y + 13), "پیام بنویسید…", font(13),
                blend(MUTED, alpha), anchor="ra", persian=True)
    fade_in(bar, t, 2.0)

    if t > 2.6:
        pulse = (math.sin((t - 2.6) * 5) + 1) / 2
        cx, cy = px + pw - 26, py + 422
        r = 20 + pulse * 5
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=blend(GREEN, 0.20 + pulse * 0.12))
        d.ellipse([cx - 17, cy - 17, cx + 17, cy + 17], fill=GREEN)
        # microphone glyph
        d.rounded_rectangle([cx - 4, cy - 9, cx + 4, cy + 2], radius=4, fill=(6, 22, 14))
        d.arc([cx - 8, cy - 5, cx + 8, cy + 7], 0, 180, fill=(6, 22, 14), width=2)
        d.line([cx, cy + 7, cx, cy + 11], fill=(6, 22, 14), width=2)
        text_at(d, (cx, cy + 26), "بدون مجوز میکروفون", font(12), blend(GREEN, 0.9),
                anchor="ma", persian=True)

    flow_bar(d, 5, t)


SLIDES = [
    ("01_intro.mp3", slide_intro),
    ("02_key.mp3", slide_create_key),
    ("03_security.mp3", slide_security),
    ("04_save.mp3", slide_save),
    ("05_test.mp3", slide_test),
    ("06_install.mp3", slide_install),
    ("07_assistant.mp3", slide_assistant),
    ("08_polish.mp3", slide_polish),
]


# --------------------------------------------------------------------------- main

def main() -> int:
    if not AUDIO.exists():
        print(f"missing narration directory: {AUDIO}", file=sys.stderr)
        return 1

    names = [n for n, _ in SLIDES]
    narration, durations = build_narration(names)
    total = sum(durations)
    print(f"narration: {total:.1f}s  ({', '.join(f'{d:.1f}' for d in durations)})")

    cmd = [
        FFMPEG, "-y",
        "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
        "-i", str(narration),
        "-c:v", "libx264", "-preset", "medium", "-crf", "21", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", "-shortest",
        str(OUT),
    ]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL,
                            stderr=subprocess.PIPE)

    rendered = 0
    for (_, fn), dur in zip(SLIDES, durations):
        frames = max(1, int(round(dur * FPS)))
        for i in range(frames):
            t = i / FPS
            img = Image.new("RGB", (W, H), BG)
            d = ImageDraw.Draw(img)
            fn(d, t, dur)
            # gentle cross-fade at slide edges
            fade = min(1.0, (i / FPS) / 0.25, ((frames - i) / FPS) / 0.25)
            if fade < 1.0:
                img = Image.blend(Image.new("RGB", (W, H), BG), img, fade)
            proc.stdin.write(img.tobytes())
            rendered += 1
        print(f"  slide done ({rendered} frames)")

    proc.stdin.close()
    err = proc.stderr.read().decode("utf-8", "ignore")
    code = proc.wait()
    if code != 0:
        print(err[-3000:], file=sys.stderr)
        return code

    size_mb = OUT.stat().st_size / 1024 / 1024
    print(f"✓ {OUT}  ({size_mb:.1f} MB, {rendered} frames, {rendered / FPS:.1f}s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
