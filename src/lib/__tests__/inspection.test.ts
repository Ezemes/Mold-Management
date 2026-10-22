import { test } from "node:test";
import assert from "node:assert/strict";
import { assessmentOutcome, componentLines, DEFAULT_TEMPLATES, parseComponents, pickTemplate, ratingWord, validateAssessment, type Answers, type ComponentResult } from "../inspection.pure";

const answers: Answers = {
  mode: "bench", dynamic: { cavitiesRunning: 4, cavitiesTotal: 4, lastRunDate: null, totalShots: null, annualVolume: null },
  qualityIssues: false, qualityNote: "", operationalIssues: false, operationalNote: "", spareParts: "Okay", sparePartsNote: "", supplyRisk: false, supplyRiskNote: "",
  overallCondition: "Clean, normal wear.", recommendations: "", video: false,
};
const comp = (over: Partial<ComponentResult> = {}): ComponentResult => ({ key: "vents", label: "Vents", weight: 1, checks: [], score: 4, note: "", checkResults: [], photos: 0, ...over });

test("inspection: templates from the documents", () => {
  const [inj, ibm, ebm] = DEFAULT_TEMPLATES;
  assert.equal(inj.components.length, 25);
  assert.equal(ibm.components.length, 20);
  assert.equal(ebm.components.length, 13);
  assert.equal(ebm.components.find((c) => c.label === "Water Channel")!.checks.length, 8);
  assert.equal(new Set(inj.components.map((c) => c.key)).size, 25); // keys unique
  const all = DEFAULT_TEMPLATES.map((t) => ({ ...t, active: true }));
  assert.equal(pickTemplate(all, "injection blow")!.name, "Injection Blow");
  assert.equal(pickTemplate(all, "Extrusion Blow")!.name, "Extrusion Blow");
  assert.equal(pickTemplate(all, "Compression")!.name, "Injection"); // default
  assert.equal(ratingWord(5), "Excellent");
  assert.equal(ratingWord(1), "Unacceptable");
  assert.equal(ratingWord(null), "N/A");
});

test("inspection: editor round trip", () => {
  const ebm = DEFAULT_TEMPLATES[2].components;
  const { components, errors } = parseComponents(componentLines(ebm));
  assert.deepEqual(errors, []);
  assert.deepEqual(components, ebm);
  const bad = parseComponents("- orphan check\nVents | zero");
  assert.equal(bad.errors.length, 3);
});

test("inspection: a NO needs a comment and a photo; Poor and Unacceptable need a comment", () => {
  assert.deepEqual(validateAssessment([comp()], answers), []);
  const no = comp({ checkResults: [{ text: "Clean vents", ok: false }] });
  assert.deepEqual(validateAssessment([no], answers), ["Vents: a comment is required when a check is NO.", "Vents: add a photo for the NO answer."]);
  assert.deepEqual(validateAssessment([{ ...no, note: "Blocked", photos: 1 }], answers), []);
  assert.deepEqual(validateAssessment([comp({ checkResults: [{ text: "x", ok: null }] })], answers), ["Vents: answer every check YES or NO."]);
  assert.deepEqual(validateAssessment([comp({ score: 1 })], answers), ["Vents: explain the Unacceptable rating and how to correct it."]);
  assert.deepEqual(validateAssessment([comp({ score: null })], answers), []); // N/A is fine
});

test("inspection: questions follow the templates", () => {
  const e = validateAssessment([comp()], { ...answers, qualityIssues: true, spareParts: "Need", supplyRisk: null, overallCondition: "" });
  assert.deepEqual(e, ["Describe the quality issues.", "List the spare parts needed.", "Answer whether the tool is a supply risk.", "Describe the overall condition of the tool."]);
});

test("inspection: Unacceptable stops the tool; Poor or issues need a work order", () => {
  const o1 = assessmentOutcome([comp({ score: 1, label: "Cavities" }), comp({ score: 4 })], answers, 3.5, 3);
  assert.equal(o1.stopTool, true);
  assert.equal(o1.workOrderRequired, true);
  assert.deepEqual(o1.reasons, ["Unacceptable: Cavities"]);
  const o2 = assessmentOutcome([comp({ score: 2 })], answers, 3.2, 3);
  assert.deepEqual([o2.stopTool, o2.workOrderRequired], [false, true]);
  const o3 = assessmentOutcome([comp({ score: 4 })], { ...answers, operationalIssues: true }, 4, 3);
  assert.deepEqual(o3.reasons, ["Operational issues reported"]);
  assert.equal(assessmentOutcome([comp({ score: 4 })], answers, 4, 3).workOrderRequired, false);
});
