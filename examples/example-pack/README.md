# Example content pack

A minimal pack in the format Engram Desktop reads (see
[docs/content-packs.md](../../docs/content-packs.md)). Add this folder in
Settings → Content packs and the lab appears in Labs. It runs on the base
runtime layer, so it needs nothing beyond NumPy and pytest.

The lab shows each part of the format: smoke and hidden checks, the ladder
(a worked example, a partial solution and worked steps for M1), three
predict-the-output items on M1, and practice variants of M1 (a line through
the origin, a parabola) and M2 (r² of any prediction), which come back in
**Practice** a day after each milestone passes. It names no tutor topic, so
its receipt offers **Copy for the tutor** rather than **Discuss with the
tutor**; add `"topic"` to `lab.json`, and `"node"` to a milestone, to link
it to one of yours.

The pack also carries a two-topic course (`course.json`), shown in
**Course**: *Least squares*, with a prepared concept map
(`course/least-squares.graph.json`) the tutor registers as it is, and
*Reading residuals*, which requires it and is seeded from an outline. Its one
stage has a checkpoint (the lab's M1 passing, and least squares holding in
review) and two milestones the learner ticks.
