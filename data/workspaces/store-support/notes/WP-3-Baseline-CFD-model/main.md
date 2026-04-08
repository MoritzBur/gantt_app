# Baseline CFD model

## Objective
Build a trustworthy baseline before touching any adaptive schedule logic.

## Numerical setup
- 2D section with deployed single-slotted flap
- Structured mesh around the cove and flap shoulder
- Steady RANS first, then prescribed-motion unsteady cases

## Validation ladder
1. Mesh independence on lift, drag, and hinge moment
2. Pressure coefficient comparison at three flap settings
3. Gust-response sanity check before surrogate generation

## Risks
- Flap cove separation may be too mesh-sensitive
- Short gust pulses can produce noisy hinge moment traces
- Time step selection could dominate the claimed improvement

## Linked work
- [[3.2 Correlate steady RANS against reference data]]
- [[WP 4 Wind-tunnel preparation & test]]
