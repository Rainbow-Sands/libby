import { marked, type Token, type Tokens } from "marked";
import { linkPageNames, type LinkTarget, type LinkedText } from "@rainbot/db/world-links";

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

function inline(tokens: Token[], targets: LinkTarget[], linked: Set<string>): Inline[] {
  return tokens.flatMap((token): Inline[] => {
    switch (token.type) {
      case "text": {
        const text = token as Tokens.Text;
        return text.tokens?.length
          ? inline(text.tokens, targets, linked)
          : [{ type: "text", segments: linkPageNames(text.text, targets, linked) }];
      }
      case "escape":
        return [{ type: "text", segments: [{ text: (token as Tokens.Escape).text }] }];
      case "strong":
      case "em":
      case "del":
        return [
          {
            type: token.type,
            children: inline((token as Tokens.Strong).tokens, targets, linked),
          },
        ];
      case "codespan":
        return [{ type: "code", text: (token as Tokens.Codespan).text }];
      case "br":
        return [{ type: "br" }];
      case "link": {
        const link = token as Tokens.Link;
        // Model-written markdown: keep only ordinary web and in-app links, and
        // never nest a page link inside one.
        if (!/^(https?:\/\/|\/|#|\?)/i.test(link.href)) {
          return inline(link.tokens, targets, linked);
        }
        return [{ type: "link", href: link.href, children: inline(link.tokens, [], linked) }];
      }
      default:
        return [{ type: "text", segments: [{ text: token.raw }] }];
    }
  });
}

export function linkMarkdown(
  markdown: string,
  targets: LinkTarget[],
  linked: Set<string> = new Set(),
): Block[] {
  return marked.lexer(markdown).flatMap((token): Block[] => {
    if (token.type === "space") return [];
    if (token.type === "paragraph") {
      return [
        {
          type: "paragraph",
          children: inline((token as Tokens.Paragraph).tokens, targets, linked),
        },
      ];
    }
    return [{ type: "html", html: marked.parser([token]) }];
  });
}
