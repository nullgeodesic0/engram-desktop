"""Hidden tests for M1. Core: the method is right. Slip: execution details."""

import numpy as np
import pytest


def test_exact_line(lab):
    slope, intercept = lab.fit_line([0, 1, 2, 3], [1, 3, 5, 7])
    assert abs(slope - 2) < 1e-9 and abs(intercept - 1) < 1e-9


def test_matches_least_squares_on_noisy_data(lab):
    rng = np.random.default_rng(42)
    x = rng.uniform(-5, 5, 200)
    y = -0.7 * x + 3 + rng.normal(0, 2, x.size)
    want = np.polyfit(x, y, 1)
    got = lab.fit_line(x, y)
    assert np.allclose(got, want, atol=1e-8), f"expected about {want.round(4).tolist()}, got {np.round(got, 4).tolist()}"


@pytest.mark.slip
def test_returns_plain_floats(lab):
    slope, intercept = lab.fit_line(np.array([0.0, 1.0]), np.array([0.0, 2.0]))
    assert type(slope) is float and type(intercept) is float, "return Python floats, not NumPy scalars or arrays"
