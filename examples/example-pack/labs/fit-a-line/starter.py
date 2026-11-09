# %% [given] id=g-data
import numpy as np

rng = np.random.default_rng(1)
x = np.linspace(0, 10, 40)
y = 2.5 * x - 1.0 + rng.normal(0, 1.5, x.size)

# %% [markdown] id=n-intro
# Fit the points above with a straight line. The brief on the right says what
# each milestone asks for; **Smoke checks** runs quick shape checks any time.

# %% id=c-fit
def fit_line(x, y):
    """Return (slope, intercept) of the least-squares line."""
    raise NotImplementedError

# %% id=c-r2
def r_squared(x, y):
    """The fraction of the variance in y that the fitted line explains."""
    raise NotImplementedError
