"""Visible checks for M1: shape and type only."""


def test_returns_two_numbers(lab):
    """fit_line returns a (slope, intercept) pair."""
    out = lab.fit_line([0.0, 1.0, 2.0], [1.0, 3.0, 5.0])
    assert isinstance(out, tuple) and len(out) == 2, "fit_line should return (slope, intercept)"


def test_does_not_change_its_inputs(lab):
    """fit_line leaves the lists it is given unchanged."""
    x, y = [0.0, 1.0, 2.0], [1.0, 3.0, 5.0]
    lab.fit_line(x, y)
    assert x == [0.0, 1.0, 2.0] and y == [1.0, 3.0, 5.0]
