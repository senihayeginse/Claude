#!/usr/bin/env python3
"""Measure an audio track's beat grid into beats.json, optionally normalizing it to -14 LUFS.

Usage:
  python3 beats.py score.wav [-o beats.json] [--normalize score.norm.wav]
  python3 beats.py --bpm 120 --duration 30 [--offset 0.0] [-o beats.json]   # grid for a score not yet synthesized

beats.json:
  {"source", "duration", "tempo", "beats": [s...], "bars": [s...], "onsets": [{"t", "strength"}...]}
  "bars" are every 4th beat, phased to the strongest onsets (an estimate, not a true downbeat tracker).
"""
import argparse
import json
import re
import subprocess

import numpy as np

TARGET_LUFS = -14.0
TRUE_PEAK = -1.0
LRA = 11.0


def round_list(values):
    return [round(float(v), 3) for v in values]


def measure(path):
    import librosa

    y, sr = librosa.load(path, sr=22050, mono=True)
    duration = len(y) / sr
    onset_env = librosa.onset.onset_strength(y=y, sr=sr)
    # librosa's own trim drops real beats on steady synthesized scores, so trim
    # only leading/trailing beats that sit in near-silence, and the end-of-file edge.
    tempo, beat_frames = librosa.beat.beat_track(onset_envelope=onset_env, sr=sr, trim=False)
    if len(beat_frames):
        floor = 0.1 * np.median(onset_env[beat_frames])
        strong = np.flatnonzero(onset_env[beat_frames] >= floor)
        beat_frames = beat_frames[strong[0]:strong[-1] + 1] if len(strong) else beat_frames[:0]
    beats = librosa.frames_to_time(beat_frames, sr=sr)
    beats = beats[beats < duration - 0.05]
    beat_frames = beat_frames[: len(beats)]

    onset_frames = librosa.onset.onset_detect(onset_envelope=onset_env, sr=sr)
    strengths = onset_env[onset_frames]
    strengths = strengths / strengths.max() if len(strengths) and strengths.max() > 0 else strengths
    onsets = [
        {"t": round(float(t), 3), "strength": round(float(s), 3)}
        for t, s in zip(librosa.frames_to_time(onset_frames, sr=sr), strengths)
    ]

    # Pick the 4-beat phase whose beats land on the most onset energy.
    phase = 0
    if len(beat_frames) >= 8:
        phase = int(np.argmax([onset_env[beat_frames[k::4]].sum() for k in range(4)]))

    return {
        "source": path,
        "duration": round(duration, 3),
        "tempo": round(float(np.atleast_1d(tempo)[0]), 2),
        "beats": round_list(beats),
        "bars": round_list(beats[phase::4]),
        "onsets": onsets,
    }


def grid(bpm, duration, offset):
    beats = np.arange(offset, duration, 60.0 / bpm)
    return {
        "source": None,
        "duration": round(duration, 3),
        "tempo": round(bpm, 2),
        "beats": round_list(beats),
        "bars": round_list(beats[::4]),
        "onsets": [],
    }


def loudnorm_stats(path, extra=""):
    """Run ffmpeg's loudnorm analysis pass and return its JSON stats."""
    af = f"loudnorm=I={TARGET_LUFS}:TP={TRUE_PEAK}:LRA={LRA}{extra}:print_format=json"
    proc = subprocess.run(
        ["ffmpeg", "-hide_banner", "-nostats", "-i", path, "-af", af, "-f", "null", "-"],
        capture_output=True, text=True, check=True,
    )
    return json.loads(re.findall(r"\{[^{}]*\}", proc.stderr)[-1])


def normalize(src, dst):
    """Two-pass EBU R128 normalization to TARGET_LUFS; returns the output's integrated loudness."""
    s = loudnorm_stats(src)
    measured = (
        f":measured_I={s['input_i']}:measured_TP={s['input_tp']}:measured_LRA={s['input_lra']}"
        f":measured_thresh={s['input_thresh']}:offset={s['target_offset']}:linear=true"
    )
    af = f"loudnorm=I={TARGET_LUFS}:TP={TRUE_PEAK}:LRA={LRA}{measured}"
    subprocess.run(
        ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", src, "-af", af, "-ar", "48000", dst],
        check=True,
    )
    return float(loudnorm_stats(dst)["input_i"])


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("audio", nargs="?", help="track to analyze")
    p.add_argument("-o", "--out", default="beats.json")
    p.add_argument("--normalize", metavar="OUT", help=f"also write a {TARGET_LUFS:g} LUFS copy of the track")
    p.add_argument("--bpm", type=float, help="build a fixed grid instead of analyzing audio")
    p.add_argument("--duration", type=float, help="grid length in seconds (with --bpm)")
    p.add_argument("--offset", type=float, default=0.0, help="time of the first beat (with --bpm)")
    a = p.parse_args()

    if a.bpm:
        if not a.duration:
            p.error("--bpm needs --duration")
        data = grid(a.bpm, a.duration, a.offset)
    elif a.audio:
        if a.normalize:
            lufs = normalize(a.audio, a.normalize)
            print(f"normalized: {a.normalize} at {lufs:.1f} LUFS")
        data = measure(a.audio)
    else:
        p.error("give an audio file, or --bpm and --duration")

    with open(a.out, "w") as f:
        json.dump(data, f, indent=1)
    print(f"{a.out}: {data['tempo']} BPM, {len(data['beats'])} beats, {len(data['bars'])} bars, "
          f"{len(data['onsets'])} onsets over {data['duration']}s")


if __name__ == "__main__":
    main()
