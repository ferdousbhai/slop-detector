(() => {
  "use strict";

  const MAJOR = "major";
  const MINOR = "minor";

  /* One severity per rule, so a configured level means the same thing for every pattern of that rule. */
  const RULES = Object.freeze({
    "abstraction-agency": { severity: MINOR, instruction: "Name who or what acts, and say what it does." },
    "ai-vocabulary": { severity: MINOR, instruction: "Use plain, specific wording." },
    "aphoristic-closer": { severity: MINOR, instruction: "End on the fact, not a quotable line." },
    "binary-contrast": { severity: MAJOR, instruction: "State the positive claim directly." },
    "chatbot-phrase": { severity: MAJOR, instruction: "Remove canned assistant phrasing." },
    "colon-reveal": { severity: MAJOR, instruction: "Remove the staged reveal." },
    "coy-header": { severity: MINOR, instruction: "Label the section with its content." },
    "deferred-noun": { severity: MINOR, instruction: "Name the thing instead of pointing at it." },
    "dramatic-fragment": { severity: MAJOR, instruction: "Rewrite as a direct sentence." },
    "dressed-metaphor": { severity: MINOR, instruction: "Name the mechanism instead of the metaphor." },
    "em-dash-density": { severity: MINOR, instruction: "Use no em dashes." },
    "emoji-bullets": { severity: MAJOR, instruction: "Use plain list bullets." },
    "essay-connective": { severity: MAJOR, instruction: "Remove formal transition filler." },
    "faux-insight": { severity: MAJOR, instruction: "State the point directly." },
    "filler-phrase": { severity: MINOR, instruction: "Delete or shorten the filler." },
    "fragment-cadence": { severity: MINOR, instruction: "Join the fragments into one full sentence." },
    "hedging-ratio": { severity: MINOR, instruction: "Keep only necessary uncertainty." },
    "inflated-verb": { severity: MINOR, instruction: "Use a plain verb." },
    "ing-explainer": { severity: MAJOR, instruction: "Delete the trailing explanation or state a concrete fact." },
    "label-first": { severity: MINOR, instruction: "Drop the label and start with the content." },
    "landscape-cliche": { severity: MAJOR, instruction: "Replace the cliche with a concrete description." },
    "puffery": { severity: MAJOR, instruction: "State the fact without hype." },
    "recap-ending": { severity: MAJOR, instruction: "Remove the unnecessary recap." },
    "rhetorical-setup": { severity: MAJOR, instruction: "State the point directly." },
    "significance-designation": { severity: MINOR, instruction: "State the fact and let the reader judge its weight." },
    "strawman-knockdown": { severity: MAJOR, instruction: "State the correct reading without staging a wrong one." },
    "throat-clearing": { severity: MAJOR, instruction: "Start with the substantive point." },
    "triad-adjectives": { severity: MINOR, instruction: "Use only necessary modifiers." },
    "uniform-sentences": { severity: MINOR, instruction: "Vary sentence lengths." },
    "vague-attribution": { severity: MAJOR, instruction: "Name the source or remove the attribution." },
  });

  function words(text) {
    return text.trim().split(/\s+/).filter(Boolean);
  }

  /* A lone line break is a hard wrap and stays inside its paragraph; a blank line, a list marker, or a
     Markdown heading starts a new one. Walking lines keeps this linear on long runs of whitespace. */
  function paragraphSpans(text) {
    const out = [];
    let start = -1;
    let end = -1;
    let offset = 0;
    const flush = () => {
      if (start !== -1) out.push({ start, end });
      start = -1;
    };
    for (const line of text.split("\n")) {
      const content = line.trim();
      if (content === "") flush();
      else {
        if (/^(?:[-*+\u2022]|\d+[.)]|#{1,6})[ \t]/.test(content)) flush();
        if (start === -1) start = offset + line.indexOf(content);
        end = offset + line.indexOf(content) + content.length;
      }
      offset += line.length + 1;
    }
    flush();
    return out;
  }

  /* A terminator only ends a sentence before whitespace, so "v1.2.3" and "3.5 seconds" stay whole.
     Several rules ask for the same text in one analyze call, so the last answer is kept. */
  let lastSentences = { text: null, spans: [] };
  function sentenceSpans(text) {
    if (lastSentences.text === text) return lastSentences.spans;
    const spans = [];
    paragraphSpans(text).forEach((paragraph, index) => {
      const body = text.slice(paragraph.start, paragraph.end);
      for (const m of body.matchAll(/\S[^]*?(?:[.!?]+["'”’)\]]*(?=\s)|$)/g)) {
        spans.push({ start: paragraph.start + m.index, end: paragraph.start + m.index + m[0].length, text: m[0], paragraph: index });
      }
    });
    lastSentences = { text, spans };
    return spans;
  }

  /* A line start is not a sentence start in hard-wrapped prose, so sentence-anchored patterns are tried
     at each sentence's first word, past any list marker, heading marker, or opening quote. */
  const SENTENCE_LEAD = /(?:(?:[-*+•>]|\d+[.)]|#{1,6})[ \t]+)?["'“‘(]*/y;
  const stickyPatterns = new Map();
  function findAtSentenceStarts(text, pattern) {
    let sticky = stickyPatterns.get(pattern);
    if (!sticky) stickyPatterns.set(pattern, sticky = new RegExp(pattern.source, "iy"));
    const out = [];
    for (const span of sentenceSpans(text)) {
      SENTENCE_LEAD.lastIndex = span.start;
      sticky.lastIndex = span.start + SENTENCE_LEAD.exec(text)[0].length;
      const match = sticky.exec(text);
      if (match) out.push({ start: match.index, end: match.index + match[0].length });
    }
    return out;
  }

  /* Runs of consecutive sentences in one paragraph that satisfy `joins`. List rows and headings are
     paragraphs of their own, so they never chain. */
  function sentenceRuns(spans, joins) {
    const runs = [];
    let run = [];
    for (const span of spans) {
      const previous = run[run.length - 1];
      if (previous && previous.paragraph === span.paragraph && joins(previous, span)) run.push(span);
      else {
        if (run.length > 1) runs.push(run);
        run = [span];
      }
    }
    if (run.length > 1) runs.push(run);
    return runs;
  }

  /* "## Title ##" closes with hashes that are not part of the title. */
  function withoutClosingHashes(title) {
    const closing = /#+$/.exec(title);
    return closing && /[ \t]/.test(title[closing.index - 1] ?? "") ? title.slice(0, closing.index).trimEnd() : title;
  }

  /* The catalog's patterns are tried on every block, so each one's global form is built once. */
  const globalForms = new WeakMap();
  function findAll(text, regex, make) {
    let re = regex.global ? regex : globalForms.get(regex);
    if (!re) globalForms.set(regex, re = new RegExp(regex.source, regex.flags + "g"));
    re.lastIndex = 0;
    const out = [];
    let m;
    while ((m = re.exec(text)) !== null) {
      out.push(make(m));
      if (m.index === re.lastIndex) re.lastIndex++;
    }
    return out;
  }

  const PATTERN_CATALOG = [
    { id: "chatbot-phrase", p: /i hope this (?:message|email|note)? ?finds you well/i, why: "Canonical AI opener." },
    { id: "chatbot-phrase", p: /\bi'?d be happy to\b/i, why: "Assistant-speak." },
    { id: "chatbot-phrase", p: /\blet me know if you have any (?:questions|thoughts)\b/i, why: "Assistant-speak closer." },
    { id: "chatbot-phrase", p: /\bfeel free to\b/i, why: "Assistant-speak." },
    { id: "chatbot-phrase", p: /\bgreat question\b/i, why: "Sycophantic opener." },
    { id: "chatbot-phrase", p: /\byou'?re absolutely right\b/i, why: "Sycophantic tone." },
    { id: "chatbot-phrase", p: /\bcertainly!/i, why: "Assistant-speak." },
    { id: "chatbot-phrase", p: /\bof course!/i, why: "Assistant-speak." },
    { id: "chatbot-phrase", p: /\bas an ai(?:,| (?:language |chat)?(?:model|assistant|system)\b)/i, why: "Literal AI disclosure." },
    { id: "chatbot-phrase", p: /\bi appreciate your patience\b/i, why: "Support-bot phrasing." },
    { id: "chatbot-phrase", p: /\bplease don'?t hesitate to\b/i, why: "Support-bot phrasing." },
    { id: "chatbot-phrase", p: /\b(?:hope (?:this|that) helps|let me know if (?:you need|there'?s) anything else|happy to (?:help|assist|clarify) (?:further|more|with anything else))\b[!.]*/i, why: "Assistant-style closing offer." },
    { id: "chatbot-phrase", p: /\bfound the smoking gun\b/i, why: "Agent-speak." },

    { id: "puffery", p: /\b(?:marks?|marking) a pivotal moment\b/i, why: "Importance puffery — state what happened." },
    { id: "puffery", p: /\b(?:stands? as|is) a testament to\b/i, why: "Importance puffery." },
    { id: "puffery", p: /\bevolving landscape\b/i, why: "Stock AI framing." },
    { id: "puffery", p: /\bsetting the stage for\b/i, why: "Puffery." },
    { id: "puffery", p: /\bindelible mark\b/i, why: "Puffery." },
    { id: "puffery", p: /\bdeeply rooted\b/i, why: "Puffery." },
    { id: "puffery", p: /\bplays? a vital role\b/i, why: "Importance puffery." },
    { id: "puffery", p: /\bsolidif(?:y|ies|ying) (?:its|their|his|her) position\b/i, why: "Importance puffery." },
    { id: "puffery", p: /\bunderscor(?:es?|ing) (?:its|the) (?:significance|importance|commitment)\b/i, why: "Importance puffery." },
    { id: "puffery", p: /\b(?:rich|vibrant) tapestry\b/i, why: "AI-favored metaphor." },
    { id: "puffery", p: /\bin today'?s fast-paced (?:world|environment)\b/i, why: "Stock AI framing." },
    { id: "puffery", p: /\bdespite (?:these |the |its )?challenges[^.!?\n]{0,60}(?:continues? to thrive|remains?)\b/i, why: "Formulaic “despite challenges” framing." },
    { id: "puffery", p: /\bunlock (?:the|your) (?:full )?potential\b/i, why: "Stock AI hype." },
    { id: "puffery", p: /\bthe future looks bright\b/i, why: "Generic conclusion." },

    { id: "vague-attribution", p: /\bexperts (?:believe|agree|say|suggest)\b/i, why: "Weasel attribution — name the source." },
    { id: "vague-attribution", p: /\bindustry reports? suggests?\b/i, why: "Weasel attribution." },
    { id: "vague-attribution", p: /\bstudies (?:show|suggest|indicate)\b/i, why: "Weasel attribution." },
    { id: "vague-attribution", p: /\bwidely regarded as\b/i, why: "Weasel attribution." },
    { id: "vague-attribution", p: /\b(?:some|many) (?:critics|people|would) argue\b/i, why: "Weasel attribution." },

    { id: "throat-clearing", p: /\bhere'?s the thing\b/i, why: "Throat-clearing opener." },
    { id: "throat-clearing", p: /\blet me be clear\b/i, why: "Throat-clearing opener." },
    { id: "throat-clearing", p: /\bthe (?:uncomfortable|hard|simple) truth is\b/i, why: "Throat-clearing opener." },
    { id: "throat-clearing", p: /\blet'?s dive in\b/i, why: "Empty phrase." },
    { id: "faux-insight", p: /\bwhat most people (?:get wrong|miss|don'?t (?:know|realize|understand))\b/i, why: "Faux-insight setup." },
    { id: "faux-insight", p: /\bhere'?s what nobody tells you\b/i, why: "Faux-insight setup." },
    { id: "faux-insight", p: /\bthe part everyone misses\b/i, why: "Faux-insight setup." },
    { id: "faux-insight", p: /\bthis is the part most people skip\b/i, why: "Faux-insight setup." },

    { id: "rhetorical-setup", p: /\bwhat if i told you\b/i, why: "Rhetorical setup." },
    { id: "rhetorical-setup", p: /\bthink about it:/i, why: "Rhetorical setup." },
    { id: "rhetorical-setup", p: /\bplot twist:/i, why: "Rhetorical setup." },
    { id: "colon-reveal", at: "sentence", p: /(?:and |but )?(?:the best part|the kicker|the catch|the twist):\s/i, why: "Colon reveal — fake drama." },
    { id: "dramatic-fragment", p: /\bthat'?s it\.\s+that'?s\b/i, why: "\u201CThat's it. That's the whole thing.\u201D fragment drama." },

    { id: "essay-connective", p: /\bmoreover\b/i, why: "Essay connective — rare in real chat." },
    { id: "essay-connective", p: /\bfurthermore\b/i, why: "Essay connective — rare in real chat." },
    { id: "essay-connective", p: /\badditionally,/i, why: "Essay connective — rare in real chat." },
    { id: "recap-ending", at: "sentence", p: /(?:in conclusion|in summary|to sum up|overall,|ultimately,)/i, why: "Summary-recap ending — the reader was just there." },
    { id: "filler-phrase", p: /\bit(?:'?s| is) (?:worth noting|important to note)\b/i, why: "Filler — delete it." },
    { id: "filler-phrase", p: /\bdue to the fact that\b/i, why: "\u2192 \u201Cbecause\u201D." },
    { id: "filler-phrase", p: /\bin order to\b/i, why: "\u2192 \u201Cto\u201D." },
    { id: "filler-phrase", p: /\bat the end of the day\b/i, why: "Stock filler." },
    { id: "filler-phrase", p: /\bwhen it comes to\b/i, why: "Often-empty phrase." },
    { id: "filler-phrase", p: /\bat its core\b/i, why: "Often-empty phrase." },
    { id: "filler-phrase", p: /\bin (?:today'?s world|the age of)\b/i, why: "Often-empty phrase." },
    { id: "filler-phrase", p: /\bthe (?:reality|truth) is\b/i, why: "Often-empty phrase." },
    { id: "filler-phrase", p: /\bgoing forward\b/i, why: "Often-empty phrase." },

    { id: "chatbot-phrase", p: /\bwould you like me to\b/i, why: "Assistant-style closing offer." },
    { id: "chatbot-phrase", p: /\bhere is an overview of\b/i, why: "Assistant-speak." },
    { id: "chatbot-phrase", p: /\bas of my (?:last (?:update|training)|knowledge cutoff)\b/i, why: "Knowledge-cutoff disclaimer." },
    { id: "puffery", p: /\b(?:represents?|marks?) (?:a|an|the) (?:major |significant |fundamental |key |important )?(?:shift|turning point|milestone|departure|step forward|leap)\b/i, why: "Importance puffery \u2014 say what changed." },
    { id: "throat-clearing", p: /\bi (?:will not|won'?t) pretend\b/i, why: "Announced sincerity." },
    { id: "throat-clearing", p: /\blet'?s be (?:honest|real|clear)\b/i, why: "Announced sincerity." },
    { id: "throat-clearing", p: /\bhere'?s where it gets\b/i, why: "Staged reveal." },
    { id: "rhetorical-setup", at: "sentence", p: /(?:and |but |so )?the (?:result|catch|problem|solution|answer|kicker|twist|best part|worst part|upshot|takeaway|reason|difference|secret|trick|outcome|bottom line|verdict|lesson)\?\s/i, why: "Self-answered question \u2014 state the answer." },
    { id: "filler-phrase", p: /\bat this point in time\b/i, why: "\u2192 \u201Cnow\u201D." },
    { id: "filler-phrase", p: /\bin the event that\b/i, why: "\u2192 \u201Cif\u201D." },
    { id: "filler-phrase", p: /\bhas the ability to\b/i, why: "\u2192 \u201Ccan\u201D." },
    { id: "filler-phrase", p: /\b(?:could|might|may) (?:potentially|possibly|conceivably)\b/i, why: "Stacked hedges \u2014 one carries the uncertainty." },

    { id: "significance-designation", p: /\b(?:it|this|that)(?:'?s| is| was) the (?:one|part|bit|piece|leg|step|line|row|number|detail|thing|change|question|distinction) (?:that|which|where)\b/i, why: "Designates what matters instead of stating it." },
    { id: "significance-designation", p: /\bthe (?:one|part|thing|leg|row|line|number|question|detail|distinction|only thing|only one) that (?:actually |really )?(?:matters|counts|does the work|makes the point|tells the story)\b/i, why: "\u201CThe X that matters\u201D \u2014 the reader decides what matters." },
    { id: "significance-designation", p: /\bthe (?:real|actual|true|interesting|key) (?:question|problem|issue|story|lesson|insight|takeaway|culprit|trick|win|test|answer)\b/i, why: "\u201CThe real X\u201D implies the others were fake." },
    { id: "significance-designation", p: /\b(?:most|more) (?:interesting|telling|revealing|surprising) (?:part|thing|bit|detail)\b/i, why: "Significance tag." },
    { id: "significance-designation", p: /\b(?:that|this|which)(?:'?s| is| was) (?:exactly |precisely )?why [^.!?\n]{0,60}?\bmatters?\b/i, why: "Grades a passage the reader just read." },

    { id: "abstraction-agency", at: "sentence", p: /(?!(?:he|she|it|i|we|they|you|who|nobody|everyone|someone|that|this)\b)(?:the |a )?[a-z][\w-]*(?: [a-z][\w-]*)? (?:hides|shows|proves|explains|confirms|settles|reveals|masks|buries|misses|decides) (?:it|that|this|so|otherwise|everything|nothing)\.(?=\s|$)/i, why: "Clipped sentence with an abstraction as the actor." },
    { id: "abstraction-agency", p: /\b(?:table|chart|graph|data|numbers?|median|mean|average|metric|figure|plot|headline|benchmark|result)s? (?:hides?|admits?|knows?|wants?|refuses?|insists?|pretends?|forgets?|promises?)\b/i, why: "Inanimate subject given a mind." },
    { id: "abstraction-agency", p: /\bdoing (?:a lot of|all the|most of the|the real|real|quiet) work\b/i, why: "\u201CDoing the work\u201D \u2014 say what it does." },
    { id: "abstraction-agency", p: /\b(?:do|does|did|doing) (?:a lot of |all (?:of )?the |most of the |the )?heavy lifting\b/i, why: "\u201CHeavy lifting\u201D \u2014 say what it does." },
    { id: "abstraction-agency", p: /\bearns? (?:its|their) (?:keep|place|spot|name|complexity|slot)\b/i, why: "Abstraction earning something." },

    { id: "deferred-noun", at: "sentence", p: /the (?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|other|others|last|rest|latter|former)(?: one| two| ones)? (?:is|are|was|were|does|do|did|has|have|had|will|can|could|would)(?:n'?t| not)?\.(?=\s|$)/i, why: "Pointer instead of a name, landing on a bare verb." },
    { id: "deferred-noun", p: /\bthere(?:'?s| is| was) (?:just|only) one (?:problem|catch|issue|wrinkle|snag)\b/i, why: "Withholds the noun for a beat." },
    { id: "deferred-noun", at: "sentence", p: /one (?:thing|detail|number|line|of them) (?:is|isn'?t|was|wasn'?t|stands? out|stood out|does|doesn'?t|did|didn'?t)\b/i, why: "\u201COne thing\u2026\u201D \u2014 name it." },

    { id: "aphoristic-closer", p: /\bthe (?:kind|sort|type) of [\w-]+(?: [\w-]+)? that [^.!?\n]{2,60}\b(?:and|but) (?:is|was|does|did|are|were)(?:n'?t| not)\.(?=\s|$)/i, why: "\u201CThe kind of X that looks like Y and is not.\u201D" },
    { id: "aphoristic-closer", p: /\b(?:and|but) (?:is|was|does|did|are|were|has|have|can|could|will|would)(?:n'?t| not)\.(?=\s|$)/i, why: "Sentence landing on a bare auxiliary \u2014 say what the second half claims." },
    { id: "aphoristic-closer", p: /(?:\b(?:is|was|are|were)|'s) the (?:whole|entire) (?:point|game|thing|trick|pitch|idea|story|premise|argument)\b/i, why: "Claims a total where a part was shown." },
    { id: "aphoristic-closer", p: /\bthe (?:whole|entire) (?:point|game|trick|pitch|premise|argument) (?:is|was)\b/i, why: "Claims a total where a part was shown." },

    { id: "strawman-knockdown", p: /\b(?:is|was|seems|sounds|looks like|feels like) the (?:obvious|natural|tempting|intuitive|easy|common|usual|standard|default|naive|na\u00EFve|first|simple|lazy) (?:reading|answer|explanation|assumption|interpretation|conclusion|story|take|guess|response|move|fix|read|diagnosis|instinct)\b[^.!?\n]{0,40}?\b(?:and|but) (?:it|that)(?:'?s| is| was) (?:wrong|not|incomplete|a mistake|false|backwards)\b/i, why: "Supplies a wrong reading to knock down." },
    { id: "strawman-knockdown", p: /\bit(?:'?s| is| would be) (?:tempting|easy|natural) to (?:think|conclude|assume|believe|blame|dismiss)\b/i, why: "Sets up a position to reject." },
    { id: "strawman-knockdown", p: /\byou(?: might|'d| would| may) (?:think|assume|expect) [^.!?\n]{2,80}[.,;]\s*(?:but|not so|wrong|it (?:is|does)n'?t|it'?s not|that'?s (?:wrong|not))\b/i, why: "Sets up a position to reject." },
    { id: "strawman-knockdown", p: /\bcontrary to (?:popular|common) (?:belief|wisdom|opinion)\b/i, why: "Unnamed opponents." },
    { id: "strawman-knockdown", p: /\b(?:the )?conventional wisdom (?:says|holds|is)\b/i, why: "Unnamed opponents." },
    { id: "strawman-knockdown", p: /\bthat'?s not quite right\b/i, why: "Self-correcting opener \u2014 the error was supplied." },

    { id: "dressed-metaphor", p: /\b(?:wearing|wears|wore|dressed in) (?:the|a|an|its|their) (?:costume|clothes|clothing|mask|disguise|skin) of\b/i, why: "Costume metaphor \u2014 name the mechanism." },
    { id: "dressed-metaphor", p: /\bin a trench ?coat\b/i, why: "Costume metaphor \u2014 name the mechanism." },
    { id: "dressed-metaphor", p: /\b(?:masquerad(?:es?|ing|ed) as|dressed up as|disguised as|in disguise|cosplay(?:s|ing|ed)? as|with extra steps)\b/i, why: "Costume metaphor \u2014 name the mechanism." },
    { id: "dressed-metaphor", p: /\bload[- ]bearing\b(?! (?:walls?|beams?|columns?|structures?|members?|capacity|frames?|masonry))/i, why: "Structural metaphor \u2014 say what depends on it." },
    { id: "dressed-metaphor", p: /\bthe (?:seam|hinge|fault[- ]line|joint) where\b/i, why: "Structural-metaphor locator." },

    { id: "label-first", at: "sentence", p: /(?:one|two|three|a few|a couple of) (?:quick |small |important |final |more |other )?(?:notes?|caveats?|things?|wrinkles?|points?|asides?|details?|catch|observations?|flags?)(?: (?:worth|to) \w+(?: \w+)?| before \w+(?: \w+)?| up front)?:/i, why: "Counted label announcing the content it precedes." },

    { id: "inflated-verb", p: /\bserves? as\b/i, why: "\u2192 just say \u201Cis\u201D." },
    { id: "inflated-verb", p: /\bstands? as\b/i, why: "\u2192 just say \u201Cis\u201D." },
    { id: "inflated-verb", p: /\bboasts?\b/i, why: "\u2192 \u201Chas\u201D." },

    { id: "landscape-cliche", p: /\bnavigat(?:e|ing) (?:the|this|these|today's) (?:complex(?:ity|ities)?|challeng(?:e|es|ing)|evolving|landscape)\b/i, why: "\u201CNavigating the X landscape\u201D clich\u00E9." },
    ...[
      ["delve", "Top AI tell."], ["tapestry", "AI metaphor noun."], ["foster(?:s|ing|ed)?", "AI vocabulary."],
      ["leverag(?:e|es|ing|ed)", "\u2192 \u201Cuse\u201D."], ["utiliz(?:e|es|ing|ed)", "\u2192 \u201Cuse\u201D."],
      ["facilitat(?:e|es|ing|ed)", "\u2192 \u201Chelp\u201D."], ["empower(?:s|ing|ed)?", "AI vocabulary."],
      ["streamlin(?:e|es|ing|ed)", "AI vocabulary."], ["robust", "AI vocabulary."],
      ["cutting-edge", "Hype word."], ["game-?changer", "Hype word."], ["groundbreaking", "Promotional word."],
      ["seamless(?:ly)?", "Marketing filler."], ["transformative", "Hype word."], ["paradigm shift", "Hype phrase."],
      ["realm of", "AI vocabulary."], ["beacon", "AI vocabulary."], ["multifaceted", "AI vocabulary."],
      ["meticulous(?:ly)?", "AI vocabulary."], ["intricate", "AI vocabulary."], ["paramount", "AI vocabulary."],
      ["elevat(?:e|es|ing)", "Marketing filler."], ["embark(?:s|ing|ed)?", "AI vocabulary."],
      ["supercharge(?:s|d)?", "Hype word."], ["harness(?:es|ing|ed)? (?:the|its|their|your|our)", "AI metaphor verb."],
      ["ever-evolving", "AI vocabulary."], ["crucial(?:ly)?", "AI vocabulary."], ["enduring", "AI vocabulary."],
      ["enhanc(?:e|es|ing|ed)", "AI vocabulary."], ["garner(?:s|ed|ing)?", "AI vocabulary."],
      ["interplay", "AI vocabulary."], ["pivotal", "AI vocabulary."], ["showcas(?:e|es|ing|ed)", "AI vocabulary."],
      ["testament", "AI vocabulary."], ["underscor(?:e|es|ing|ed)", "AI vocabulary."],
      ["nestled", "Promotional word."], ["breathtaking", "Promotional word."], ["renowned", "Promotional word."],
      ["stunning", "Promotional word."], ["must-visit", "Promotional word."],
      ["dive (?:deep(?:er)? )?into", "AI-favored verb."],
      ["genuinely", "Intensifier as self-grade."], ["myriad", "AI vocabulary."], ["plethora", "AI vocabulary."],
    ].map(([wordPattern, explanation]) => ({
      id: "ai-vocabulary",
      p: new RegExp("\\b" + wordPattern + "\\b", "i"),
      why: explanation,
    })),
  ];

  const rules = [
    {
      id: "catalog",
      run(text, { source = text } = {}) {
        const out = [];
        for (const { id: ruleId, at, p: pattern, why: explanation } of PATTERN_CATALOG) {
          const spans = at === "sentence"
            ? findAtSentenceStarts(text, pattern)
            : findAll(text, pattern, (match) => ({ start: match.index, end: match.index + match[0].length }));
          /* A replacement ("\u2192 \u201Cuse\u201D") reads on from the quote; an explanation needs the dash. */
          const joiner = explanation.startsWith("\u2192") ? " " : " \u2014 ";
          for (const span of spans) {
            out.push({ ...span, ruleId, message: `"${source.slice(span.start, span.end)}"${joiner}${explanation}` });
          }
        }
        return out;
      },
    },
    {
      id: "binary-contrast",
      run(text) {
        const found = (regex, message) => findAll(text, regex, (m) => ({ start: m.index, end: m.index + m[0].length, message }));
        const out = [
          ...found(
            /\b(?:(?:it's|this is|that's|they're|is) )?not (?:(?:just|merely|simply) [^.!?\n]{2,60}?(?:[,;\u2014-] ?it's|[,;\u2014-]? ?but(?: also| rather)?)|only [^.!?\n]{2,60}?[,;\u2014-] ?it's)\b/gi,
            "\u201CNot just X, but Y\u201D \u2014 signature AI cadence. State Y directly."
          ),
          /* Both halves have to be the same kind of phrase. "It isn't starting. It's really cold." is two facts. */
          ...found(
            /\b(?:this |that |the \w+ )?(?:isn'?t|is not|wasn'?t|was not) (?:(?:just|really|only|simply|merely|mostly) )?(?:(?:a|an|the|about|because|what|how|why|where|who|your|our|my|their|more|less) [^.!?\n]{1,50}?|[\w-]+)[.,;][^\S\n]*\n?[^\S\n]*(?:it's|(?:it|that) (?:is|was)) (?:(?:a|an|the|about|because|what|how|why|where|who|your|our|my|their|more|less)\b|[\w-]+[.!](?=\s|$))/gi,
            "Binary contrast (\u201CIt isn't X. It's Y.\u201D) \u2014 state Y directly."
          ),
          ...found(
            /\bnot an? [^.!?\n]{2,40}\.[^\S\n]*\n?[^\S\n]*not an?\b/gi,
            "Negative listing (\u201CNot a X. Not a Y. A Z.\u201D) \u2014 just say Z."
          ),
          ...found(
            /\bnot because [^.!?\n]{2,80}?[,;\u2014-]\s*(?:but )?because\b/gi,
            "\u201CNot because X, because Y\u201D \u2014 give the reason directly."
          ),
          ...found(
            /\b(?:doesn'?t|does not|didn'?t|did not) (?:just|merely|simply) [^.!?\n]{2,60}?[,;.\u2014-][^\S\n]*\n?[^\S\n]*(?:it|they|he|she)\b/gi,
            "\u201CDoesn't just X, it Y\u201D \u2014 state Y directly."
          ),
        ];
        /* "If it isn't plugged in, it's not going to work" is a condition and its result, not a contrast. */
        const CONDITIONAL = /\b(?:if|when|whenever|unless|because|since|while|until)\b[^.!?\n]*$/i;
        return out
          .filter((f) => !CONDITIONAL.test(text.slice(Math.max(0, f.start - 120), f.start)))
          .map((f) => ({ ...f, ruleId: "binary-contrast" }));
      },
    },
    {
      id: "ing-explainer",
      run(text) {
        return findAll(
          text,
          /,\s+(?:highlighting|underscoring|showcasing|fostering|emphasizing|demonstrating|cementing|symbolizing|cultivating|encompassing|solidifying|underlining|illustrating)\b(?:[^.!?\n]{0,60}(?=[\s.,;:!?)\]]|$)|[^.!?\n]{0,60}\b)/gi,
          (m) => ({
            start: m.index, end: m.index + m[0].length,
            ruleId: "ing-explainer",
            message: "Trailing \u201C-ing\u201D clause pretending to explain meaning \u2014 delete or replace with a concrete fact.",
          })
        );
      },
    },
    {
      id: "fragment-cadence",
      run(text) {
        const make = (start, end, message) => ({ start, end, ruleId: "fragment-cadence", message });
        const out = findAll(
          text,
          /\b(one|no|every|each|zero|same)\s[^,.!?\n]{1,30},\s+\1\s[^,.!?\n]{1,30},\s+(?:and\s+)?\1\s[^,.!?\n]{1,30}/gi,
          (m) => make(m.index, m.index + m[0].length, "List drummed out on one repeated word \u2014 write it as a sentence.")
        );

        const spans = sentenceSpans(text);
        const COUNT = /^(?:One|Two|Three|Four|Five|Six|Seven|Eight|Nine|Ten|Eleven|Twelve) [a-z][\w-]*(?: [a-z][\w-]*)?\.$/;
        for (let i = 0; i + 1 < spans.length; i++) {
          const span = spans[i];
          const sameLine = span.paragraph === spans[i + 1].paragraph;
          const answersQuestion = i > 0 && spans[i - 1].text.endsWith("?");
          if (sameLine && !answersQuestion && COUNT.test(span.text)) {
            out.push(make(span.start, span.end, "Count announced as its own sentence \u2014 fold it into the sentence it introduces."));
          }
        }

        const ABBREVIATION = /^(?:mr|mrs|ms|dr|prof|vs|etc|inc|ltd|no|st|jr|sr|fig|eg|ie|approx|dept|est)\.$/i;
        const isFragment = (span) => {
          const tokens = words(span.text);
          /* Three-word sentences include changelog lines such as "Add ARM support." */
          return tokens.length <= 2
            && /^[A-Z]/.test(span.text)
            && /[a-z]{3}/i.test(span.text)
            && /[^.!?]\.$/.test(span.text)
            && !ABBREVIATION.test(span.text.replace(/\.(?=.)/g, ""));
        };
        for (const run of sentenceRuns(spans, (a, b) => isFragment(a) && isFragment(b))) {
          if (run.length >= 3) {
            out.push(make(run[0].start, run[run.length - 1].end, "Run of clipped fragments \u2014 write it as one sentence."));
          }
        }

        /* Changelogs and step lists repeat a verb on purpose; the tic repeats a subject. */
        const OPENERS = new Set(["it", "this", "that", "these", "those", "they", "we", "you", "i", "he", "she", "there", "no", "every", "each", "the", "a"]);
        const opening = (span) => {
          const tokens = words(span.text.toLowerCase().replace(/[^\p{L}\p{N}'\u2019\s-]/gu, ""));
          return tokens.length >= 3 && OPENERS.has(tokens[0]) ? tokens.slice(0, 2).join(" ") : "";
        };
        for (const run of sentenceRuns(spans, (a, b) => opening(a) !== "" && opening(a) === opening(b))) {
          if (run.length >= 3) {
            out.push(make(run[0].start, run[run.length - 1].end, `${run.length} sentences in a row open on \u201C${opening(run[0])}\u201D \u2014 parallelism carried by repetition.`));
          }
        }
        return out;
      },
    },
    {
      id: "coy-header",
      run(text, options) {
        const headings = [];
        if (options.heading) {
          const lead = text.length - text.trimStart().length;
          headings.push({ start: lead, title: text.trim() });
        } else {
          headings.push(...findAll(text, /^[ \t]{0,3}#{1,6}[ \t]+(\S(?:.*\S)?)[ \t]*$/gm, (m) => ({
            start: m.index + m[0].indexOf(m[1]),
            title: withoutClosingHashes(m[1]),
          })));
        }

        const COY = /^(?:what|why|how|where)\b(?:(?:\s+\S+){0,2}\s+["\u201C][^"\u201D]+["\u201D]|\s+(?:this|that|these|those|actually|really)\b|.*\b(?:means|matters|looks like|went wrong)$)/i;
        const CONVENTIONAL = /^how (?:it|this|that) works$/i;
        const THESIS = /^(?:the|a|an) (?:one|only|real|actual|single|true|hidden|quiet|surprising|uncomfortable)\b.*\bthat\b|^(?:the|a|an) .+ that (?:does|doesn'?t|did|didn'?t|is|isn'?t|was|wasn'?t|actually|really|matters)\b/i;

        const out = [];
        for (const { start, title } of headings) {
          const plain = title.replace(/[*_`]/g, "").trim();
          if (plain.endsWith("?") || words(plain).length < 3) continue;
          let message = null;
          if (COY.test(plain) && !CONVENTIONAL.test(plain)) message = "Coy header \u2014 it could top several different sections. Name the content.";
          else if (words(plain).length >= 4 && THESIS.test(plain)) message = "Thesis-shaped header \u2014 it states a verdict instead of labelling the section.";
          if (message) out.push({ start, end: start + title.length, ruleId: "coy-header", message });
        }
        return out;
      },
    },
    {
      id: "label-first",
      run(text, options) {
        const CONVENTIONAL = /^(?:note|notes|warning|tip|important|caution|todo|example|examples|update|edit|tl;dr|ps|nb|usage|default|returns|parameters|type|required|optional|deprecated|input|output|q|a|kind|author|authors|license|version|since|see|source|status|date)$/i;
        const make = (start, end) => ({
          start, end, ruleId: "label-first",
          message: "Bold label in front of the content it names \u2014 an outline showing through the prose.",
        });
        /* A one-word label is usually a real index: a term, an option, a field name. */
        const isLabel = (label) => /^[A-Z]/.test(label) && words(label).length >= 2 && words(label).length <= 6 && !CONVENTIONAL.test(label);

        const out = [];
        for (const m of text.matchAll(/^[ \t]*(?:(?:[-*+\u2022]|\d+[.)])[ \t]+)?(\*\*|__)([A-Za-z][A-Za-z '\u2019\/&-]{1,44}?)(?:[:.]\1|\1[ \t]*[:\u2014\u2013])[ \t]+\S/gm)) {
          if (!isLabel(m[2])) continue;
          const start = m.index + m[0].indexOf(m[1]);
          out.push(make(start, m.index + m[0].length - 1));
        }

        /* The scanner reports where a block's leading bold run ends, since flattened page text carries no markup. */
        const boldLead = options.boldLead ?? 0;
        if (boldLead > 0 && boldLead < text.length) {
          const lead = text.slice(0, boldLead);
          const rest = text.slice(boldLead);
          const label = lead.trim().replace(/[:.]$/, "");
          const delimited = /[:.]\s*$/.test(lead) || /^\s*[:\u2014\u2013]\s/.test(rest);
          if (delimited && isLabel(label) && words(rest).length >= 3) {
            const start = lead.length - lead.trimStart().length;
            out.push(make(start, start + lead.trim().length));
          }
        }

        return out;
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
          ...d, ruleId: "em-dash-density",
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
        if (hedges.length < 2 || (hedges.length / w) * 100 < 3) return [];
        return hedges.map((h) => ({
          ...h, ruleId: "hedging-ratio",
          message: "Heavy hedging \u2014 models soften every claim.",
        }));
      },
    },
    {
      id: "triad-adjectives",
      run(text) {
        return findAll(
          text,
          /\b[a-z]+(?:ive|ful|ous|able|ible|ant|ent|al|ic|less),\s+[a-z]+(?:ive|ful|ous|able|ible|ant|ent|al|ic|less),\s+and\s+[a-z]+(?:ive|ful|ous|able|ible|ant|ent|al|ic|less)\b/g,
          (m) => ({
            start: m.index, end: m.index + m[0].length,
            ruleId: "triad-adjectives",
            message: "Rule-of-three adjective triad \u2014 use the natural number of items.",
          })
        );
      },
    },
    {
      id: "uniform-sentences",
      run(text) {
        /* Four sentences of similar length are common in careful human prose; the signal needs a longer run. */
        const ss = sentenceSpans(text);
        if (ss.length < 5) return [];
        const lens = ss.map((s) => words(s.text).length);
        const mean = lens.reduce((a, b) => a + b, 0) / lens.length;
        if (mean < 8) return [];
        const sd = Math.sqrt(lens.reduce((a, b) => a + (b - mean) ** 2, 0) / lens.length);
        if (sd / mean > 0.15) return [];
        return [{
          start: 0, end: 0, ruleId: "uniform-sentences",
          message: `Sentences are eerily uniform (${lens.join(", ")} words each). Humans vary rhythm more.`,
        }];
      },
    },
    {
      id: "emoji-bullets",
      run(text) {
        const hits = findAll(text, /^[ \t]*\p{Extended_Pictographic}[\uFE0F\u200D\p{EMod}\p{Extended_Pictographic}]*[ \t]+(?=\S)/gmu, (m) => ({
          start: m.index, end: m.index + m[0].length,
        }));
        if (hits.length < 2) return [];
        return hits.map((h) => ({
          ...h, ruleId: "emoji-bullets",
          message: "Emoji used as list bullets \u2014 a strong AI formatting tell.",
        }));
      },
    },
  ];

  /* Two patterns of one rule can describe the same words; the wider span is the finding. */
  function dropNested(sorted) {
    const reach = new Map();
    return sorted.filter((finding) => {
      if (finding.end <= finding.start) return true;
      if (finding.end <= (reach.get(finding.ruleId) ?? -1)) return false;
      reach.set(finding.ruleId, finding.end);
      return true;
    });
  }

  function analyze(source, options = {}) {
    /* Typographic apostrophes and no-break spaces are one character each, so offsets stay valid. */
    /* A URL is an address, not prose. It becomes a same-length run of slashes, which keeps every offset,
       still counts as one word, and leaves a URL alone on a wrapped line from reading as a blank line.
       Punctuation after it still ends the sentence. */
    const text = source
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/\u00A0/g, " ")
      .replace(/\b(?:https?:\/\/|www\.)[^\s<>"'`)\]\u201C\u201D\u00AB\u00BB]+/gi, (url) => {
        /* Trailing punctuation and emphasis markers belong to the sentence, not the address. */
        const address = url.replace(/[.,;:!?*_]+$/, "");
        return "/".repeat(address.length) + url.slice(address.length);
      });
    const collected = [];
    /* Rules match against the masked text; messages quote the original, so a URL never shows as slashes. */
    for (const rule of rules) collected.push(...rule.run(text, { ...options, source }));
    for (const finding of collected) Object.assign(finding, RULES[finding.ruleId]);
    collected.sort((a, b) => a.start - b.start || b.end - a.end);
    const findings = dropNested(collected);

    const wc = words(text).length;
    let points = 0;
    for (const f of findings) points += f.severity === MAJOR ? 12 : 5;
    /* Findings in a long text are weaker evidence than the same findings in a short one, but they still
       add up, so the discount grows with the square root of the length instead of the length itself. */
    const score = Math.min(100, Math.round(points * 1.4 * Math.sqrt(60 / Math.max(wc, 60))));

    let verdict, label;
    if (score >= 50) { verdict = "slop"; label = "CERTIFIED SLOP"; }
    else if (score >= 20) { verdict = "suspicious"; label = "SUSPICIOUS"; }
    else { verdict = "human"; label = "READS HUMAN"; }

    return { score, verdict, label, findings, wordCount: wc };
  }

  for (const { id } of PATTERN_CATALOG) {
    if (!RULES[id]) throw new Error(`Pattern catalog names an unregistered rule: ${id}`);
  }

  const api = { analyze, rules: RULES };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  globalThis.SlopEngine = api;
})();
