// Tiny zero-dependency test runner.
const suites = [];
export function suite(name, fn) { suites.push([name, fn]); }
export function eq(a, b, msg) {
  const okCmp = (typeof a === 'object' && typeof b === 'object')
    ? JSON.stringify(a) === JSON.stringify(b) : a === b;
  if (!okCmp) throw new Error(`${msg || 'eq'}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
}
export function ok(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
export function throws(fn, re, msg) {
  try { fn(); } catch (e) { if (re.test(e.message)) return; throw new Error(`${msg}: wrong error: ${e.message}`); }
  throw new Error(`${msg}: did not throw`);
}

export async function main() {
  let pass = 0, fail = 0;
  for (const [name, fn] of suites) {
    try {
      await fn();
      pass++;
      console.log(`ok   ${name}`);
    } catch (err) {
      fail++;
      console.log(`FAIL ${name}\n     ${err.message}`);
      if (process.env.VERBOSE) console.log(err.stack);
    }
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
