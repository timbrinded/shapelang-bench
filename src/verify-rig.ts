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
  // Positive control on BOTH evaluation axes: the known-correct, layered+Sequelize
  // reference must score 1.0 on the blind oracle at L0, and at L3 must also pass
  // the static architecture/DB/ORM verifiers. This validates both that the oracle
  // accepts good code and that the structural verifiers accept correct structure.
  for (const level of ["L0", "L3"]) {
    const r = await evaluate(ref, taskId, level);
    const structOk = level === "L0" ? true : r.structure?.passed === true;
    const ok = r.functionalPassRate === 1 && r.failureClass === "none" && structOk;
    if (!ok) failures += 1;
    rows.push({
      check: `golden:${taskId}:${level}`,
      status: ok ? "PASS" : "FAIL",
      fpr: r.functionalPassRate,
      class: r.failureClass,
      struct: r.structure?.passed,
      detail: ok ? "" : (r.behavior?.failures?.[0]?.name ?? r.structure?.architecture?.details?.[0] ?? r._stderr ?? "").slice(0, 80),
    });
  }
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

// --- Structural negative control: add a models-layer file that imports a service
// (an upward-dependency layering violation). The architecture verifier must mark
// structure as failed, while behavior stays intact (the file is never required at
// runtime). Proves the structural verifier has detection power.
async function buildStructuralMutant(): Promise<string | null> {
  const ref = joinPath(tasksDir, "coupon-redemptions", "reference");
  if (!(await exists(ref))) return null;
  const dir = await tempDir("rigstruct-");
  for (const file of await listFiles(ref)) {
    const rel = relativePath(ref, file);
    if (rel.split("/").includes("node_modules")) continue;
    await writeText(joinPath(dir, rel), await readText(file));
  }
  // Unused upward import: models -> services. Trips the architecture verifier
  // statically; never loaded at runtime, so behavior is unaffected.
  await writeText(
    joinPath(dir, "src", "models", "_layering_violation.js"),
    'const _up = require("../services/orderService");\nmodule.exports = { _up };\n',
  );
  return dir;
}

const structMutant = await buildStructuralMutant();
if (!structMutant) {
  rows.push({ check: "mutant:upward-import", status: "SKIP", detail: "could not build mutant" });
} else {
  const r = await evaluate(structMutant, "coupon-redemptions", "L3");
  const structureCaught = r.structure?.passed === false;
  const behaviorIntact = r.functionalPassRate === 1; // layering violation shouldn't break behavior
  const ok = structureCaught && behaviorIntact;
  if (!ok) failures += 1;
  rows.push({
    check: "mutant:upward-import",
    status: ok ? "PASS" : "FAIL",
    fpr: r.functionalPassRate,
    class: r.failureClass,
    struct: r.structure?.passed,
    detail: ok ? "architecture verifier caught upward import" : `expected structure fail + behavior 1.0; got struct=${r.structure?.passed} fpr=${r.functionalPassRate}`,
  });
  await removePath(structMutant);
}

console.table(rows);

if (failures > 0) {
  console.log(`\nRIG SELF-TEST FAILED: ${failures} control(s) failed. The rig is not trustworthy until these pass.`);
  process.exit(1);
}
console.log(`\nRIG SELF-TEST PASSED: positive + negative controls all hold. Failures are attributable to code, not the rig.`);
