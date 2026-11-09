"""Practice variant of M1: least squares with three unknowns, a parabola."""

import numpy as np
import pytest


def test_recovers_an_exact_parabola(lab):
    """Points on a parabola give back its coefficients."""
    x = np.array([-2.0, -1.0, 0.0, 1.0, 2.0])
    a, b, c = lab.fit_parabola(x, 0.5 * x**2 - x + 3)
    assert np.allclose([a, b, c], [0.5, -1, 3], atol=1e-9)


def test_minimises_squared_error_on_noisy_data(lab):
    """On noisy data the parabola minimises the sum of squared vertical errors."""
    rng = np.random.default_rng(11)
    x = rng.uniform(-3, 3, 200)
    y = -0.4 * x**2 + 2 * x + 1 + rng.normal(0, 0.5, x.size)
    assert np.allclose(lab.fit_parabola(x, y), np.polyfit(x, y, 2), atol=1e-8), "not the least-squares parabola"


@pytest.mark.slip
def test_returns_plain_floats(lab):
    """The three coefficients come back as Python floats."""
    out = lab.fit_parabola(np.array([0.0, 1.0, 2.0]), np.array([1.0, 2.0, 5.0]))
    assert all(type(v) is float for v in out)
