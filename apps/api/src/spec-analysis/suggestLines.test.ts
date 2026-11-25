import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  process: { findMany: vi.fn() },
  machine: { findMany: vi.fn() },
}));
vi.mock('../lib/prisma.js', () => ({ prisma: db }));

import { suggestProcessLines } from './suggestLines.js';

type P = { id: bigint; name: string; costingMethod: string };
type M = { id: bigint; name: string; type: string };

const FORGING: P = { id: 1n, name: 'Hot Forging', costingMethod: 'PER_KG' };
const TURNING: P = { id: 2n, name: 'CNC Turning', costingMethod: 'CYCLE_TIME' };
const DRILLING: P = { id: 3n, name: 'Drilling', costingMethod: 'CYCLE_TIME' };
const GRINDING: P = { id: 4n, name: 'Cylindrical Grinding', costingMethod: 'CYCLE_TIME' };
const DEBURR: P = { id: 5n, name: 'Deburring', costingMethod: 'FLAT_PC' };
const ALL_PROCS = [FORGING, TURNING, DRILLING, GRINDING, DEBURR];

const LATHE: M = { id: 10n, name: 'Lathe 1', type: 'CNC' };
const VMC: M = { id: 11n, name: 'Mill 1', type: 'VMC' };
const GRINDER: M = { id: 12n, name: 'Grinder 1', type: 'Grinder' };
const ALL_MACHINES = [LATHE, VMC, GRINDER];

function masters(procs: P[] = ALL_PROCS, machines: M[] = ALL_MACHINES) {
  db.process.findMany.mockResolvedValue(procs);
  db.machine.findMany.mockResolvedValue(machines);
}

const item = (itemType: string, tolClass?: string) => ({ itemType, tolClass: tolClass ?? null });
const extract = (...items: ReturnType<typeof item>[]) => ({ items }) as never;
const repeat = (n: number, make: () => ReturnType<typeof item>) => Array.from({ length: n }, make);

const names = (lines: { processId: string }[], procs: P[] = ALL_PROCS) =>
  lines.map((l) => procs.find((p) => p.id.toString() === l.processId)!.name);

beforeEach(() => {
  vi.clearAllMocks();
  masters();
});

describe('suggestProcessLines — the baseline', () => {
  it('a plain part gets forging, turning and a manual finish, in that order', async () => {
    const { processes, flags } = await suggestProcessLines(extract(), 1.2);
    expect(names(processes)).toEqual(['Hot Forging', 'CNC Turning', 'Deburring']);
    expect(processes.map((p) => p.sequence)).toEqual([1, 2, 3]);
    expect(flags).toEqual([]);
  });

  it('forging is costed per kg of input weight whatever the master says', async () => {
    masters([{ ...FORGING, costingMethod: 'FLAT_PC' }, TURNING, DEBURR]);
    const { processes } = await suggestProcessLines(extract(), 1.2);
    expect(processes[0].method).toBe('PER_KG');
  });

  it('turning has a 180 s base cycle time on a CNC machine', async () => {
    const { processes } = await suggestProcessLines(extract(), 1);
    const turning = processes.find((p) => p.processId === '2')!;
    expect(turning).toMatchObject({ method: 'CYCLE_TIME', quantityOrTime: 180, machineId: '10' });
  });

  it('the manual finish is one flat per-piece charge', async () => {
    const { processes } = await suggestProcessLines(extract(), 1);
    expect(processes.find((p) => p.processId === '5')).toMatchObject({ method: 'FLAT_PC', quantityOrTime: 1, machineId: null });
  });

  it('never prices a line itself: rates stay 0 so the engine uses the machine / process default', async () => {
    const { processes } = await suggestProcessLines(extract(item('HOLE'), item('GDT')), 1);
    expect(processes.every((p) => p.rate === 0)).toBe(true);
  });

  it('returns ids as strings', async () => {
    const { processes } = await suggestProcessLines(extract(), 1);
    for (const p of processes) expect(typeof p.processId).toBe('string');
  });
});

describe('suggestProcessLines — turning time grows with the features', () => {
  const turn = async (...items: ReturnType<typeof item>[]) =>
    (await suggestProcessLines(extract(...items), 1)).processes.find((p) => p.processId === '2')!.quantityOrTime;

  it('+60 s per thread', async () => {
    expect(await turn(item('THREAD'))).toBe(240);
    expect(await turn(item('THREAD'), item('THREAD'))).toBe(300);
  });

  it('+20 s per chamfer, undercut or groove', async () => {
    expect(await turn(item('CHAMFER'))).toBe(200);
    expect(await turn(item('UNDERCUT'))).toBe(200);
    expect(await turn(item('GROOVE'))).toBe(200);
    expect(await turn(item('CHAMFER'), item('UNDERCUT'), item('GROOVE'))).toBe(240);
  });

  it('combines: 2 threads + 3 chamfers = 180 + 120 + 60', async () => {
    expect(await turn(...repeat(2, () => item('THREAD')), ...repeat(3, () => item('CHAMFER')))).toBe(360);
  });

  it('other callouts do not add turning time', async () => {
    expect(await turn(item('NOTE'), item('SURFACE_FINISH'), item('TOLERANCE'))).toBe(180);
  });
});

describe('suggestProcessLines — holes → drilling', () => {
  it('adds a drilling line at 45 s per hole, on a drilling / milling machine', async () => {
    const { processes } = await suggestProcessLines(extract(...repeat(2, () => item('HOLE'))), 1);
    expect(processes.find((p) => p.processId === '3')).toMatchObject({ method: 'CYCLE_TIME', quantityOrTime: 90, machineId: '11' });
  });

  it('adds none when there are no holes', async () => {
    const { processes } = await suggestProcessLines(extract(item('THREAD')), 1);
    expect(names(processes)).not.toContain('Drilling');
  });

  it('flags holes that have no drilling process to go on', async () => {
    masters([FORGING, TURNING, DEBURR]);
    const { flags } = await suggestProcessLines(extract(...repeat(3, () => item('HOLE'))), 1);
    expect(flags).toContain('3 hole(s) on the drawing but no drilling process configured.');
  });
});

describe('suggestProcessLines — tight fits and GD&T → grinding', () => {
  const grind = async (...items: ReturnType<typeof item>[]) =>
    (await suggestProcessLines(extract(...items), 1)).processes.find((p) => p.processId === '4');

  it.each(['m6', 'h7', 'H7', 'js6', 'N9'])('a %s diameter fit triggers grinding at 90 s', async (cls) => {
    expect(await grind(item('DIAMETER', cls))).toMatchObject({ quantityOrTime: 90, method: 'CYCLE_TIME', machineId: '12' });
  });

  it.each(['', 'general', 'class', 'm'])('"%s" is not a tight fit', async (cls) => {
    expect(await grind(item('DIAMETER', cls))).toBeUndefined();
  });

  it('only a DIAMETER fit counts (a tolerance class on a thread does not)', async () => {
    expect(await grind(item('THREAD', 'm6'))).toBeUndefined();
  });

  it('GD&T alone triggers grinding, +30 s each on top of 90', async () => {
    expect((await grind(item('GDT')))!.quantityOrTime).toBe(120);
    expect((await grind(item('GDT'), item('GDT'), item('GDT')))!.quantityOrTime).toBe(180);
  });

  it('a fit plus GD&T = 90 + 30 per GD&T callout', async () => {
    expect((await grind(item('DIAMETER', 'm6'), item('GDT'), item('GDT')))!.quantityOrTime).toBe(150);
  });

  it('flags the missing process instead of silently dropping the cost', async () => {
    masters([FORGING, TURNING, DEBURR]);
    const { flags } = await suggestProcessLines(extract(item('GDT')), 1);
    expect(flags).toContain('Tight fit / GD&T present but no grinding process configured — QC uplift only.');
  });
});

describe('suggestProcessLines — a fully featured part, in order', () => {
  it('lists forging, turning, drilling, grinding, deburring with consecutive sequences', async () => {
    const { processes } = await suggestProcessLines(
      extract(item('THREAD'), item('HOLE'), item('DIAMETER', 'm6'), item('GDT')),
      2.5
    );
    expect(names(processes)).toEqual(['Hot Forging', 'CNC Turning', 'Drilling', 'Cylindrical Grinding', 'Deburring']);
    expect(processes.map((p) => p.sequence)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('suggestProcessLines — incomplete masters', () => {
  it('reports every gap it can see and still returns what it could build', async () => {
    masters([DEBURR]);
    const { processes, flags } = await suggestProcessLines(extract(), 1.2);
    expect(names(processes, [DEBURR])).toEqual(['Deburring']);
    expect(flags).toContain('No forging process configured — add one under Process & Machine.');
    expect(flags).toContain('No turning / CNC process configured — machining cost will be understated.');
  });

  it('does not complain about forging when there is no input weight to forge', async () => {
    masters([TURNING]);
    const { flags } = await suggestProcessLines(extract(), 0);
    expect(flags.some((f) => /forging/i.test(f))).toBe(false);
  });

  it('with no processes at all, says to add lines manually', async () => {
    masters([], []);
    const { processes, flags } = await suggestProcessLines(extract(), 1);
    expect(processes).toEqual([]);
    expect(flags).toContain('No matching processes in the master — add process lines manually.');
  });

  it('falls back to any "machining" process when there is no turning one', async () => {
    const MACHINING: P = { id: 9n, name: 'General Machining', costingMethod: 'CYCLE_TIME' };
    masters([FORGING, MACHINING]);
    const { processes } = await suggestProcessLines(extract(), 1);
    expect(processes.map((p) => p.processId)).toEqual(['1', '9']);
  });

  it('leaves the machine blank when no machine of the right kind exists', async () => {
    masters(ALL_PROCS, []);
    const { processes } = await suggestProcessLines(extract(item('HOLE')), 1);
    expect(processes.every((p) => p.machineId === null)).toBe(true);
  });

  it('matches processes case-insensitively on their names', async () => {
    masters([{ id: 1n, name: 'FORGING PRESS', costingMethod: 'PER_KG' }, { id: 2n, name: 'lathe work', costingMethod: 'CYCLE_TIME' }]);
    const { processes } = await suggestProcessLines(extract(), 1);
    expect(processes.map((p) => p.processId)).toEqual(['1', '2']);
  });

  it('only considers active masters (asks the database for isActive rows)', async () => {
    await suggestProcessLines(extract(), 1);
    expect(db.process.findMany).toHaveBeenCalledWith({ where: { isActive: true } });
    expect(db.machine.findMany).toHaveBeenCalledWith({ where: { isActive: true } });
  });

  it('copes with an extraction that has no items array', async () => {
    const { processes } = await suggestProcessLines({} as never, 1);
    expect(names(processes)).toEqual(['Hot Forging', 'CNC Turning', 'Deburring']);
  });
});
