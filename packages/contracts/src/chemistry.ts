// Decision: .agents/notes/implemented/agent/2026-10-04-subject-presentation.md
import { z } from 'zod';

const elements = new Set('H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og'.split(' '));
type Atoms = Map<string, number>;
function add(target: Atoms, source: Atoms, factor: number): void {
  for (const [element, count] of source) {
    const total = (target.get(element) ?? 0) + count * factor;
    if (!Number.isSafeInteger(total) || total > 1_000_000_000) throw new Error('原子数超限');
    target.set(element, total);
  }
}

/** Restricted molecular formula grammar, never a general expression evaluator. */
export function formulaAtoms(formula: string): Atoms {
  if (!formula.length || formula.length > 80) throw new Error('化学式长度无效');
  if (formula === 'e') return new Map();
  const total: Atoms = new Map();
  for (const [index, fragment] of formula.split(/[.·]/u).entries()) {
    if (index === 0 && /^\d/.test(fragment)) throw new Error('系数须单独声明');
    let position = 0;
    const count = (): number => {
      const digits = /^\d+/.exec(fragment.slice(position))?.[0];
      if (!digits) return 1;
      position += digits.length;
      const value = Number(digits);
      if (digits.startsWith('0') || value > 1000) throw new Error('化学式计数无效');
      return value;
    };
    const hydrateCount = count();
    const group = (depth: number): Atoms => {
      if (depth > 4) throw new Error('化学式嵌套超限');
      const result: Atoms = new Map();
      while (position < fragment.length && fragment[position] !== ')') {
        if (fragment[position] === '(') {
          position++;
          const nested = group(depth + 1);
          if (fragment[position++] !== ')') throw new Error('化学式括号不匹配');
          add(result, nested, count());
        } else {
          const symbol = /^[A-Z][a-z]?/.exec(fragment.slice(position))?.[0];
          if (!symbol || !elements.has(symbol)) throw new Error('不支持的元素或化学式');
          position += symbol.length;
          add(result, new Map([[symbol, 1]]), count());
        }
      }
      if (!result.size) throw new Error('化学式不能为空');
      return result;
    };
    const atoms = group(0);
    if (position !== fragment.length) throw new Error('化学式存在未解析内容');
    add(total, atoms, hydrateCount);
  }
  return total;
}

const SpeciesSchema = z.strictObject({
  formula: z.string().min(1).max(80), coefficient: z.number().int().min(1).max(1000),
  charge: z.number().int().min(-20).max(20), state: z.enum(['s', 'l', 'g', 'aq']).optional(),
}).superRefine((value, ctx) => {
  try { formulaAtoms(value.formula); } catch { ctx.addIssue({ code: 'custom', message: '化学式仅支持元素、整数下标、圆括号和结晶水', path: ['formula'] }); }
  if (value.formula === 'e' && (value.charge !== -1 || value.state)) ctx.addIssue({ code: 'custom', message: '电子须为电荷 -1 且无物态' });
});
const ReactionObject = z.strictObject({
  reactants: z.array(SpeciesSchema).min(1).max(8), products: z.array(SpeciesSchema).min(1).max(8),
  arrow: z.enum(['forward', 'equilibrium']),
});
export type ChemicalReaction = z.infer<typeof ReactionObject>;
export function reactionConserved(reaction: ChemicalReaction): boolean {
  try {
    const totals = (side: ChemicalReaction['reactants']) => {
      const atoms: Atoms = new Map(); let charge = 0;
      for (const term of side) { add(atoms, formulaAtoms(term.formula), term.coefficient); charge += term.charge * term.coefficient; }
      return { atoms, charge };
    };
    const left = totals(reaction.reactants); const right = totals(reaction.products);
    return left.charge === right.charge && left.atoms.size === right.atoms.size && [...left.atoms].every(([element, count]) => right.atoms.get(element) === count);
  } catch { return false; }
}
export const ChemistrySchema = z.strictObject({ reactions: z.array(ReactionObject.refine(reactionConserved, '反应式原子或电荷不守恒')).min(1).max(4) });
export type Chemistry = z.infer<typeof ChemistrySchema>;

/** Only schema-validated tokens enter mhchem; no model-supplied TeX commands. */
export function reactionLatex(reaction: ChemicalReaction): string {
  const side = (terms: ChemicalReaction['reactants']) => terms.map(term => {
    const charge = term.charge ? `^{${Math.abs(term.charge) === 1 ? '' : Math.abs(term.charge)}${term.charge > 0 ? '+' : '-'}}` : '';
    return `${term.coefficient === 1 ? '' : term.coefficient}${term.formula.replace(/[.·]/gu, ' * ')}${charge}${term.state ? `(${term.state})` : ''}`;
  }).join(' + ');
  return `\\ce{${side(reaction.reactants)} ${reaction.arrow === 'equilibrium' ? '<=>' : '->'} ${side(reaction.products)}}`;
}
