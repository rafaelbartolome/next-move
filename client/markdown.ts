import MarkdownIt from "markdown-it";

// `html: false` escapes any raw HTML in the source (it renders as text), so user- or
// agent-authored markdown can't inject markup. `linkify` turns bare URLs into links;
// `breaks` treats a single newline as a line break.
const md = new MarkdownIt({ html: false, linkify: true, breaks: true });

/** Renders a markdown string to safe HTML. The output contains only markdown-it tags. */
export function renderMarkdown(text: string): string {
  return md.render(text);
}
