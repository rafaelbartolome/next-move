import MarkdownIt from "markdown-it";

// `html: false` escapes any raw HTML in the source (it renders as text), so user- or
// agent-authored markdown can't inject markup. `linkify` turns bare URLs into links;
// `breaks` treats a single newline as a line break.
const md = new MarkdownIt({ html: false, linkify: true, breaks: true });

function renderMarkdown(text: string): string {
  return md.render(text);
}

// Tailwind's preflight strips the browser's default list bullets and heading sizes, so
// injected markdown needs its own scoped styles. Everything is scoped under `.nm-md`;
// translucent overlays and currentColor keep it working in light and dark mode.
const STYLES = `
.nm-md h1, .nm-md h2, .nm-md h3, .nm-md h4, .nm-md h5, .nm-md h6 { font-weight: 600; line-height: 1.25; margin: 0.9em 0 0.4em; }
.nm-md h1 { font-size: 1.3em; }
.nm-md h2 { font-size: 1.2em; }
.nm-md h3 { font-size: 1.1em; }
.nm-md h4, .nm-md h5, .nm-md h6 { font-size: 1em; }
.nm-md p { margin: 0.4em 0; }
.nm-md ul, .nm-md ol { padding-left: 1.4em; margin: 0.5em 0; }
.nm-md ul { list-style: disc; }
.nm-md ol { list-style: decimal; }
.nm-md li { margin: 0.2em 0; }
.nm-md li > ul, .nm-md li > ol { margin: 0.1em 0; }
.nm-md blockquote { border-left: 3px solid rgba(127, 127, 127, 0.4); padding-left: 0.75em; margin: 0.5em 0; opacity: 0.85; }
.nm-md code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.9em; background: rgba(127, 127, 127, 0.15); padding: 0.1em 0.3em; border-radius: 0.25em; }
.nm-md pre { background: rgba(127, 127, 127, 0.12); padding: 0.6em 0.8em; border-radius: 0.4em; overflow-x: auto; margin: 0.5em 0; }
.nm-md pre code { background: none; padding: 0; font-size: 0.85em; }
.nm-md a { text-decoration: underline; }
.nm-md hr { border: 0; border-top: 1px solid rgba(127, 127, 127, 0.3); margin: 1em 0; }
`;

export function Markdown({ text }: { text: string }) {
  return (
    <div>
      <style>{STYLES}</style>
      <div class="nm-md" dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }} />
    </div>
  );
}
