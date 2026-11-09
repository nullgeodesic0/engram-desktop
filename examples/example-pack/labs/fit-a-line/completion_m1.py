# %% [markdown] id=m1-partial-note
# The pack's partial solution for M1: the design matrix is built for you.
# Finish the two lines marked TODO.

# %% id=m1-partial
def fit_line(x, y):
    """Return (slope, intercept) of the least-squares line."""
    x = np.asarray(x, float)
    y = np.asarray(y, float)
    A = np.column_stack([x, np.ones_like(x)])
    beta = ...  # TODO: solve the normal equations for beta
    return ...  # TODO: (slope, intercept) as plain floats
