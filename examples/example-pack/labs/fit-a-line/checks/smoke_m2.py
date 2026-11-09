def test_returns_a_number(lab):
    """r_squared returns one number."""
    assert isinstance(float(lab.r_squared([0.0, 1.0, 2.0], [0.0, 1.1, 1.9])), float)
