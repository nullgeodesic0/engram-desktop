import numpy as np
import pytest


def test_perfect_fit_is_one(lab):
    assert abs(lab.r_squared([0, 1, 2, 3], [2, 4, 6, 8]) - 1) < 1e-9


def test_matches_correlation_squared(lab):
    rng = np.random.default_rng(3)
    x = rng.normal(size=300)
    y = 0.5 * x + rng.normal(size=300)
    want = np.corrcoef(x, y)[0, 1] ** 2
    assert abs(lab.r_squared(x, y) - want) < 1e-9


@pytest.mark.slip
def test_in_unit_interval_for_noise(lab):
    rng = np.random.default_rng(9)
    r2 = lab.r_squared(rng.normal(size=50), rng.normal(size=50))
    assert 0 <= r2 <= 1
