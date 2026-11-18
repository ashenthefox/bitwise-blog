// Reading a page's markers the way the tooling does. Every template carries commented-out examples of
// `<meta name="bh:example">`, `bh:unlisted` and `bh:image`, and `npm run new` copies them into each new
// page, so a regex over the raw file text also matches the comment. `check` and the index read the page
// with comments stripped (`stripComments`, scripts/html-tree.mts); a test that needs a marker uses these.
import { stripComments } from "../../scripts/html-tree.mts";

/** The content of the first `<meta name="…" content="…">` that is not inside a comment, or "". */
export const metaOf = (html: string, name: string): string =>
  (stripComments(html).match(new RegExp(`<meta name="${name}" content="([^"]*)"`)) || [])[1] || "";
