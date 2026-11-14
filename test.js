const test = require("node:test");
const assert = require("node:assert/strict");
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
  const command = "Run npm test -- --watch, then use git log --oneline --all before opening the pull request.";
  assert.ok(analyze(dense).findings.some((f) => f.ruleId === "em-dash-density"));
  assert.ok(!analyze(sparse).findings.some((f) => f.ruleId === "em-dash-density"));
  assert.ok(!analyze(command).findings.some((f) => f.ruleId === "em-dash-density"));
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
    "The next milestone arrives at the end of this month. " +
    "The steering group meets again on the first of March.";
  const four = uniform.split(". ").slice(0, 4).join(". ") + ".";
  assert.ok(!analyze(four).findings.some((f) => f.ruleId === "uniform-sentences"), "four sentences are too few to judge");
  const wrapped = "The plan needs a careful review before the\nboard meets on Friday. I can send it tonight. Does that\nwork for everyone on the list, or should we wait until\nMonday? Either is fine. Tell me which you would prefer.";
  assert.ok(!analyze(wrapped).findings.some((f) => f.ruleId === "uniform-sentences"), "wrapped lines are not sentences");
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
  assert.ok(r.findings.some((f) => f.ruleId === "ing-explainer"));
});

test("landscape cliche flagged as major, dive into as minor vocab", () => {
  const r = analyze("We are navigating the evolving landscape of this space, ready to dive into the details.");
  const cliche = r.findings.find((f) => f.ruleId === "landscape-cliche");
  const dive = r.findings.find((f) => f.ruleId === "ai-vocabulary" && /dive into/i.test(f.message));
  assert.ok(cliche && cliche.severity === "major", "landscape cliche should be major");
  assert.ok(dive && dive.severity === "minor", "dive into should be minor ai-vocabulary");
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

const ruleIds = (text, options) => analyze(text, options).findings.map((f) => f.ruleId);

test("structural tics are each caught by their own rule", () => {
  const cases = [
    ["binary-contrast", "It is not a wrong answer. It is a non-answer."],
    ["significance-designation", "It is the leg that answers the actual question."],
    ["abstraction-agency", "Median hides it."],
    ["abstraction-agency", "The table shows it."],
    ["deferred-noun", "Five of those six rows are one cluster. The sixth is not."],
    ["aphoristic-closer", "It is the kind of number that looks like evidence and is not."],
    ["strawman-knockdown", "\"It thinks twice as long\" is the obvious reading, and it is wrong."],
    ["fragment-cadence", "Six legs. One GPU, one server build, one sampler, one question set."],
    ["dressed-metaphor", "That is information loss wearing the costume of a style fix."],
    ["label-first", "- **User Experience:** the page loads before the fonts do."],
  ];
  for (const [want, text] of cases) {
    assert.ok(ruleIds(text).includes(want), `${want} missed: ${text}`);
  }
});

test("plain statements of the same shapes stay clean", () => {
  const clean = [
    "The variable is not defined, it is set later by the installer.",
    "This is not supported. It is possible to work around it with a flag.",
    "The file is not empty, its header is forty bytes long.",
    "She says so. He hides it.",
    "Release 1.2.3. fixes the crash, and 3.5 seconds is the new timeout.",
    "- **Theme:** the name of the active color scheme.",
    "**Note:** restart the service after editing the file.",
    "Fixed a bug in the parser. Fixed a bug in the lexer. Fixed a bug in the printer.",
  ];
  for (const text of clean) assert.deepStrictEqual(ruleIds(text), [], text);
});

test("a narrower match inside a wider one of the same rule is reported once", () => {
  const r = analyze("It is the kind of number that looks like evidence and is not.");
  assert.strictEqual(r.findings.filter((f) => f.ruleId === "aphoristic-closer").length, 1);
});

test("fragment runs and repeated openings are flagged", () => {
  assert.ok(ruleIds("We shipped it on Friday. Fast. Cheap. Reliable. Then the pager went off.").includes("fragment-cadence"));
  assert.ok(ruleIds("It was a message. It was a permission slip. It was an out.").includes("fragment-cadence"));
  assert.ok(!ruleIds("Sounds good. See you at nine, and bring the laptop.").includes("fragment-cadence"));
});

test("coy and thesis-shaped headers are flagged, labels and questions are not", () => {
  for (const title of ["What \"exhausted\" means", "The one gap that does clear the bar", "Why this matters"]) {
    assert.ok(ruleIds(`## ${title}\n\nBody text follows here.`).includes("coy-header"), `markdown: ${title}`);
    assert.ok(ruleIds(title, { heading: true }).includes("coy-header"), `heading option: ${title}`);
    assert.ok(!ruleIds(title).includes("coy-header"), `not a heading: ${title}`);
  }
  for (const title of ["How it works", "How to install the extension", "Why does this matter?", "Privacy and limitations"]) {
    assert.ok(!ruleIds(title, { heading: true }).includes("coy-header"), title);
  }
});

test("a leading bold run reported by the caller counts as a label", () => {
  const text = "Fast startup: the page renders before the fonts arrive.";
  const finding = analyze(text, { boldLead: "Fast startup:".length }).findings.find((f) => f.ruleId === "label-first");
  assert.ok(finding);
  assert.strictEqual(text.slice(finding.start, finding.end), "Fast startup:");
  assert.ok(!ruleIds(text).includes("label-first"));
});

test("score discounts findings by text length", () => {
  const filler = "We met at the coffee shop around nine and argued about the playoffs for an hour. ";
  const tell = "In order to ship we need a robust plan. ";
  const short = analyze(filler + tell.repeat(3));
  const long = analyze(filler.repeat(300) + tell.repeat(3));
  assert.ok(short.score >= 20, `short text with six findings should be suspicious, got ${short.score}`);
  assert.strictEqual(long.verdict, "human", `the same findings in ${long.wordCount} words scored ${long.score}`);
});

test("every rule has one severity and an instruction, and docs/rules.md lists it", () => {
  const { rules } = require("./extension/engine.js");
  const table = require("node:fs").readFileSync(require("node:path").join(__dirname, "docs", "rules.md"), "utf8");
  for (const [id, rule] of Object.entries(rules)) {
    assert.match(rule.severity, /^(?:major|minor)$/, id);
    assert.ok(rule.instruction.length > 0, id);
    const level = rule.severity === "major" ? "error" : "warning";
    assert.ok(table.includes(`| \`${id}\` | ${level} |`), `docs/rules.md is missing or mislabels ${id}`);
  }
});

test("ordinary sentences that share a shape with a tic stay clean", () => {
  const clean = [
    "The file was not found. It was deleted by the cleanup job yesterday.",
    "The server is not running. It is started by systemd at boot.",
    "The package is not installed.\n\nIt is required by the build step.",
    "This is not just a problem for the parser; its tests break too.",
    "Do not simply delete the file; it may still be needed by other users.",
    "What was the result? I never heard back from them.",
    "Compare the result: it should print 42.",
    "She joined the lab as an AI researcher in 2019.",
    "We toured Germany, Italy, and Hungary last summer.",
    "The input is parsed, validated, and stored.",
    "It is the tallest building in the world.",
    "Run the test harness before you push.",
    "Set the Kerberos realm in krb5.conf.",
    "My mother says so.",
    "I thought it would work but it didn't.",
    "Readers want not only the facts but also the reasons behind them.",
  ];
  for (const text of clean) assert.deepStrictEqual(ruleIds(text), [], text);
});

test("emoji bullets cover variation selectors and joined sequences, and mark only the bullet", () => {
  for (const text of ["⚠️ Check the logs first\n✔️ Run the tests again", "👨‍💻 Write the code\n👩‍🔬 Run the experiment"]) {
    const found = analyze(text).findings.filter((f) => f.ruleId === "emoji-bullets");
    assert.strictEqual(found.length, 2, text);
    for (const f of found) assert.ok(!/[A-Za-z]/.test(text.slice(f.start, f.end)), "span must stop before the text");
  }
});

test("whitespace runs do not slow analysis down", () => {
  const inputs = [
    "# a" + " ".repeat(20000) + "b",
    "one two three four five six seven." + "\n        ".repeat(20000) + "tail",
    "word" + " ".repeat(100000) + "word. Next one.",
  ];
  const started = Date.now();
  for (const text of inputs) analyze(text);
  assert.ok(Date.now() - started < 2000, `took ${Date.now() - started} ms`);
});

test("a wrapped line is not a sentence start", () => {
  const wrapped = [
    "After the loop finishes we sort the names and print\nthe result: a list of names in alphabetical order.",
    "We measured each stage and the latency was low\noverall, though the last stage took longer than the rest.",
    "Nobody in the room that afternoon seemed to know\nthe answer? That surprised me.",
    "I checked every row twice and it turned out only\none number was wrong in the whole sheet.",
  ];
  for (const text of wrapped) assert.deepStrictEqual(ruleIds(text), [], text);

  const starts = [
    ["colon-reveal", "We shipped on time. The catch: nobody had tested it."],
    ["colon-reveal", "- The catch: nobody had tested it."],
    ["recap-ending", "It rained all week.\n\nIn conclusion, bring a coat."],
    ["rhetorical-setup", "We shipped it. \"The result? Chaos.\""],
    ["label-first", "Two things: the cache is cold and the disk is full."],
  ];
  for (const [want, text] of starts) assert.ok(ruleIds(text).includes(want), `${want} missed: ${text}`);
});

test("negation followed by an unrelated sentence is not a contrast", () => {
  const clean = [
    "That was not the plan. It was raining, so we stayed in.",
    "The meeting is not about budgets. It is at three.",
    "The server isn't responding, it's probably down for maintenance again.",
    "The pond was perfectly still, reflecting the pines along the far bank.",
  ];
  for (const text of clean) assert.deepStrictEqual(ruleIds(text), [], text);
  for (const text of ["This isn't about speed. It's about trust.", "It isn't a bug, it's a feature.", "That isn't magic, it's math."]) {
    assert.ok(ruleIds(text).includes("binary-contrast"), text);
  }
});

test("spans start on the first flagged word, and list rows never chain", () => {
  const text = "They do not just sit there, but move around.";
  const [finding] = analyze(text).findings;
  assert.strictEqual(text.slice(finding.start, finding.end), "not just sit there, but");
  const rows = "* It supports Linux on x86 machines.\n* It supports macOS on Apple silicon.\n* It supports Windows through WSL.";
  assert.deepStrictEqual(ruleIds(rows), []);
});

test("conditions and unrelated second sentences are not contrasts", () => {
  const clean = [
    "If it isn't plugged in, it's not going to work.",
    "If the server isn't running, it's because the port is taken.",
    "When the cache isn't warm, it's a lot slower.",
    "The printer isn't working again. It's the third time this week.",
    "My car isn't starting. It's really cold outside today.",
    "I'm not just saying that because it's Friday.",
    "If that doesn't simply work, we can try the other approach.",
    "It doesn't only happen on Linux. We saw it on macOS too.",
    "The result: 42 passed, 3 failed.",
  ];
  for (const text of clean) assert.deepStrictEqual(ruleIds(text), [], text);
});

test("typographic apostrophes and no-break spaces match like plain ones", () => {
  const text = "I’d be happy to help, and feel free to ask. It isn’t a bug, it’s a feature.";
  const found = analyze(text).findings;
  assert.deepStrictEqual(found.map((f) => f.ruleId), ["chatbot-phrase", "chatbot-phrase", "binary-contrast"]);
  assert.strictEqual(text.slice(found[0].start, found[0].end), "I’d be happy to");
});

test("URLs are not prose, and spans end on a word", () => {
  for (const text of [
    "See https://example.com/robust-seamless-design for every detail of the plan.",
    "The docs live at www.example.com/delve-guide and nowhere else today.",
  ]) assert.deepStrictEqual(ruleIds(text), [], text);
  for (const text of [
    "The rollout shipped on time, underscoring the organizational commitment to reliability engineering practices across teams.",
    "This launch went out, showcasing our robust and transformative vision for the evolving landscape.",
  ]) {
    const finding = analyze(text).findings.find((f) => f.ruleId === "ing-explainer");
    assert.ok(finding, text);
    assert.match(text.slice(finding.end, finding.end + 1), /^(?:[\s.,;:!?]|)$/, `span ends mid-word: ${text.slice(finding.start, finding.end)}`);
  }
});

test("a URL keeps its line and its sentence end", () => {
  for (const text of [
    "The mirror list lives at\nhttps://example.com/mirrors/list.txt\nand the catch: it only updates weekly, so check the date first.",
    "The fix landed upstream in\nhttps://github.com/org/repo/pull/123\nbut the problem? It only ships in the next release next month.",
  ]) assert.deepStrictEqual(ruleIds(text), [], text);
  for (const text of [
    "Read the guide at https://example.com/guide. Ultimately, the choice is yours to make here.",
    "Read the guide at https://example.com/guide! Overall, the choice is yours to make here.",
  ]) assert.ok(ruleIds(text).includes("recap-ending"), text);
});
