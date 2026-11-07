import { computeSkyState } from '../src/client/EnvironmentLighting.ts';
for (const t of [0, 6000, 12000, 12600, 13000, 18000, 23400, 23999]) {
  const s = computeSkyState(t);
  console.log(String(t).padStart(6), 'sun', s.sunAngleDeg.toFixed(2), 'moon', s.moonAngleDeg.toFixed(2), 'star', (s.starAngleDeg ?? NaN).toFixed(2));
}
