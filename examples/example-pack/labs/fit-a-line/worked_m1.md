**A sibling problem: fitting a line through the origin, $y \approx m x$.**

There is one unknown, so the design matrix has one column, $A = [x]$. The
squared error is $E(m) = \sum_i (m x_i - y_i)^2$. Setting $E'(m) = 2\sum_i x_i (m x_i - y_i) = 0$
gives the normal equation $(A^\top A)\,m = A^\top y$, that is
$m = \sum_i x_i y_i / \sum_i x_i^2$.

```python
x = np.asarray(x, float)
y = np.asarray(y, float)
A = x[:, None]                               # one column per unknown
m = np.linalg.solve(A.T @ A, A.T @ y)[0]     # the 1×1 normal equations
```

$E$ is a parabola in $m$ that opens upward whenever some $x_i \ne 0$, so the
stationary point is its minimum. M1 is the same argument with two unknowns.
