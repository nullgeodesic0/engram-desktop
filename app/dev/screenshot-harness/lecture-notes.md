# Ladder Operators

*Quantum Harmonic Oscillator · concept 2 of 10*

## Why this matters

Solving the oscillator by brute force means solving a differential equation for every energy level. Ladder operators replace that with algebra: one operator that steps you between energy levels. Everything else on your map, from the spectrum to coherent states, is built from it.

## What you already have

- **The Hamiltonian:** $H = \frac{p^2}{2m} + \frac{1}{2}m\omega^2 x^2$ is a sum of two squares. That shape is what makes the factoring below possible.
- **The canonical commutator:** $[x, p] = i\hbar$. Position and momentum do not commute, and that one fact decides how the factoring comes out.

## The idea

Start with numbers. For ordinary numbers $u$ and $v$, a sum of squares factors: $u^2 + v^2 = (u - iv)(u + iv)$.

The Hamiltonian is a sum of two squares, so you try the same move with $x$ and $p$. Define the **lowering operator**

$$a = \sqrt{\frac{m\omega}{2\hbar}}\left(x + \frac{i}{m\omega}p\right)$$

and its adjoint, the **raising operator**

$$a^\dagger = \sqrt{\frac{m\omega}{2\hbar}}\left(x - \frac{i}{m\omega}p\right).$$

Here $m$ is the mass, $\omega$ the angular frequency, and $\hbar$ the reduced Planck constant. The prefactor makes $a$ dimensionless.

For numbers, the product of the two factors would give back $H$ exactly. For operators, it does not, because $x$ and $p$ do not commute. The product picks up one extra constant, and that constant comes from $[x, p] = i\hbar$. The factoring works up to a shift of $\frac{1}{2}\hbar\omega$, and that shift is the whole story of the zero-point energy you meet later.

The general statement: $a$ and $a^\dagger$ are the two factors of the Hamiltonian. Each one moves an energy eigenstate to a neighbouring energy eigenstate, one step of $\hbar\omega$ at a time.

## Worked example

Express $x$ and $p$ in terms of the ladder operators. You will use these forms in every later calculation.

**Set up:** write $c = \sqrt{\frac{m\omega}{2\hbar}}$, so $a = c\left(x + \frac{i}{m\omega}p\right)$ and $a^\dagger = c\left(x - \frac{i}{m\omega}p\right)$.

**Add to isolate $x$:** $a + a^\dagger = 2c\,x$, so

$$x = \frac{a + a^\dagger}{2c} = \sqrt{\frac{\hbar}{2m\omega}}\,\left(a + a^\dagger\right).$$

**Subtract to isolate $p$:** $a - a^\dagger = 2c\,\frac{i}{m\omega}p$, so

$$p = \frac{m\omega}{2ic}\left(a - a^\dagger\right) = i\sqrt{\frac{m\hbar\omega}{2}}\,\left(a^\dagger - a\right).$$

**Check:** the units. $\sqrt{\hbar / m\omega}$ is a length and $\sqrt{m\hbar\omega}$ is a momentum, and $a$ is dimensionless, so both sides match.

## The common mistake

The tempting idea is that $a^\dagger a$ equals $H$ divided by $\hbar\omega$, the way $(u - iv)(u + iv)$ equals $u^2 + v^2$ for numbers. That is wrong.

It fails because the cross terms do not cancel for operators. Expanding the product leaves a term proportional to $xp - px$, which is $i\hbar$, not zero. The correct relation is $H = \hbar\omega\left(a^\dagger a + \frac{1}{2}\right)$. The $\frac{1}{2}$ is the commutator, carried through.

## Where it leads

The next concept is the **commutator** $[a, a^\dagger] = 1$, which you derive from $[x, p] = i\hbar$. It is the one rule you need to move $a$ past $a^\dagger$ in any product.

Contrast this with the **number operator** $a^\dagger a$: the ladder operators change the state, while the number operator only reads which level the state is on.

## In three sentences

The Hamiltonian is a sum of squares, so you factor it into the lowering operator $a$ and the raising operator $a^\dagger$. Because $x$ and $p$ do not commute, the factoring leaves a constant $\frac{1}{2}\hbar\omega$ behind. Each ladder operator moves an energy eigenstate one step of $\hbar\omega$ down or up.
