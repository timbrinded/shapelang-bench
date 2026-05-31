import { bunBin, tasksDir } from "./config.ts";
import {
  exists,
  joinPath,
  listFiles,
  readJson,
  readText,
  relativePath,
  removePath,
  runProcess,
  tempDir,
  writeText,
} from "./bun-utils.ts";

// Rig self-test. Positive controls: every golden reference must score perfectly
// clean (proves the rig accepts known-good code, so any failure in the real
// experiment is a genuine code defect, not rig noise). Negative control: a
// deliberately broken mutant must be caught AND classified as a functional
// failure, never as a rig failure (proves the oracle has detection power and the
// rig/functional split is correct).

const PRIMARY = ["coupon-redemptions", "stipend-awards", "grant-budgets", "rebate-claims", "commerce-ledger"];

async function evaluate(candidateDir: string, taskId: string, level: string): Promise<any> {
  const out = joinPath(await tempDir("rigtest-"), `${taskId}-${level}.json`);
  const result = await runProcess(
    bunBin,
    [
      joinPath(import.meta.dir, "evaluate.ts"),
      "--task",
      taskId,
      "--candidate",
      candidateDir,
      "--level",
      level,
      "--out",
      out,
    ],
    { cwd: candidateDir, env: { ...Bun.env, PATH: Bun.env.PATH ?? "" }, timeoutMs: 180_000 },
  );
  if (await exists(out)) return readJson<any>(out);
  return { failureClass: "rig_harness_exception", _stderr: result.stderr.slice(-400) };
}

let failures = 0;
const rows: any[] = [];

// --- Positive controls -----------------------------------------------------
for (const taskId of PRIMARY) {
  const ref = joinPath(tasksDir, taskId, "reference");
  if (!(await exists(ref))) {
    rows.push({ check: `reference:${taskId}`, status: "MISSING", detail: "no reference dir" });
    failures += 1;
    continue;
  }
  // The reference is a positive control for the BLIND ORACLE only: a known-correct
  // spec implementation must score 1.0. Architecture/Shape are not the reference's
  // job (gen 0 is unconstrained), so we evaluate at L0 and assert functional
  // conformance, not structure or shp.
  const r = await evaluate(ref, taskId, "L0");
  const ok = r.functionalPassRate === 1 && r.failureClass === "none";
  if (!ok) failures += 1;
  rows.push({
    check: `golden:${taskId}`,
    status: ok ? "PASS" : "FAIL",
    fpr: r.functionalPassRate,
    class: r.failureClass,
    detail: ok ? "" : (r.behavior?.failures?.[0]?.name ?? r._stderr ?? "").slice(0, 80),
  });
}

// --- Negative control: mutate the coupon reference to drop the per-user-limit
// enforcement. The "per user limit returns 409" assertion must then fail, and
// the run must be classified functional_fail (not a rig class).
async function buildLimitMutant(): Promise<string | null> {
  const ref = joinPath(tasksDir, "coupon-redemptions", "reference");
  if (!(await exists(ref))) return null;
  const dir = await tempDir("rigmutant-");
  for (const file of await listFiles(ref)) {
    const rel = relativePath(ref, file);
    if (rel.split("/").includes("node_modules")) continue;
    await writeText(joinPath(dir, rel), await readText(file));
  }
  const orderServicePath = joinPath(dir, "src", "services", "orderService.js");
  const source = await readText(orderServicePath);
  // Neutralise the limit check by forcing the guard to never trigger.
  const mutated = source.replace(
    "if (activeForUser >= campaign.perUserLimit) {",
    "if (false && activeForUser >= campaign.perUserLimit) {",
  );
  if (mutated === source) return null; // mutation point not found
  await writeText(orderServicePath, mutated);
  return dir;
}

const mutantDir = await buildLimitMutant();
if (!mutantDir) {
  rows.push({ check: "mutant:no-user-limit", status: "SKIP", detail: "could not build mutant (reference missing?)" });
} else {
  const r = await evaluate(mutantDir, "coupon-redemptions", "L3");
  const caughtFunctional = r.failureClass === "functional_fail" && r.rigFailure === false;
  const limitAssertionFailed = (r.behavior?.failures ?? []).some(
    (f: any) => /per user limit/i.test(f.name),
  );
  const ok = caughtFunctional && limitAssertionFailed && r.functionalPassRate !== null && r.functionalPassRate < 1;
  if (!ok) failures += 1;
  rows.push({
    check: "mutant:no-user-limit",
    status: ok ? "PASS" : "FAIL",
    fpr: r.functionalPassRate,
    class: r.failureClass,
    detail: ok
      ? "defect caught and classed functional"
      : `expected functional_fail w/ limit assertion; got ${r.failureClass}`,
  });
  await removePath(mutantDir);
}

console.table(rows);

if (failures > 0) {
  console.log(`\nRIG SELF-TEST FAILED: ${failures} control(s) failed. The rig is not trustworthy until these pass.`);
  process.exit(1);
}
console.log(`\nRIG SELF-TEST PASSED: positive + negative controls all hold. Failures are attributable to code, not the rig.`);
