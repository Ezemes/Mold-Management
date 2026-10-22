/**
 * Safe arithmetic for formula fields: numbers, field keys, + - * /, parentheses and
 * min(), max(), round(x, digits). No eval, no property access, no other functions.
 *   e.g.  active_cavities * 3600 / design_cycle_time_s
 */

type Token = { t: "num"; v: number } | { t: "id"; v: string } | { t: "op"; v: string };

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      const n = Number(src.slice(i, j));
      if (Number.isNaN(n)) throw new Error(`Bad number near "${src.slice(i, j)}"`);
      out.push({ t: "num", v: n });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++;
      out.push({ t: "id", v: src.slice(i, j) });
      i = j;
      continue;
    }
    if ("+-*/(),".includes(c)) { out.push({ t: "op", v: c }); i++; continue; }
    throw new Error(`Unexpected character "${c}"`);
  }
  return out;
}

const FUNCS: Record<string, (args: number[]) => number> = {
  min: (a) => Math.min(...a),
  max: (a) => Math.max(...a),
  round: (a) => {
    const f = 10 ** (a[1] ?? 0);
    return Math.round(a[0] * f) / f;
  },
};

/** Parse once; returns referenced identifiers and an evaluator. Throws on syntax errors. */
export function compileFormula(src: string) {
  const toks = tokenize(src);
  let p = 0;
  const refs = new Set<string>();
  type Node = (vars: Record<string, number | null>) => number | null;

  const peek = () => toks[p];
  const eat = (v?: string) => {
    const tk = toks[p];
    if (!tk || (v && !(tk.t === "op" && tk.v === v))) throw new Error(`Expected "${v ?? "value"}"`);
    p++;
    return tk;
  };
  const bin = (l: Node, r: Node, f: (a: number, b: number) => number | null): Node => (vars) => {
    const a = l(vars);
    const b = r(vars);
    return a == null || b == null ? null : f(a, b);
  };

  function expr(): Node {
    let l = term();
    while (peek()?.t === "op" && "+-".includes(peek()!.v as string)) {
      const op = eat().v;
      const r = term();
      l = bin(l, r, op === "+" ? (a, b) => a + b : (a, b) => a - b);
    }
    return l;
  }
  function term(): Node {
    let l = factor();
    while (peek()?.t === "op" && "*/".includes(peek()!.v as string)) {
      const op = eat().v;
      const r = factor();
      l = bin(l, r, op === "*" ? (a, b) => a * b : (a, b) => (b === 0 ? null : a / b));
    }
    return l;
  }
  function factor(): Node {
    const tk = peek();
    if (!tk) throw new Error("Unexpected end of formula");
    if (tk.t === "op" && tk.v === "-") {
      eat();
      const f = factor();
      return (v) => { const x = f(v); return x == null ? null : -x; };
    }
    if (tk.t === "op" && tk.v === "(") {
      eat("(");
      const e = expr();
      eat(")");
      return e;
    }
    if (tk.t === "num") {
      eat();
      return () => tk.v;
    }
    if (tk.t === "id") {
      eat();
      const name = tk.v;
      if (peek()?.t === "op" && peek()!.v === "(") {
        const fn = FUNCS[name];
        if (!fn) throw new Error(`Unknown function "${name}"`);
        eat("(");
        const args: Node[] = [expr()];
        while (peek()?.t === "op" && peek()!.v === ",") { eat(","); args.push(expr()); }
        eat(")");
        return (v) => {
          const vals = args.map((a) => a(v));
          return vals.some((x) => x == null) ? null : fn(vals as number[]);
        };
      }
      refs.add(name);
      return (v) => (typeof v[name] === "number" && Number.isFinite(v[name]) ? (v[name] as number) : null);
    }
    throw new Error(`Unexpected "${tk.v}"`);
  }

  const root = expr();
  if (p !== toks.length) throw new Error(`Unexpected "${(toks[p] as { v: unknown }).v}"`);
  return { refs: [...refs], evaluate: (vars: Record<string, number | null>) => root(vars) };
}

export function evalFormula(src: string, vars: Record<string, number | null>): number | null {
  try {
    const v = compileFormula(src).evaluate(vars);
    return v == null || !Number.isFinite(v) ? null : v;
  } catch {
    return null;
  }
}
