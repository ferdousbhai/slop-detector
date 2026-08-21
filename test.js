const test = require("node:test");
const assert = require("node:assert");
const { analyze } = require("./extension/engine.js");

test("heavy slop scores high", () => {
  const text = `I hope this message finds you well! I'd be happy to delve into this topic.
It's not just a tool, it's a game-changer that will seamlessly elevate your workflow.
Moreover, it's worth noting that this unlocks your full potential.
Let me know if you have any questions!`;
  const r = analyze(text);
  assert.ok(r.score >= 50, `expected >=50, got ${r.score}`);
  assert.strictEqual(r.verdict, "slop");
  assert.ok(r.findings.some((f) => f.ruleId === "chatbot-phrase"));
  assert.ok(r.findings.some((f) => f.ruleId === "binary-contrast"));
});

test("casual human text scores low", () => {
  const r = analyze("hey are we still on for tonight? i can grab food on the way, running a bit late tho lol");
  assert.ok(r.score < 20, `expected <20, got ${r.score}`);
  assert.strictEqual(r.verdict, "human");
});

test("em-dash density triggers only when dense", () => {
  const dense = "The plan — such as it is — needs work — real work — before Friday — honestly — it does.";
  const sparse = "The plan needs work before Friday. I think we should meet tomorrow and talk it through in person over coffee.";
  assert.ok(analyze(dense).findings.some((f) => f.ruleId === "em-dash-density"));
  assert.ok(!analyze(sparse).findings.some((f) => f.ruleId === "em-dash-density"));
});

test("emoji bullets need at least two lines", () => {
  const two = "🚀 Launch the site\n✅ Test everything";
  const one = "🚀 Launch the site tomorrow morning";
  assert.ok(analyze(two).findings.some((f) => f.ruleId === "emoji-bullets"));
  assert.ok(!analyze(one).findings.some((f) => f.ruleId === "emoji-bullets"));
});

test("uniform sentence length flagged", () => {
  const uniform =
    "The team completed the quarterly report on schedule today. " +
    "The results exceeded our initial projections by several points. " +
    "The board reviewed the findings during the afternoon session. " +
    "The next milestone arrives at the end of this month.";
  assert.ok(analyze(uniform).findings.some((f) => f.ruleId === "uniform-sentences"));
});

test("findings carry valid spans", () => {
  const text = "Great question! Let me delve into that.";
  for (const f of analyze(text).findings) {
    assert.ok(f.start >= 0 && f.end >= f.start && f.end <= text.length);
  }
});

test("empty-ish input does not crash", () => {
  assert.strictEqual(analyze("").verdict, "human");
  assert.strictEqual(analyze("ok").verdict, "human");
});

// --- tests for merged unslop / no-ai-slop patterns ---

test("puffery and vague attribution flagged", () => {
  const r = analyze("This launch marks a pivotal moment and stands as a testament to our vision. Experts believe it plays a vital role in the evolving landscape.");
  const ids = new Set(r.findings.map((f) => f.ruleId));
  assert.ok(ids.has("puffery"));
  assert.ok(ids.has("vague-attribution"));
  assert.strictEqual(r.verdict, "slop");
});

test("binary contrast variants flagged", () => {
  const a = analyze("The question isn't the model, it's the eval.");
  assert.ok(a.findings.some((f) => f.ruleId === "binary-contrast"), "isn't-X-it's-Y");
  const b = analyze("Not a tool. Not a framework. A movement.");
  assert.ok(b.findings.some((f) => f.ruleId === "binary-contrast"), "negative listing");
});

test("trailing -ing analysis clause flagged", () => {
  const r = analyze("The update adds file search, highlighting the team's commitment to better workflows.");
  assert.ok(r.findings.some((f) => f.ruleId === "ing-analysis"));
});

test("throat-clearing, faux insight, colon reveal, recap ending", () => {
  const r = analyze("Here's the thing. What most people get wrong is simple. The best part: it learns. In conclusion, we win.");
  const ids = new Set(r.findings.map((f) => f.ruleId));
  for (const want of ["throat-clearing", "faux-insight", "colon-reveal", "recap-ending"]) {
    assert.ok(ids.has(want), "missing " + want);
  }
});

test("single vocab word is only minor, not damning", () => {
  const r = analyze("the new build feels pretty robust so far, wanna try it after lunch? i can send you the link");
  assert.ok(r.findings.some((f) => f.ruleId === "ai-vocabulary"));
  assert.ok(r.verdict !== "slop", `one word should not certify slop, got ${r.score}`);
});

test("fancy-is flagged as minor", () => {
  const r = analyze("The app serves as a centralized hub for everything.");
  const f = r.findings.find((x) => x.ruleId === "fancy-is");
  assert.ok(f && f.severity === "minor");
});
