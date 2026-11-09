"""Hidden tests for M1. Core: the method is right. Slip: execution details.

Each test is named for the behaviour it checks, and its docstring's first line
is what the learner sees while the milestone is open. The assertion message
appears only once the milestone has passed, so it never hands out the answer.
"""

import numpy as np
import pytest


def test_recovers_an_exact_line(lab):
    """Points that lie exactly on a line give back that line."""
    slope, intercept = lab.fit_line([0, 1, 2, 3], [1, 3, 5, 7])
    assert abs(slope - 2) < 1e-9 and abs(intercept - 1) < 1e-9


def test_minimises_squared_error_on_noisy_data(lab):
    """On noisy data the line minimises the sum of squared vertical errors."""
    rng = np.random.default_rng(42)
    x = rng.uniform(-5, 5, 200)
    y = -0.7 * x + 3 + rng.normal(0, 2, x.size)
    want = np.polyfit(x, y, 1)
    assert np.allclose(lab.fit_line(x, y), want, atol=1e-8), "the fit is not the least-squares line"


@pytest.mark.slip
def test_returns_plain_floats(lab):
    """The slope and intercept come back as Python floats."""
    slope, intercept = lab.fit_line(np.array([0.0, 1.0]), np.array([0.0, 2.0]))
    assert type(slope) is float and type(intercept) is float, "return Python floats, not NumPy scalars or arrays"
