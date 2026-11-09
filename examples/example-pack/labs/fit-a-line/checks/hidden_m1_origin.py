"""Practice variant of M1: least squares with one unknown, the slope through the origin."""

import numpy as np
import pytest


def test_recovers_an_exact_slope(lab):
    """Points on a line through the origin give back its slope."""
    assert abs(lab.fit_through_origin([1, 2, 3], [2.5, 5, 7.5]) - 2.5) < 1e-9


def test_minimises_squared_error_on_noisy_data(lab):
    """On noisy data the slope minimises the sum of squared vertical errors."""
    rng = np.random.default_rng(7)
    x = rng.uniform(-4, 4, 150)
    y = 1.3 * x + rng.normal(0, 1, x.size)
    want = float(x @ y / (x @ x))
    assert abs(lab.fit_through_origin(x, y) - want) < 1e-8, "the slope is not the least-squares slope through the origin"


@pytest.mark.slip
def test_returns_a_plain_float(lab):
    """The slope comes back as a Python float."""
    assert type(lab.fit_through_origin(np.array([1.0, 2.0]), np.array([1.0, 2.0]))) is float
