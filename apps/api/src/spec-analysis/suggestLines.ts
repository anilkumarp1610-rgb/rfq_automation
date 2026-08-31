import { SpecExtractResult, CostingMethod } from '@rfq/shared';
import { prisma } from '../lib/prisma.js';

export interface SuggestedProcessLine {
  processId: string;
  machineId: string | null;
  method: CostingMethod;
  quantityOrTime: number;
  rate: number;
  sequence: number;
}

export interface LineSuggestion {
  processes: SuggestedProcessLine[];
  flags: string[];
}

/**
 * Map spec callouts to a first-cut set of process lines the estimator then edits
 * (development.plan §6): threads/chamfers/undercuts → turning time, holes → drilling,
 * m6 fits & GD&T → grinding, plus a forging op and a manual finish. Rates are left
 * at 0 so the cost engine falls back to the machine-hour rate / process default.
 */
export async function suggestProcessLines(
  extract: Pick<SpecExtractResult, 'items'>,
  inputWeightKg: number
): Promise<LineSuggestion> {
  const [procs, machines] = await Promise.all([
    prisma.process.findMany({ where: { isActive: true } }),
    prisma.machine.findMany({ where: { isActive: true } }),
  ]);
  const flags: string[] = [];
  const findProc = (re: RegExp) => procs.find((p) => re.test(p.name));
  const findMachine = (re: RegExp) => machines.find((m) => re.test(m.type) || re.test(m.name));

  const lines: SuggestedProcessLine[] = [];
  let seq = 1;
  const add = (
    proc: { id: bigint; costingMethod: string } | undefined,
    opts: { method?: CostingMethod; qt?: number; machine?: RegExp }
  ) => {
    if (!proc) return false;
    const machine = opts.machine ? findMachine(opts.machine) : undefined;
    lines.push({
      processId: proc.id.toString(),
      machineId: machine ? machine.id.toString() : null,
      method: (opts.method ?? proc.costingMethod) as CostingMethod,
      quantityOrTime: opts.qt ?? 0,
      rate: 0,
      sequence: seq++,
    });
    return true;
  };

  const items = extract.items ?? [];
  const byType = (t: string) => items.filter((i) => i.itemType === t);
  const threads = byType('THREAD');
  const holes = byType('HOLE');
  const features = items.filter((i) => ['CHAMFER', 'UNDERCUT', 'GROOVE'].includes(i.itemType));
  const gdt = byType('GDT');
  const tightFit = byType('DIAMETER').some((i) => /^[a-z]{1,2}\d/i.test(i.tolClass ?? ''));

  // Forging (per kg of input weight)
  if (!add(findProc(/forg/i), { method: 'PER_KG' }) && inputWeightKg > 0) {
    flags.push('No forging process configured — add one under Process & Machine.');
  }

  // Turning baseline — chamfers, undercuts, grooves and threads fold into the cycle time
  const turnQt = 180 + threads.length * 60 + features.length * 20;
  if (!add(findProc(/turn|cnc|lath/i) ?? findProc(/machin/i), {
    method: 'CYCLE_TIME',
    qt: turnQt,
    machine: /cnc|turn|lath/i,
  })) {
    flags.push('No turning / CNC process configured — machining cost will be understated.');
  }

  // Drilling — one pass per hole
  if (holes.length) {
    if (!add(findProc(/drill|hole/i), { method: 'CYCLE_TIME', qt: 45 * holes.length, machine: /drill|vmc|mill/i })) {
      flags.push(`${holes.length} hole(s) on the drawing but no drilling process configured.`);
    }
  }

  // Grinding — tight fits (m6, h7, …) and GD&T
  if (tightFit || gdt.length) {
    if (!add(findProc(/grind/i), { method: 'CYCLE_TIME', qt: 90 + gdt.length * 30, machine: /grind/i })) {
      flags.push('Tight fit / GD&T present but no grinding process configured — QC uplift only.');
    }
  }

  // Manual finish
  add(findProc(/deburr|fettl|visual|packing/i), { method: 'FLAT_PC', qt: 1 });

  if (lines.length === 0) flags.push('No matching processes in the master — add process lines manually.');
  return { processes: lines, flags };
}
