import numpy as np
import pytest

from app import catalog, measure
from app.meta import parse_frames, track_centroids

SAM_FRAME_TEXT = (
    "<0f>0<|box;x1=211;y1=228;x2=270;y2=254;w=320;h=334|><|mask;x=0;y=0;data=27,60,~...|>,"
    "1<|box;x1=155;y1=228;x2=202;y2=254;w=320;h=334|><|mask;x=0;y=0;data=27,48,~...|>"
    "<1f>0<|box;x1=10;y1=20;x2=30;y2=40;w=320;h=334|><|mask;x=0;y=0;data=1,1,~...|>"
)


def test_px_per_m_from_points():
    assert measure.px_per_m_from_points((0, 0), (300, 400), 0.5) == pytest.approx(1000)


def test_px_per_m_from_mask_uses_major_axis():
    mask = np.zeros((50, 200), dtype=bool)
    mask[20:25, 10:110] = True
    assert measure.px_per_m_from_mask(mask, 0.5) == pytest.approx(200, rel=0.02)


def test_analysis_recovers_uniform_acceleration():
    px_per_m = 100.0
    a_true = 0.4
    t = np.arange(0, 3, 1 / 30)
    s_true = 0.5 * a_true * t**2
    angle = np.radians(30)
    centroids = [(50 + s * px_per_m * np.cos(angle), 80 + s * px_per_m * np.sin(angle)) for s in s_true]

    s = measure.displacement_m(centroids, px_per_m)
    result = measure.analyze_motion(t, s, "a", ref_value=a_true)

    assert result["key_value"] == pytest.approx(a_true, rel=0.02)
    assert result["error_pct"] < 2
    assert result["r2"] > 0.99


def test_free_fall_reference_is_g():
    assert catalog.EXPERIMENTS["free_fall"].default_ref == pytest.approx(9.81)


def test_ramp_reference():
    assert catalog.ramp_reference(30) == pytest.approx(9.81 * 0.5)


def test_select_experiment_closest_match():
    assert catalog.select_experiment("tengo un carrito y una rampa").id == "mrua_ramp"
    assert catalog.select_experiment("drop a ball from the window").id == "free_fall"


def test_parse_sam_frames_and_track():
    frames = parse_frames(SAM_FRAME_TEXT)
    assert sorted(frames) == [0, 1]
    assert len(frames[0]) == 2
    track = track_centroids(frames, out_w=640, out_h=668)
    idx, cx, cy = track[0]
    assert idx == 0
    assert cx == pytest.approx(((211 + 270) / 2) / 320 * 640)
    assert cy == pytest.approx(((228 + 254) / 2) / 334 * 668)
