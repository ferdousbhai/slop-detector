# Rules

Every rule has one default level. Major rules are errors and minor rules are
warnings; `.slopdetector.json` can set any rule to `"off"`, `"warn"`, or
`"error"`. The engine in `extension/engine.js` holds the patterns, and the test
suite fails if this table and the engine disagree.

| Rule | Level | Flags | Example |
|---|---|---|---|
| `abstraction-agency` | warning | An abstraction or a chart given a mind, or a clipped sentence with one as the actor | "Median hides it." |
| `ai-vocabulary` | warning | Single words that models overuse | "delve", "robust", "seamless" |
| `aphoristic-closer` | warning | A sentence built to be quoted, often landing on a bare auxiliary | "…looks like evidence and is not." |
| `binary-contrast` | error | A negation staged so the real claim can follow it | "It is not a tool. It is a movement." |
| `chatbot-phrase` | error | Assistant openers, closers, and disclaimers | "I'd be happy to", "Hope this helps" |
| `colon-reveal` | error | A label and a colon in front of a withheld point | "The catch: it never ran." |
| `coy-header` | warning | A heading that hints at its section or states a verdict | "What "exhausted" means" |
| `deferred-noun` | warning | A pointer where the name belongs | "The sixth is not." |
| `dramatic-fragment` | error | Fragment pairs played for effect | "That's it. That's the whole thing." |
| `dressed-metaphor` | warning | A costume or structural metaphor in place of the mechanism | "wearing the costume of a style fix" |
| `em-dash-density` | warning | 2.5 or more em dashes per 100 words | |
| `emoji-bullets` | error | Two or more lines in one block that open with an emoji | "🚀 Launch the site" |
| `essay-connective` | error | Formal transitions that rarely appear in conversation | "Moreover", "Furthermore" |
| `faux-insight` | error | A claim to know what others miss | "What most people get wrong" |
| `filler-phrase` | warning | Phrases with a shorter equivalent | "in order to", "at this point in time" |
| `fragment-cadence` | warning | Runs of clipped fragments, counts as sentences, lists drummed on one word | "Six legs. One GPU, one sampler, one question set." |
| `hedging-ratio` | warning | Two or more hedges at 3 or more per 100 words, in 20 words or more | "perhaps", "arguably", "typically" |
| `inflated-verb` | warning | A grand verb where "is" or "has" would do | "serves as", "boasts" |
| `ing-explainer` | error | A trailing "-ing" clause that asserts significance | ", highlighting the team's commitment" |
| `label-first` | warning | A bold label of two to six words, or a counted announcement, ahead of its content | "**Fast startup:** …", "Two things:" |
| `landscape-cliche` | error | "Navigating the … landscape" | "navigating the evolving landscape" |
| `puffery` | error | Stock claims of importance | "marks a pivotal moment" |
| `recap-ending` | error | A summary of what the reader just read | "In conclusion", "Ultimately," |
| `rhetorical-setup` | error | A question or tease the writer answers at once | "The result? Chaos." |
| `significance-designation` | warning | Telling the reader which part matters | "It is the leg that answers the actual question." |
| `strawman-knockdown` | error | A wrong reading supplied so it can be rejected | "…is the obvious reading, and it is wrong." |
| `throat-clearing` | error | Openers that delay the point or announce sincerity | "Here's the thing", "Let's be honest" |
| `triad-adjectives` | warning | Three adjectives in a row | "innovative, scalable, and dynamic" |
| `uniform-sentences` | warning | Five or more sentences of nearly equal length | |
| `vague-attribution` | error | A claim attributed to nobody | "Experts believe", "Studies show" |

## Where each rule can see

Some rules need context that plain text does not carry.

- `coy-header` reads Markdown `#` headings on its own. In the browser the
  scanner marks `<h1>` to `<h6>` blocks as headings, and the HTML linter does
  the same for heading tags. The HTML linter ends a block at any tag that is not
  inline, so a phrase may cross a link or emphasis.
- `label-first` reads Markdown `**bold**` on its own. In the browser the scanner
  reports a bold run that opens a block. The HTML linter does not.
- `emoji-bullets` compares lines inside one block. The browser sees each list
  item as its own block, so there it catches emoji lines split by line breaks
  and misses emoji that open separate list items.

URLs are never read as prose, in the browser or the linter.

The repository linter reads comments and string literals in source files. It
skips Markdown inline code, fenced and indented code blocks, link targets, and
`<textarea>` contents, and it treats a file with no extension as prose only
when it has a document name such as `README` or `CHANGELOG`.

## Minimum length

The browser skips blocks shorter than 15 words, or 3 words for a heading. Pages
are full of menus, buttons, and captions, and a short label gives a pattern
rule nothing to judge. The repository linter checks any segment of two or more
words, because a file passed to it was chosen for checking.
