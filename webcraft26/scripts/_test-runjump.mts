// Regression: running and jumping over FLAT ground must never lose horizontal speed. The old
// Player.move() re-offset the horizontal collision box by the requested delta (`afterY.move(...)`),
// so on every jump/fall tick the box sank into the block under the feet, clipX/clipZ shortened the
// move and the component velocity was zeroed - "horizontal speed suddenly resets while run-jumping".
//
// The fake level is a single flat layer of full blocks at y=0 with nothing above, so any horizontal
// clip in the air is a solver bug, not a wall.
import { Player } from '../src/vanilla/world/entity/player/Player.ts';
import { AABB } from '../src/vanilla/core/Geometry.ts';

const AIR = 0;
const STONE = 1;

const level = {
  mc: {
    collision: (state: number) => (state === STONE ? [new AABB(0, 0, 0, 1, 1, 1)] : []),
    hasFluid: () => false,
    blockOf: () => ({ name: 'stone' }),
    getProp: () => undefined,
  },
  getBlockState: (_x: number, y: number, _z: number) => (y === 0 ? STONE : AIR),
} as never;

function run(label: string, sprint: boolean, diagonal: boolean): void {
  const p = new Player(0.5, 1.0, 0.5);
  p.yaw = 30;
  const speeds: number[] = [];
  let airTicks = 0;
  for (let t = 0; t < 200; t++) {
    // jump every 24 ticks, held for one tick like a key tap
    const jump = t % 24 === 0;
    p.tick(level, {
      forward: 1,
      strafe: diagonal ? 1 : 0,
      jump,
      sneak: false,
      sprint,
      jumpPressed: jump,
    });
    const h = Math.hypot(p.vel.x, p.vel.z);
    if (!p.onGround) airTicks++;
    speeds.push(h);
  }
  // Ignore the first 20 ticks: that is the ground acceleration ramp from a standstill.
  const steady = speeds.slice(20);
  const min = Math.min(...steady);
  const max = Math.max(...steady);
  const target = sprint ? 0.2806 : 0.2159;
  // Air control is weak (AIR_FRICTION), so during a jump the speed may dip a little; anything near
  // zero is a reset. Allow 25% of the target as the floor.
  const floor = target * 0.25;
  const ok = min >= floor;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}: min ${min.toFixed(3)} max ${max.toFixed(3)} `
    + `(target ${target}, floor ${floor.toFixed(3)}, air ticks ${airTicks}/200)`,
  );
  if (!ok) {
    const bad = speeds.map((h, i) => ({ i, h })).filter((s) => s.h < floor).slice(0, 10);
    console.log('  violating ticks:', JSON.stringify(bad));
  }
}

run('walk straight', false, false);
run('sprint straight', true, false);
run('walk diagonal', false, true);
run('sprint diagonal', true, true);

// A real wall must still stop the player (the fix must not make collisions free).
{
  const p = new Player(0.5, 1.0, 0.5);
  p.yaw = 0;
  const wallLevel = {
    mc: {
      collision: (state: number) => (state === STONE ? [new AABB(0, 0, 0, 1, 1, 1)] : []),
      hasFluid: () => false,
      blockOf: () => ({ name: 'stone' }),
      getProp: () => undefined,
    },
    // flat floor plus a 2-high wall at z = 3
    getBlockState: (_x: number, y: number, z: number) => (y === 0 || (z === 3 && y <= 2) ? STONE : AIR),
  } as never;
  for (let t = 0; t < 120; t++) {
    p.tick(wallLevel, { forward: 1, strafe: 0, jump: false, sneak: false, sprint: true, jumpPressed: false });
  }
  const stopped = p.pos.z < 3 && Math.abs(p.pos.z - 2.7) < 0.05;
  console.log(`${stopped ? 'PASS' : 'FAIL'}  wall still blocks: z=${p.pos.z.toFixed(3)} (expected 2.7)`);
}
