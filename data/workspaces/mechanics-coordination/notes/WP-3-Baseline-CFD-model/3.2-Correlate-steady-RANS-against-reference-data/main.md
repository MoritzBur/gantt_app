# RANS correlation log

## Current status
- Mesh family A converges robustly but under-predicts suction peak after the flap shoulder
- Mesh family B improves pressure recovery but is still sensitive to the cove refinement ratio

## Comparison cases
- Baseline approach condition
- High-lift reference at moderate flap deflection
- Near-stall check for qualitative trend only

## Decision
- [x] Keep SST as default turbulence model
- [ ] Decide whether to retain transition correction in the final baseline
- [ ] Freeze the final wall-normal spacing after one more sensitivity run

## Notes for discussion chapter
Absolute agreement is less important than showing the model reproduces ranking across schedule variants.

#cfd #validation
