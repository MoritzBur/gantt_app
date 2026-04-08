# Morphing schedule exploration

## Search space
- Early, centered, and late actuation windows
- Small / medium / aggressive deflection amplitudes
- Smooth versus piecewise-linear schedule families

## Downselection rubric
- Penalize schedules that win on loads but create unrealistic actuator effort
- Keep at least one conservative schedule as a fallback for the final write-up
- Compare against the static best-known flap angle, not just the nominal baseline

## Candidate shortlist
- [ ] Schedule A: early soft unload
- [ ] Schedule B: centered high-authority pulse
- [ ] Schedule C: asymmetric two-step schedule

## Narrative angle
Even a modest load reduction is interesting if the schedule remains simple enough for certifiable control logic.

#optimization #controls
