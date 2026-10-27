import math

import numpy as np
from scipy.signal import savgol_filter


def px_per_m_from_mask(mask: np.ndarray, real_length_m: float) -> float:
    ys, xs = np.nonzero(mask)
    if xs.size < 2 or real_length_m <= 0:
        raise ValueError("mask too small or invalid length")
    pts = np.column_stack([xs, ys]).astype(float)
    centered = pts - pts.mean(axis=0)
    _, _, vt = np.linalg.svd(centered, full_matrices=False)
    proj = centered @ vt[0]
    return float((proj.max() - proj.min()) / real_length_m)


def px_per_m_from_points(p1: tuple[float, float], p2: tuple[float, float], distance_m: float) -> float:
    px = math.dist(p1, p2)
    if px == 0 or distance_m <= 0:
        raise ValueError("points must differ and distance must be positive")
    return px / distance_m


def displacement_m(centroids_px: list[tuple[float, float]], px_per_m: float) -> np.ndarray:
    pts = np.asarray(centroids_px, dtype=float)
    centered = pts - pts.mean(axis=0)
    _, _, vt = np.linalg.svd(centered, full_matrices=False)
    s = centered @ vt[0]
    s = s - s[0]
    if s[-1] < 0:
        s = -s
    return s / px_per_m


def smooth(values: np.ndarray, window: int = 7) -> np.ndarray:
    v = np.asarray(values, dtype=float)
    w = min(window, len(v) if len(v) % 2 else len(v) - 1)
    if w < 3:
        return v
    return savgol_filter(v, w, 2)


def analyze_motion(t, s, key_name: str, ref_value: float | None = None) -> dict:
    t = np.asarray(t, dtype=float)
    s_raw = np.asarray(s, dtype=float)
    s_smooth = smooth(s_raw)
    c2, c1, c0 = np.polyfit(t, s_smooth, 2)
    pred = np.polyval([c2, c1, c0], t)
    ss_res = float(np.sum((s_raw - pred) ** 2))
    ss_tot = float(np.sum((s_raw - s_raw.mean()) ** 2))
    r2 = 1 - ss_res / ss_tot if ss_tot > 0 else 0.0
    key = float(2 * c2)
    v = np.gradient(s_smooth, t)
    a = np.gradient(v, t)
    error_pct = abs(key - ref_value) / abs(ref_value) * 100 if ref_value else None
    return {
        "key_name": key_name,
        "key_value": key,
        "ref_value": ref_value,
        "error_pct": error_pct,
        "r2": float(r2),
        "fit": {"s0": float(c0), "v0": float(c1), "a_fit": key},
        "series": {
            "t": t.tolist(),
            "x": s_smooth.tolist(),
            "v": v.tolist(),
            "a": a.tolist(),
        },
    }
