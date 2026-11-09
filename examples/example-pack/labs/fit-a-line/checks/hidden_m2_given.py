"""Practice variant of M2: r² of predictions from any model."""

import numpy as np
import pytest


def test_perfect_predictions_give_one(lab):
    """Predictions equal to the data explain all of its variance."""
    y = np.array([1.0, 4.0, 2.0, 8.0])
    assert abs(lab.r_squared_of(y, y) - 1) < 1e-12


def test_the_mean_explains_nothing(lab):
    """Predicting the mean everywhere explains none of the variance."""
    y = np.array([1.0, 4.0, 2.0, 8.0])
    assert abs(lab.r_squared_of(y, np.full_like(y, y.mean()))) < 1e-12


def test_matches_one_minus_the_residual_ratio(lab):
    """For any predictions, r² is one minus residual over total sum of squares."""
    rng = np.random.default_rng(3)
    y = rng.normal(0, 1, 50)
    y_hat = y + rng.normal(0, 0.5, 50)
    want = 1 - np.sum((y - y_hat) ** 2) / np.sum((y - y.mean()) ** 2)
    assert abs(lab.r_squared_of(y, y_hat) - want) < 1e-10, "not 1 − SS_res / SS_tot"


@pytest.mark.slip
def test_returns_a_plain_float(lab):
    """r² comes back as a Python float."""
    assert type(lab.r_squared_of(np.array([1.0, 2.0, 3.0]), np.array([1.0, 2.0, 2.0]))) is float
