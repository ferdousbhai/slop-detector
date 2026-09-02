(() => {
  "use strict";

  const SEV = { MINOR: "minor", MAJOR: "major" };
  const INSTRUCTIONS = Object.freeze({
    "ai-vocabulary": "Use plain, specific wording.",
    "binary-contrast": "State the positive claim directly.",
    "chatbot-phrase": "Remove canned assistant phrasing.",
    "colon-reveal": "Remove the staged reveal.",
    "dramatic-fragment": "Rewrite as a direct sentence.",
    "em-dash-density": "Use no em dashes.",
    "emoji-bullets": "Use plain list bullets.",
    "essay-connective": "Remove formal transition filler.",
    "faux-insight": "State the point directly.",
    "filler-phrase": "Delete or shorten the filler.",
    "hedging-ratio": "Keep only necessary uncertainty.",
    "inflated-verb": "Use a plain verb.",
    "ing-explainer": "Delete the trailing explanation or state a concrete fact.",
    "landscape-cliche": "Replace the cliche with a concrete description.",
    "puffery": "State the fact without hype.",
    "recap-ending": "Remove the unnecessary recap.",
    "rhetorical-setup": "State the point directly.",
    "throat-clearing": "Start with the substantive point.",
    "triad-adjectives": "Use only necessary modifiers.",
    "uniform-sentences": "Vary sentence lengths.",
    "vague-attribution": "Name the source or remove the attribution.",
  });

  function words(text) {
    return text.trim().split(/\s+/).filter(Boolean);
  }

  function sentences(text) {
    return text
      .split(/(?<=[.!?])\s+|\n+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  function findAll(text, regex, make) {
    const out = [];
    let m;
    const re = new RegExp(regex.source, regex.flags.includes("g") ? regex.flags : regex.flags + "g");
    while ((m = re.exec(text)) !== null) {
      out.push(make(m));
      if (m.index === re.lastIndex) re.lastIndex++;
    }
    return out;
  }

  const PATTERN_CATALOG = [
    { id: "chatbot-phrase", sev: SEV.MAJOR, p: /i hope this (?:message|email|note)? ?finds you well/i, why: "Canonical AI opener." },
    { id: "chatbot-phrase", sev: SEV.MAJOR, p: /\bi'?d be happy to\b/i, why: "Assistant-speak." },
    { id: "chatbot-phrase", sev: SEV.MAJOR, p: /\blet me know if you have any (?:questions|thoughts)\b/i, why: "Assistant-speak closer." },
    { id: "chatbot-phrase", sev: SEV.MAJOR, p: /\bfeel free to\b/i, why: "Assistant-speak." },
    { id: "chatbot-phrase", sev: SEV.MAJOR, p: /\bgreat question\b/i, why: "Sycophantic opener." },
    { id: "chatbot-phrase", sev: SEV.MAJOR, p: /\byou'?re absolutely right\b/i, why: "Sycophantic tone." },
    { id: "chatbot-phrase", sev: SEV.MAJOR, p: /\bcertainly!/i, why: "Assistant-speak." },
    { id: "chatbot-phrase", sev: SEV.MAJOR, p: /\bof course!/i, why: "Assistant-speak." },
    { id: "chatbot-phrase", sev: SEV.MAJOR, p: /\bas an ai\b/i, why: "Literal AI disclosure." },
    { id: "chatbot-phrase", sev: SEV.MAJOR, p: /\bi appreciate your patience\b/i, why: "Support-bot phrasing." },
    { id: "chatbot-phrase", sev: SEV.MAJOR, p: /\bplease don'?t hesitate to\b/i, why: "Support-bot phrasing." },
    { id: "chatbot-phrase", sev: SEV.MAJOR, p: /\b(?:hope (?:this|that) helps|let me know if (?:you need|there'?s) anything else|happy to (?:help|assist|clarify) (?:further|more|with anything else))\b[!.]*/i, why: "Assistant-style closing offer." },
    { id: "chatbot-phrase", sev: SEV.MAJOR, p: /\bfound the smoking gun\b/i, why: "Agent-speak." },

    { id: "puffery", sev: SEV.MAJOR, p: /\b(?:marks?|marking) a pivotal moment\b/i, why: "Importance puffery — state what happened." },
    { id: "puffery", sev: SEV.MAJOR, p: /\b(?:stands? as|is) a testament to\b/i, why: "Importance puffery." },
    { id: "puffery", sev: SEV.MAJOR, p: /\bevolving landscape\b/i, why: "Stock AI framing." },
    { id: "puffery", sev: SEV.MAJOR, p: /\bsetting the stage for\b/i, why: "Puffery." },
    { id: "puffery", sev: SEV.MAJOR, p: /\bindelible mark\b/i, why: "Puffery." },
    { id: "puffery", sev: SEV.MAJOR, p: /\bdeeply rooted\b/i, why: "Puffery." },
    { id: "puffery", sev: SEV.MAJOR, p: /\bplays? a vital role\b/i, why: "Importance puffery." },
    { id: "puffery", sev: SEV.MAJOR, p: /\bsolidif(?:y|ies|ying) (?:its|their|his|her) position\b/i, why: "Importance puffery." },
    { id: "puffery", sev: SEV.MAJOR, p: /\bunderscor(?:es?|ing) (?:its|the) (?:significance|importance|commitment)\b/i, why: "Importance puffery." },
    { id: "puffery", sev: SEV.MAJOR, p: /\b(?:rich|vibrant) tapestry\b/i, why: "AI-favored metaphor." },
    { id: "puffery", sev: SEV.MAJOR, p: /\bin today'?s fast-paced (?:world|environment)\b/i, why: "Stock AI framing." },
    { id: "puffery", sev: SEV.MAJOR, p: /\bdespite (?:these |the |its )?challenges[^.!?\n]{0,60}(?:continues? to thrive|remains?)\b/i, why: "Formulaic “despite challenges” framing." },
    { id: "puffery", sev: SEV.MAJOR, p: /\bunlock (?:the|your) (?:full )?potential\b/i, why: "Stock AI hype." },
    { id: "puffery", sev: SEV.MAJOR, p: /\bthe future looks bright\b/i, why: "Generic conclusion." },

    { id: "vague-attribution", sev: SEV.MAJOR, p: /\bexperts (?:believe|agree|say|suggest)\b/i, why: "Weasel attribution — name the source." },
    { id: "vague-attribution", sev: SEV.MAJOR, p: /\bindustry reports? suggests?\b/i, why: "Weasel attribution." },
    { id: "vague-attribution", sev: SEV.MAJOR, p: /\bstudies (?:show|suggest|indicate)\b/i, why: "Weasel attribution." },
    { id: "vague-attribution", sev: SEV.MAJOR, p: /\bwidely regarded as\b/i, why: "Weasel attribution." },
    { id: "vague-attribution", sev: SEV.MAJOR, p: /\b(?:some|many) (?:critics|people|would) argue\b/i, why: "Weasel attribution." },

    { id: "throat-clearing", sev: SEV.MAJOR, p: /\bhere'?s the thing\b/i, why: "Throat-clearing opener." },
    { id: "throat-clearing", sev: SEV.MAJOR, p: /\blet me be clear\b/i, why: "Throat-clearing opener." },
    { id: "throat-clearing", sev: SEV.MAJOR, p: /\bthe (?:uncomfortable|hard|simple) truth is\b/i, why: "Throat-clearing opener." },
    { id: "throat-clearing", sev: SEV.MAJOR, p: /\blet'?s dive in\b/i, why: "Empty phrase." },
    { id: "faux-insight", sev: SEV.MAJOR, p: /\bwhat most people (?:get wrong|miss|don'?t (?:know|realize|understand))\b/i, why: "Faux-insight setup." },
    { id: "faux-insight", sev: SEV.MAJOR, p: /\bhere'?s what nobody tells you\b/i, why: "Faux-insight setup." },
    { id: "faux-insight", sev: SEV.MAJOR, p: /\bthe part everyone misses\b/i, why: "Faux-insight setup." },
    { id: "faux-insight", sev: SEV.MAJOR, p: /\bthis is the part most people skip\b/i, why: "Faux-insight setup." },

    { id: "rhetorical-setup", sev: SEV.MAJOR, p: /\bwhat if i told you\b/i, why: "Rhetorical setup." },
    { id: "rhetorical-setup", sev: SEV.MAJOR, p: /\bthink about it:/i, why: "Rhetorical setup." },
    { id: "rhetorical-setup", sev: SEV.MAJOR, p: /\bplot twist:/i, why: "Rhetorical setup." },
    { id: "colon-reveal", sev: SEV.MAJOR, p: /\b(?:the best part|the kicker|the catch|the twist|the result):\s/i, why: "Colon reveal — fake drama." },
    { id: "dramatic-fragment", sev: SEV.MAJOR, p: /\bthat'?s it\.\s+that'?s\b/i, why: "\u201CThat's it. That's the whole thing.\u201D fragment drama." },

    { id: "essay-connective", sev: SEV.MAJOR, p: /\bmoreover\b/i, why: "Essay connective — rare in real chat." },
    { id: "essay-connective", sev: SEV.MAJOR, p: /\bfurthermore\b/i, why: "Essay connective — rare in real chat." },
    { id: "essay-connective", sev: SEV.MAJOR, p: /\badditionally,/i, why: "Essay connective — rare in real chat." },
    { id: "recap-ending", sev: SEV.MAJOR, p: /(?:^|(?<=[.!?]\s))(?:in conclusion|in summary|to sum up|overall,|ultimately,)/im, why: "Summary-recap ending — the reader was just there." },
    { id: "filler-phrase", sev: SEV.MINOR, p: /\bit(?:'?s| is) (?:worth noting|important to note)\b/i, why: "Filler — delete it." },
    { id: "filler-phrase", sev: SEV.MINOR, p: /\bdue to the fact that\b/i, why: "\u2192 \u201Cbecause\u201D." },
    { id: "filler-phrase", sev: SEV.MINOR, p: /\bin order to\b/i, why: "\u2192 \u201Cto\u201D." },
    { id: "filler-phrase", sev: SEV.MINOR, p: /\bat the end of the day\b/i, why: "Stock filler." },
    { id: "filler-phrase", sev: SEV.MINOR, p: /\bwhen it comes to\b/i, why: "Often-empty phrase." },
    { id: "filler-phrase", sev: SEV.MINOR, p: /\bat its core\b/i, why: "Often-empty phrase." },
    { id: "filler-phrase", sev: SEV.MINOR, p: /\bin (?:today'?s|the) (?:world|age of)\b/i, why: "Often-empty phrase." },
    { id: "filler-phrase", sev: SEV.MINOR, p: /\bthe (?:reality|truth) is\b/i, why: "Often-empty phrase." },
    { id: "filler-phrase", sev: SEV.MINOR, p: /\bgoing forward\b/i, why: "Often-empty phrase." },

    { id: "inflated-verb", sev: SEV.MINOR, p: /\bserves? as\b/i, why: "\u2192 just say \u201Cis\u201D." },
    { id: "inflated-verb", sev: SEV.MINOR, p: /\bstands? as\b/i, why: "\u2192 just say \u201Cis\u201D." },
    { id: "inflated-verb", sev: SEV.MINOR, p: /\bboasts?\b/i, why: "\u2192 \u201Chas\u201D." },

    { id: "landscape-cliche", sev: SEV.MAJOR, p: /\bnavigat(?:e|ing) (?:the|this|these|today's) (?:complex|challenging|evolving|landscape)/i, why: "\u201CNavigating the X landscape\u201D clich\u00E9." },
    ...[
      ["delve", "Top AI tell."], ["tapestry", "AI metaphor noun."], ["foster(?:s|ing|ed)?", "AI vocabulary."],
      ["leverag(?:e|es|ing|ed)", "\u2192 \u201Cuse\u201D."], ["utiliz(?:e|es|ing|ed)", "\u2192 \u201Cuse\u201D."],
      ["facilitat(?:e|es|ing|ed)", "\u2192 \u201Chelp\u201D."], ["empower(?:s|ing|ed)?", "AI vocabulary."],
      ["streamlin(?:e|es|ing|ed)", "AI vocabulary."], ["robust", "AI vocabulary."],
      ["cutting-edge", "Hype word."], ["game-?changer", "Hype word."], ["groundbreaking", "Promotional word."],
      ["seamless(?:ly)?", "Marketing filler."], ["transformative", "Hype word."], ["paradigm shift", "Hype phrase."],
      ["realm", "AI vocabulary."], ["beacon", "AI vocabulary."], ["multifaceted", "AI vocabulary."],
      ["meticulous(?:ly)?", "AI vocabulary."], ["intricate", "AI vocabulary."], ["paramount", "AI vocabulary."],
      ["elevate(?:s|d)?", "Marketing filler."], ["embark(?:s|ing|ed)?", "AI vocabulary."],
      ["supercharge(?:s|d)?", "Hype word."], ["harness(?:es|ing|ed)?", "AI metaphor verb."],
      ["ever-evolving", "AI vocabulary."], ["crucial(?:ly)?", "AI vocabulary."], ["enduring", "AI vocabulary."],
      ["enhanc(?:e|es|ing|ed)", "AI vocabulary."], ["garner(?:s|ed|ing)?", "AI vocabulary."],
      ["interplay", "AI vocabulary."], ["pivotal", "AI vocabulary."], ["showcas(?:e|es|ing|ed)", "AI vocabulary."],
      ["testament", "AI vocabulary."], ["underscor(?:e|es|ing|ed)", "AI vocabulary."],
      ["nestled", "Promotional word."], ["breathtaking", "Promotional word."], ["renowned", "Promotional word."],
      ["stunning", "Promotional word."], ["must-visit", "Promotional word."],
      ["dive (?:deep(?:er)? )?into", "AI-favored verb."],
    ].map(([wordPattern, explanation]) => ({
      id: "ai-vocabulary",
      sev: SEV.MINOR,
      p: new RegExp("\\b" + wordPattern + "\\b", "i"),
      why: explanation,
    })),
  ];

  const rules = [
    {
      id: "catalog",
      run(text) {
        const out = [];
        for (const {
          id: ruleId,
          sev: severity,
          p: pattern,
          why: explanation,
        } of PATTERN_CATALOG) {
          for (const finding of findAll(text, pattern, (match) => ({
            start: match.index,
            end: match.index + match[0].length,
          }))) {
            out.push({
              ...finding,
              ruleId,
              severity,
              message: `"${text.slice(finding.start, finding.end)}" \u2014 ${explanation}`,
            });
          }
        }
        return out;
      },
    },
    {
      id: "binary-contrast",
      run(text) {
        const out = [];
        out.push(...findAll(
          text,
          /\b(?:it'?s|this is|that'?s|they'?re|is)? ?not (?:just|only|merely|simply) [^.!?\n]{2,60}?[,;\u2014-]? ?(?:it'?s|but(?: also)?|but rather)\b/gi,
          (m) => ({ start: m.index, end: m.index + m[0].length, message: "\u201CNot just X, but Y\u201D \u2014 signature AI cadence. State Y directly." })
        ));
        out.push(...findAll(
          text,
          /\b(?:this |that |the \w+ )?(?:isn'?t|is not|wasn'?t)(?: about)? [^.!?\n]{2,50}[.,;]\s*it'?s\b/gi,
          (m) => ({ start: m.index, end: m.index + m[0].length, message: "Binary contrast (\u201CIt isn't X. It's Y.\u201D) \u2014 state Y directly." })
        ));
        out.push(...findAll(
          text,
          /\bnot an? [^.!?\n]{2,40}\.\s+not an?\b/gi,
          (m) => ({ start: m.index, end: m.index + m[0].length, message: "Negative listing (\u201CNot a X. Not a Y. A Z.\u201D) \u2014 just say Z." })
        ));
        return out.map((f) => ({ ...f, ruleId: "binary-contrast", severity: SEV.MAJOR }));
      },
    },
    {
      id: "ing-explainer",
      run(text) {
        return findAll(
          text,
          /,\s+(?:highlighting|underscoring|reflecting|showcasing|fostering|ensuring|emphasizing|demonstrating|signaling|cementing)\b[^.!?\n]{0,60}/gi,
          (m) => ({
            start: m.index, end: m.index + m[0].length,
            ruleId: "ing-explainer", severity: SEV.MAJOR,
            message: "Trailing \u201C-ing\u201D clause pretending to explain meaning \u2014 delete or replace with a concrete fact.",
          })
        );
      },
    },
    {
      id: "em-dash-density",
      run(text) {
        const w = words(text).length;
        if (w < 15) return [];
        const dashes = findAll(text, /\u2014/g, (m) => ({ start: m.index, end: m.index + m[0].length }));
        const per100 = (dashes.length / w) * 100;
        if (per100 < 2.5) return [];
        return dashes.map((d) => ({
          ...d, ruleId: "em-dash-density", severity: SEV.MINOR,
          message: `Em-dash density is ${per100.toFixed(1)} per 100 words \u2014 models lean on these hard.`,
        }));
      },
    },
    {
      id: "hedging-ratio",
      run(text) {
        const w = words(text).length;
        if (w < 20) return [];
        const hedges = findAll(
          text,
          /\b(?:perhaps|arguably|generally|typically|often|likely|potentially|essentially|ultimately|overall|in many ways)\b/gi,
          (m) => ({ start: m.index, end: m.index + m[0].length })
        );
        if ((hedges.length / w) * 100 < 3) return [];
        return hedges.map((h) => ({
          ...h, ruleId: "hedging-ratio", severity: SEV.MINOR,
          message: "Heavy hedging \u2014 models soften every claim.",
        }));
      },
    },
    {
      id: "triad-adjectives",
      run(text) {
        return findAll(
          text,
          /\b\w+(?:ive|ing|ed|ful|ous|able|ant|ent|al|ic|y),\s+\w+(?:ive|ing|ed|ful|ous|able|ant|ent|al|ic|y),\s+and\s+\w+(?:ive|ing|ed|ful|ous|able|ant|ent|al|ic|y)\b/gi,
          (m) => ({
            start: m.index, end: m.index + m[0].length,
            ruleId: "triad-adjectives", severity: SEV.MINOR,
            message: "Rule-of-three adjective triad \u2014 use the natural number of items.",
          })
        );
      },
    },
    {
      id: "uniform-sentences",
      run(text) {
        const ss = sentences(text);
        if (ss.length < 4) return [];
        const lens = ss.map((s) => words(s).length);
        const mean = lens.reduce((a, b) => a + b, 0) / lens.length;
        if (mean < 8) return [];
        const sd = Math.sqrt(lens.reduce((a, b) => a + (b - mean) ** 2, 0) / lens.length);
        if (sd / mean > 0.3) return [];
        return [{
          start: 0, end: 0, ruleId: "uniform-sentences", severity: SEV.MINOR,
          message: `Sentences are eerily uniform (${lens.join(", ")} words each). Humans vary rhythm more.`,
        }];
      },
    },
    {
      id: "emoji-bullets",
      run(text) {
        const hits = findAll(text, /^\s*(?:[\u2700-\u27BF\u2600-\u26FF]|\p{Extended_Pictographic})\s+\S/gmu, (m) => ({
          start: m.index, end: m.index + m[0].length,
        }));
        if (hits.length < 2) return [];
        return hits.map((h) => ({
          ...h, ruleId: "emoji-bullets", severity: SEV.MAJOR,
          message: "Emoji used as list bullets \u2014 a strong AI formatting tell.",
        }));
      },
    },
  ];

  function analyze(text) {
    const findings = [];
    for (const rule of rules) findings.push(...rule.run(text));
    for (const finding of findings) {
      finding.instruction = INSTRUCTIONS[finding.ruleId] ?? "Remove the flagged pattern.";
    }
    findings.sort((a, b) => a.start - b.start);

    const wc = words(text).length;
    let points = 0;
    for (const f of findings) points += f.severity === SEV.MAJOR ? 12 : 5;
    const score = Math.min(100, Math.round(points * Math.min(1, 60 / Math.max(wc, 1)) + points * 0.4));

    let verdict, label;
    if (score >= 50) { verdict = "slop"; label = "CERTIFIED SLOP"; }
    else if (score >= 20) { verdict = "suspicious"; label = "SUSPICIOUS"; }
    else { verdict = "human"; label = "READS HUMAN"; }

    return { score, verdict, label, findings, wordCount: wc };
  }

  const api = { analyze, rules };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  globalThis.SlopEngine = api;
})();
