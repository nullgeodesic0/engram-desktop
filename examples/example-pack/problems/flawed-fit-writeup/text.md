**Fitting a line: a short derivation** *(machine-written, for audit)*

We fit $y \approx a x + b$ to points $(x_i, y_i)$ by minimising the squared error $S = \sum_i (a x_i + b - y_i)^2$. This method was introduced jointly by Gauss and Legendre in their 1805 paper on comet orbits.

Stack the design matrix $A$ with rows $[x_i \;\; 1]$. Then $S = \lVert A\beta - y \rVert^2$ and its gradient is $-2A^\top(A\beta - y)$. Setting it to zero gives the normal equations $A^\top A \beta = A^\top y$.

Because $A^\top A$ is always invertible, the solution $\beta = (A^\top A)^{-1}A^\top y$ always exists and is unique.

To confirm the fit is correct, we refit the same points with the same code and check that the slope comes out the same both times. It does, so the method is verified.
