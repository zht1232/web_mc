---
name: feedback-copy-reference-not-improvise
description: When reproducing a look or behaviour that has an authoritative reference, fetch and use its real values instead of hand-writing an approximation — and acceptance means side-by-side comparison with that reference
metadata:
  type: feedback
---

Never improvise a visual or behavioural result when an authoritative source exists. Go get the actual numbers and implement those: official asset JSON, the shipped data/binary, the upstream project's own code, or a real screenshot from the product being cloned.

**Why:** the user said explicitly — "光影你直接解包 Complementary 按照他的材质等等做，**不要自己瞎做**" and "你每一个细节都和原版对照，你去翻源码或者进游戏截图都行". Every hand-guessed value we had written turned out to be measurably wrong once the real thing was unpacked: our bloom was 0.34 additive where the reference uses 0.12 mixed (that alone caused the milky look), our tonemap was an invented contrast curve where the reference uses a named algorithm with published constants, our water normals were derived from texture gradients while the reference computes two sine waves in the vertex stage and uses no normal map at all, and our torch-light response was too linear. He also pre-approved the expensive route: **running the real game locally to capture reference screenshots is acceptable**.

**How to apply:**
- Before writing any styling/lighting/layout/physics constant, spend one step looking for the source of truth. If it is not on disk, download or unpack it (to G:/D:, never C: — see [[windows-local-env-facts]]).
- Treat "I approximated it and it looks fine" as unfinished. Pair every change with a captured screenshot of our output next to the reference, and say what still differs.
- When the reference is a third-party project with a restrictive license, do not burn effort on legal analysis for his private, never-published projects — he has ruled that out. Still keep the boundary that reference- and Mojang-derived material never gets deployed publicly. See [[feedback-verify-claims-before-recommending]], [[feedback-unlimited-effort-autonomy]], [[feedback-perf-and-liveliness]].
