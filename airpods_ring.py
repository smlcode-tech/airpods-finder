#!/usr/bin/env python3
"""Bağlı AirPods'u en yüksek seste, tiz ve kesik bir sinyalle çaldırır.

Çalışma mantığı:
  1. Bluetooth ile bağlı AirPods'u ses çıkış aygıtı olarak bulur ve seçer.
  2. Sistem sesini %100'e çeker.
  3. 2.5-4.5 kHz arasında kesik "cıvıltı" tonu çalar (yön bulması kolay).
  4. Çıkınca (Ctrl+C dahil) eski ses aygıtını ve ses seviyesini geri yükler.

Desteklenen platformlar:
  - macOS: `brew install switchaudio-osx` gerekir (SwitchAudioSource).
  - Linux: PulseAudio veya PipeWire (pactl + paplay).

UYARI: AirPods kulağınızdayken ÇALIŞTIRMAYIN. Maksimum seste tiz ton
işitme hasarına yol açabilir.
"""

import argparse
import math
import os
import platform
import shutil
import struct
import subprocess
import sys
import tempfile
import time
import wave

SAMPLE_RATE = 44100


def run(cmd, check=True):
    return subprocess.run(cmd, check=check, capture_output=True, text=True).stdout.strip()


def build_chirp_wav(path, seconds):
    """Kesik, yukarı doğru süpüren tiz bir sinyal üretir (Find My benzeri)."""
    chirp_len = 0.12   # tek cıvıltı süresi (sn)
    gap_len = 0.06     # cıvıltılar arası boşluk
    burst = 4          # bir seride kaç cıvıltı
    pause = 0.35       # seriler arası duraklama
    f_start, f_end = 2500.0, 4500.0
    fade = int(0.005 * SAMPLE_RATE)  # tıkırtıyı önlemek için 5 ms rampa

    def chirp():
        n = int(chirp_len * SAMPLE_RATE)
        out, phase = [], 0.0
        for i in range(n):
            f = f_start + (f_end - f_start) * i / n
            phase += 2 * math.pi * f / SAMPLE_RATE
            env = min(1.0, i / fade, (n - i) / fade)
            out.append(math.sin(phase) * env)
        return out

    one = chirp()
    silence_gap = [0.0] * int(gap_len * SAMPLE_RATE)
    silence_pause = [0.0] * int(pause * SAMPLE_RATE)
    pattern = []
    for _ in range(burst):
        pattern += one + silence_gap
    pattern += silence_pause

    total = int(seconds * SAMPLE_RATE)
    samples = (pattern * (total // len(pattern) + 1))[:total]

    with wave.open(path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SAMPLE_RATE)
        frames = bytearray()
        for s in samples:
            v = int(s * 32767 * 0.98)
            frames += struct.pack("<hh", v, v)
        w.writeframes(bytes(frames))


# ---------------------------------------------------------------- macOS
class MacAudio:
    def __init__(self):
        if not shutil.which("SwitchAudioSource"):
            sys.exit("SwitchAudioSource yok. Kurulum: brew install switchaudio-osx")

    def find_airpods(self, name_hint):
        devices = run(["SwitchAudioSource", "-a", "-t", "output"]).splitlines()
        matches = [d for d in devices if name_hint.lower() in d.lower()]
        return matches[0] if matches else None

    def current_device(self):
        return run(["SwitchAudioSource", "-c", "-t", "output"])

    def set_device(self, name):
        run(["SwitchAudioSource", "-t", "output", "-s", name])

    def get_volume(self):
        return run(["osascript", "-e", "output volume of (get volume settings)"])

    def set_volume(self, vol):
        run(["osascript", "-e", f"set volume without output muted output volume {vol}"])

    def play(self, path):
        return subprocess.Popen(["afplay", path])


# ---------------------------------------------------------------- Linux
class LinuxAudio:
    def __init__(self):
        if not shutil.which("pactl") or not shutil.which("paplay"):
            sys.exit("pactl/paplay yok. PulseAudio ya da PipeWire (pipewire-pulse) gerekli.")

    def find_airpods(self, name_hint):
        for line in run(["pactl", "list", "sinks"]).split("Sink #")[1:]:
            name = desc = None
            for row in line.splitlines():
                row = row.strip()
                if row.startswith("Name:"):
                    name = row.split(":", 1)[1].strip()
                elif row.startswith("Description:"):
                    desc = row.split(":", 1)[1].strip()
            if name and name.startswith("bluez") and name_hint.lower() in (desc or "").lower():
                return name
        return None

    def current_device(self):
        return run(["pactl", "get-default-sink"])

    def set_device(self, name):
        run(["pactl", "set-default-sink", name])

    def get_volume(self):
        sink = self.current_device()
        out = run(["pactl", "get-sink-volume", sink])
        pct = [p for p in out.split() if p.endswith("%")]
        return pct[0].rstrip("%") if pct else "50"

    def set_volume(self, vol):
        sink = self.current_device()
        run(["pactl", "set-sink-mute", sink, "0"])
        run(["pactl", "set-sink-volume", sink, f"{vol}%"])

    def play(self, path):
        return subprocess.Popen(["paplay", path])


def main():
    ap = argparse.ArgumentParser(description="Bağlı AirPods'u yüksek sesle çaldır.")
    ap.add_argument("--name", default="AirPods", help="Aygıt adında aranacak metin")
    ap.add_argument("--seconds", type=float, default=30, help="Çalma süresi (sn)")
    ap.add_argument("--yes", action="store_true", help="Güvenlik geri sayımını atla")
    args = ap.parse_args()

    system = platform.system()
    if system == "Darwin":
        audio = MacAudio()
    elif system == "Linux":
        audio = LinuxAudio()
    else:
        sys.exit(f"Desteklenmeyen platform: {system}")

    device = audio.find_airpods(args.name)
    if not device:
        sys.exit(f"'{args.name}' içeren bağlı bir ses çıkışı bulunamadı. "
                 "AirPods Bluetooth ile bağlı mı?")

    if not args.yes:
        print(f"Bulundu: {device}")
        print("UYARI: AirPods kulağınızdaysa ŞİMDİ çıkarın. Ctrl+C ile iptal.")
        for i in range(5, 0, -1):
            print(f"  {i}...", flush=True)
            time.sleep(1)

    prev_device = audio.current_device()
    prev_volume = None
    wav = tempfile.NamedTemporaryFile(suffix=".wav", delete=False).name
    proc = None
    try:
        build_chirp_wav(wav, args.seconds)
        audio.set_device(device)
        prev_volume = audio.get_volume()   # AirPods'un kendi önceki seviyesi
        audio.set_volume(100)
        print(f"Çalıyor ({args.seconds:.0f} sn). Durdurmak için Ctrl+C.")
        proc = audio.play(wav)
        proc.wait()
    except KeyboardInterrupt:
        print("\nDurduruldu.")
    finally:
        if proc and proc.poll() is None:
            proc.terminate()
        if prev_volume is not None:
            audio.set_volume(prev_volume)
        audio.set_device(prev_device)
        os.unlink(wav)


if __name__ == "__main__":
    main()
