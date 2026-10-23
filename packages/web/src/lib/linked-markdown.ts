import { marked, type Token, type Tokens } from "marked";
import type { LinkedText } from "@rainbot/db/world-links";

// Recap prose rendered as a tree instead of an HTML string, so names in it can
// become PageLink components with hover cards. Only the inline formatting a
// recap uses is kept as a tree; any other block falls back to marked's HTML.
export type Inline =
  | { type: "text"; segments: LinkedText }
  | { type: "strong" | "em" | "del"; children: Inline[] }
  | { type: "code"; text: string }
  | { type: "link"; href: string; children: Inline[] }
  | { type: "br" };

export type Block = { type: "paragraph"; children: Inline[] } | { type: "html"; html: string };

// Links text pieces in reading order, or leaves them plain when null.
type Linker = ((text: string) => LinkedText) | null;

function inline(tokens: Token[], link: Linker): Inline[] {
  return tokens.flatMap((token): Inline[] => {
    switch (token.type) {
      case "text": {
        const text = token as Tokens.Text;
        return text.tokens?.length
          ? inline(text.tokens, link)
          : [{ type: "text", segments: link ? link(text.text) : [{ text: text.text }] }];
      }
      case "escape":
        return [{ type: "text", segments: [{ text: (token as Tokens.Escape).text }] }];
      case "strong":
      case "em":
      case "del":
        return [
          {
            type: token.type,
            children: inline((token as Tokens.Strong).tokens, link),
          },
        ];
      case "codespan":
        return [{ type: "code", text: (token as Tokens.Codespan).text }];
      case "br":
        return [{ type: "br" }];
      case "link": {
        const anchor = token as Tokens.Link;
        // Model-written markdown: keep only ordinary web and in-app links, and
        // never nest a page link inside one.
        if (!/^(https?:\/\/|\/|#|\?)/i.test(anchor.href)) {
          return inline(anchor.tokens, link);
        }
        return [{ type: "link", href: anchor.href, children: inline(anchor.tokens, null) }];
      }
      default:
        return [{ type: "text", segments: [{ text: token.raw }] }];
    }
  });
}

export function linkMarkdown(markdown: string, link: Linker): Block[] {
  return marked.lexer(markdown).flatMap((token): Block[] => {
    if (token.type === "space") return [];
    if (token.type === "paragraph") {
      return [
        {
          type: "paragraph",
          children: inline((token as Tokens.Paragraph).tokens, link),
        },
      ];
    }
    return [{ type: "html", html: marked.parser([token]) }];
  });
}
