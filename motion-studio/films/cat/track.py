#!/usr/bin/env python3
"""Track the reference cat video into tracks.json, one entry per frame of one loop.

Usage: python3 films/cat/track.py reference.mp4 [-o films/cat/tracks.json]

The reference loops every 270 frames (9 s at 30 fps). The loop is cut to start at
reference frame START, with the cat already sitting. Per frame it records the two
ear tips, the left eye (centre x, lid top, lid bottom, width; the right eye sits
GAP px to its right) and the tail centreline, all in the 980x736 reference space.
"""
import argparse
import json
import subprocess

import numpy as np
from scipy import ndimage
from skimage.morphology import skeletonize

PERIOD, START = 270, 100
X0, Y0, W, H = 260, 220, 400, 260          # crop around the cat
TAIL_X = [315, 325, 335, 345, 355, 365, 375, 385, 395]
SPINE_N = 7          # points along the tail's centreline, tip first
BODY_X = 399         # the tail is everything left of this column


def spine(ink):
    """Tail centreline from tip to body as SPINE_N points evenly spaced along its length.

    Thinning the tail mask follows the curl at the tip, which per-column sampling cannot."""
    m = ink.copy()
    m[:, BODY_X - X0:] = False
    lab, _ = ndimage.label(m)
    edge = lab[:, BODY_X - X0 - 1]
    m = lab == np.bincount(edge[edge > 0]).argmax()
    sk = skeletonize(m)
    pts = {tuple(p) for p in np.argwhere(sk)}
    nbrs = lambda p: [(p[0] + dy, p[1] + dx) for dy in (-1, 0, 1) for dx in (-1, 0, 1)
                      if (dy or dx) and (p[0] + dy, p[1] + dx) in pts]
    root = max(pts, key=lambda p: (p[1], -abs(p[0] - (H - 15))))      # where it enters the body
    prev, dist, queue = {root: None}, {root: 0.0}, [root]
    for p in queue:                                                    # BFS over the skeleton
        for q in nbrs(p):
            if q not in prev:
                prev[q] = p
                dist[q] = dist[p] + float(np.hypot(q[0] - p[0], q[1] - p[1]))
                queue.append(q)
    tip = max(dist, key=dist.get)
    path = [tip]
    while prev[path[-1]] is not None:
        path.append(prev[path[-1]])
    path = np.array(path, float)                                       # tip -> root, (y, x)
    seg = np.r_[0, np.cumsum(np.hypot(*np.diff(path, axis=0).T))]
    at = np.linspace(0, seg[-1], SPINE_N)
    ys, xs = np.interp(at, seg, path[:, 0]), np.interp(at, seg, path[:, 1])
    return [[round(float(x + X0), 2), round(float(y + Y0), 2)] for x, y in zip(xs, ys)]


def frames(video):
    raw = subprocess.run(
        ["ffmpeg", "-loglevel", "error", "-i", video, "-vf", f"crop={W}:{H}:{X0}:{Y0},format=gray",
         "-f", "rawvideo", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.uint8).reshape(-1, H, W).astype(int)


def measure(f):
    ink = f < 110
    colh = ink.sum(0)
    body = np.flatnonzero(colh > 28)
    bl, br = body[0], body[-1]
    top = np.array([np.flatnonzero(ink[:, c])[0] if colh[c] else H for c in range(W)])
    mid = (bl + br) // 2
    lt = bl + int(np.argmin(top[bl:mid]))
    rt = mid + int(np.argmin(top[mid:br + 1]))

    eyes = []
    lab, k = ndimage.label(f > 150)
    for j in range(1, k + 1):
        ys, xs = np.nonzero(lab == j)
        if 3 <= len(xs) < 600 and xs.min() > 0 and ys.min() > 0 and xs.max() < W - 1 and ys.max() < H - 1:
            eyes.append((float(xs.mean() + X0), int(ys.min() + Y0), int(ys.max() + 1 + Y0), int(xs.max() - xs.min() + 1)))
    eyes.sort()

    tail = {}
    for x in TAIL_X:
        ys = np.flatnonzero(ink[:, x - X0])
        if 0 < len(ys) < 40:
            tail[x] = float(ys.mean() + Y0)
    tx = int(np.flatnonzero(ink.any(0))[0])
    tys = np.flatnonzero(ink[:, tx:tx + 4].any(1))
    tip = [tx + X0 + 10, float(tys.mean() + Y0)]   # centre of the round cap

    return {
        "earL": [int(lt + X0), int(top[lt] + Y0)],
        "earR": [int(rt + X0), int(top[rt] + Y0)],
        "eye": eyes[0] if eyes else None,
        "tail": tail,
        "tip": tip,
        "spine": spine(ink),
    }


def fill_eyes(rows):
    """Closed eyes vanish from the video; give them a zero-height lid where they were."""
    centre = [None] * len(rows)
    for i, r in enumerate(rows):
        e = r["eye"]
        if e and e[2] - e[1] >= e[3] - 1:                # fully open: centre is reliable
            centre[i] = (e[1] + e[2]) / 2
    known = [i for i, c in enumerate(centre) if c is not None]
    for i in range(len(rows)):
        if centre[i] is None:
            a = max([k for k in known if k < i], default=None)
            b = min([k for k in known if k > i], default=None)
            ca, cb = (centre[a] if a is not None else centre[b]), (centre[b] if b is not None else centre[a])
            ta = 0 if a is None or b is None else (i - a) / (b - a)
            centre[i] = ca + (cb - ca) * ta
    out = []
    for i, r in enumerate(rows):
        e = r["eye"]
        if e is None:
            prev = next(rows[k]["eye"] for k in range(i - 1, -1, -1) if rows[k]["eye"])
            y = (prev[1] + prev[2]) / 2 + 1
            e = (prev[0], y, y, prev[3])
        out.append({"x": round(e[0], 1), "cy": round(centre[i], 1), "top": e[1], "bottom": e[2], "w": e[3]})
    return out


def main():
    p = argparse.ArgumentParser()
    p.add_argument("video")
    p.add_argument("-o", "--out", default="films/cat/tracks.json")
    a = p.parse_args()
    fs = frames(a.video)
    n = len(fs)
    rows = []
    for c in range(PERIOD):
        f = START + c
        while f >= n:
            f -= PERIOD
        rows.append(measure(fs[f]))
    eyes = fill_eyes(rows)
    for r, e in zip(rows, eyes):
        r["eye"] = e
    json.dump({"fps": 30, "frames": PERIOD, "start": START, "gap": 38, "rows": rows}, open(a.out, "w"))
    print(f"{a.out}: {PERIOD} frames from reference frame {START}")


if __name__ == "__main__":
    main()
