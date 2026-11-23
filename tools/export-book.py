#!/usr/bin/env python3
"""export-book: write book/cegarplay.md, the single Markdown source of the e-reader booklet.

    python3 tools/export-book.py            write book/cegarplay.md
    python3 tools/export-book.py --check    exit 1 when book/cegarplay.md differs from a fresh export
    python3 tools/export-book.py --stdout   print the export
    python3 tools/export-book.py --lint     list the places that break the writing rules below

The book is generated: never edit book/cegarplay.md by hand. Where the book must differ from the
web pages, the HTML says so with two marker classes:

    class="web-only"    the element is left out of the book
    class="book-only"   the element is hidden on the web (CSS) and kept in the book

Sources, in order: Part I (the guide): guide/index.html, the chapters of guide/chapters.js in
order, then guide/glossary.html and guide/bibliography.html. Part II (the playground): one chapter
per lesson (h2) of tutorial.html. Pages of the guide that are not in the book (the how-tos, the
reading order, the instructors' notes) and the manual are not linked: their links become text.

Fenced-div classes used in the output (each is the web class name of the element):
    lead, theory, pitfall, predict, exercise, answers, answer, recap, paper, tool-moment,
    listing-source, side-note
Code-block classes: asp, loop, lua, text, {.asp .changed} / {.loop .changed} (before/after
listings), {.graph delete=".." clique=".." caption=".."} (graph figures, data in the one
{.graph-data} block), {.diagram caption=".."} (the inline SVG diagrams, as they are).
Inline: [Playground: example-id]{.play} for playground links and Load buttons.
"""
import html
import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "book" / "cegarplay.md"
VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"}
DIV_CLASSES = ["lead", "theory", "pitfall", "recap", "paper", "tool-moment", "listing-source", "side-note"]


# ---- a small DOM --------------------------------------------------------------------------
class Node:
    def __init__(self, tag, attrs, parent=None):
        self.tag, self.attrs, self.parent, self.kids = tag, dict(attrs), parent, []
        self.start = self.end = None

    def cls(self):
        return (self.attrs.get("class") or "").split()

    def has(self, c):
        return c in self.cls()

    def text(self):
        return "".join(k if isinstance(k, str) else k.text() for k in self.kids)

    def find_all(self, pred):
        out = []
        for k in self.kids:
            if isinstance(k, Node):
                if pred(k):
                    out.append(k)
                out.extend(k.find_all(pred))
        return out


class Parser(HTMLParser):
    def __init__(self, src):
        super().__init__(convert_charrefs=True)
        self.root = Node("#root", {})
        self.cur = self.root

    def handle_starttag(self, tag, attrs):
        n = Node(tag, attrs, self.cur)
        self.cur.kids.append(n)
        if tag not in VOID:
            self.cur = n

    def handle_startendtag(self, tag, attrs):
        n = Node(tag, attrs, self.cur)
        self.cur.kids.append(n)

    def handle_endtag(self, tag):
        e = self.cur
        while e is not self.root and e.tag != tag:
            e = e.parent
        if e is self.root:
            return
        self.cur = e.parent

    def handle_data(self, data):
        self.cur.kids.append(data)


def parse(src):
    p = Parser(src)
    p.feed(src)
    p.close()
    return p.root


# ---- text ---------------------------------------------------------------------------------
ESC = re.compile(r"([\\`*_\[\]<>~^@$|])")


def esc(t):
    return ESC.sub(r"\\\1", t)


def squash(t):
    return re.sub(r"\s+", " ", t)


class Book:
    def __init__(self):
        self.pages = []           # [(file key, chapter id, title, root node)]
        self.ids = {}             # (file key, anchor) -> book id
        self.chapter_of = {}      # file key -> chapter id
        self.targets = set()      # book ids that some link points to
        self.svgs = {}            # file key -> [svg source]

    # file keys: "guide/<file>.html" or "tutorial"
    def resolve(self, page, href):
        """The book id an href points to, or None (then the link becomes text)."""
        if href.startswith(("http://", "https://", "mailto:")):
            return None
        if page == "tutorial" and href.startswith("#"):
            return self.ids.get(("tutorial", href[1:]))
        m = re.match(r"^(?:\.\./)?\?tab=2#(tut-[a-z0-9-]+)$", href) or re.match(r"^guide/\.\./\?tab=2#(tut-[a-z0-9-]+)$", href)
        if m:
            return self.ids.get(("tutorial", m.group(1)))
        if page.startswith("guide/"):
            if href.startswith("#"):
                return self.ids.get((page, href[1:]))
            m = re.match(r"^([a-z0-9-]+\.html)(?:#([a-z0-9-]+))?$", href)
            if m:
                key = "guide/" + m.group(1)
                if key not in self.chapter_of:
                    return None
                return self.ids.get((key, m.group(2))) if m.group(2) else self.chapter_of[key]
        if page == "tutorial":
            m = re.match(r"^guide/([a-z0-9-]+\.html)(?:#([a-z0-9-]+))?$", href)
            if m:
                key = "guide/" + m.group(1)
                if key not in self.chapter_of:
                    return None
                return self.ids.get((key, m.group(2))) if m.group(2) else self.chapter_of[key]
        return None


def web_only(n):
    return isinstance(n, Node) and n.has("web-only")


def plain(n):
    """The text of a node as the book has it (web-only parts left out)."""
    return "".join(k if isinstance(k, str) else ("" if web_only(k) or k.tag in ("script", "noscript") else plain(k)) for k in n.kids)


def play_span(n):
    ex = n.attrs.get("data-load-example")
    if not ex:
        m = re.search(r"[?&]example=([A-Za-z0-9_-]+)", n.attrs.get("href", ""))
        ex = m.group(1) if m else None
    return f"[Playground: {ex}]{{.play}}" if ex else ""


class Renderer:
    def __init__(self, book, page, cid):
        self.book, self.page, self.cid = book, page, cid
        self.answers = []          # [(answer id, back id, back label, markdown)]
        self.npredict = 0
        self.svg_i = 0

    def bid(self, anchor):
        return self.book.ids.get((self.page, anchor))

    def anchor(self, n):
        """An empty span anchor for an element that a link targets (not for headings)."""
        a = n.attrs.get("id")
        b = a and self.bid(a)
        return f"[]{{#{b}}}" if b and b in self.book.targets else ""

    # inline ------------------------------------------------------------------------------
    def inline(self, n):
        out = []
        for k in n.kids:
            if isinstance(k, str):
                out.append(esc(squash(k)))
                continue
            if web_only(k):
                continue
            t = k.tag
            if t in ("script", "noscript", "style"):
                continue
            if t == "a":
                if k.has("play"):
                    out.append(play_span(k))
                    continue
                inner = self.inline(k).strip()
                href = k.attrs.get("href", "")
                target = self.book.resolve(self.page, href)
                if target:
                    self.book.targets.add(target)
                    out.append(f"[{inner}](#{target})")
                elif href.startswith(("http://", "https://")) and squash(k.text()).strip() != href:
                    out.append(f"{inner} ({esc(href)})")
                else:
                    out.append(inner)
            elif t == "button":
                out.append(play_span(k) if k.attrs.get("data-load-example") else "")
            elif t == "code":
                code = squash(k.text())
                fence = "``" if "`" in code else "`"
                pad = " " if code.startswith("`") or code.endswith("`") else ""
                out.append(f"{fence}{pad}{code}{pad}{fence}")
            elif t in ("b", "strong"):
                inner = self.inline(k).strip()
                out.append(f"**{inner}**" if inner else "")
            elif t in ("i", "em"):
                inner = self.inline(k).strip()
                out.append(f"*{inner}*" if inner else "")
            elif t == "sub":
                out.append("~" + self.inline(k).strip().replace(" ", "\\ ") + "~")
            elif t == "sup":
                out.append("^" + self.inline(k).strip().replace(" ", "\\ ") + "^")
            elif t == "br":
                out.append(" ")
            elif t in ("del", "ins"):
                out.append(self.inline(k))
            elif k.has("aside-title"):
                continue
            else:
                out.append(self.inline(k))
        return "".join(out)

    def para(self, n):
        text = self.inline(n).strip()
        # a paragraph that starts like a list item or a heading must stay a paragraph
        text = re.sub(r"^(\d+)([.)])(\s)", r"\1\\\2\3", text)
        text = re.sub(r"^([-+#])(\s)", r"\\\1\2", text)
        return (self.anchor(n) + text).strip()

    # blocks ------------------------------------------------------------------------------
    def blocks(self, n, level):
        out = []
        for k in n.kids:
            if isinstance(k, str):
                if k.strip():
                    out.append(esc(squash(k)).strip())
                continue
            r = self.block(k, level)
            if r:
                out.append(r)
        return out

    def heading(self, n, level, extra=""):
        a = n.attrs.get("id")
        b = a and self.bid(a)
        attrs = f" {{#{b}{extra}}}" if b else (f" {{{extra.strip()}}}" if extra else "")
        return "#" * level + " " + self.inline(n).strip() + attrs

    def block(self, n, level):
        t = n.tag
        if web_only(n) or t in ("script", "noscript", "style", "nav", "header"):
            return ""
        if n.has("chapter-number") or n.has("aside-title"):
            return ""
        if t in ("h1",):
            return ""
        if t in ("h2", "h3", "h4", "h5"):
            return self.heading(n, min(6, level + int(t[1]) - 2))
        if t == "p":
            if n.has("lesson-load"):
                spans = [play_span(b) for b in n.find_all(lambda x: x.tag == "button")]
                return " ".join(s for s in spans if s)
            body = self.para(n)
            for c in ("lead", "listing-source", "side-note"):
                if n.has(c):
                    return f"::: {c}\n{body}\n:::" if body else ""
            return body
        if t == "pre":
            lang = n.attrs.get("data-lang") or ("text" if n.has("plain") else "text")
            code = html.unescape(n.text()).strip("\n")
            return f"```{lang}\n{code}\n```"
        if t == "div" and n.has("changed"):
            lang = n.attrs.get("data-lang", "text")
            lines = []
            for k in n.kids:
                if isinstance(k, Node):
                    txt = k.text().strip("\n")
                    pre = "- " if k.tag == "del" else "+ " if k.tag == "ins" else "  "
                    for line in txt.split("\n"):
                        lines.append(pre + line)
            return f"```{{.{lang} .changed}}\n" + "\n".join(lines) + "\n```"
        if t == "div" and n.has("example-code"):
            mode = n.attrs.get("data-mode", "text")
            lang = {"gringo": "asp", "loop": "loop", "lua": "lua"}.get(mode, mode)
            code = html.unescape(n.text()).strip("\n")
            return f"```{lang}\n{code}\n```"
        if t == "figure":
            return self.figure(n)
        if t in ("ul", "ol"):
            return self.listing(n, t == "ol")
        if t == "dl":
            return self.deflist(n)
        if t == "table":
            return self.table(n)
        if t == "details" and n.has("predict"):
            return self.predict(n)
        if t == "section" and n.has("exercise"):
            return self.exercise(n, level)
        if t in ("aside", "section", "div") and any(n.has(c) for c in DIV_CLASSES):
            c = next(c for c in DIV_CLASSES if n.has(c))
            inner = self.inner_blocks(n, level)
            title = next((k for k in n.kids if isinstance(k, Node) and k.has("aside-title")), None)
            head = f"**{self.inline(title).strip()}**\n\n" if title else ""
            return f"::: {c}\n{head}{inner}\n:::"
        if t in ("section", "div", "article", "main", "aside", "span", "blockquote"):
            return self.inner_blocks(n, level)
        if t in ("a", "b", "strong", "em", "i", "code"):
            return self.para_of_inline(n)
        if t == "button":
            return play_span(n)
        return self.inner_blocks(n, level)

    def para_of_inline(self, n):
        w = Node("#wrap", {})
        w.kids = [n]
        return self.inline(w).strip()

    def inner_blocks(self, n, level):
        anchor = self.anchor(n) if n.tag in ("section", "div", "aside") and not any(isinstance(k, Node) and k.tag in ("h2", "h3") for k in n.kids) else ""
        parts = self.blocks(n, level)
        body = "\n\n".join(p for p in parts if p)
        return (anchor + "\n\n" + body).strip() if anchor else body

    def listing(self, n, ordered, depth=0):
        lines = []
        i = 0
        for li in n.kids:
            if not isinstance(li, Node) or li.tag != "li" or web_only(li):
                continue
            i += 1
            mark = f"{i}." if ordered else "-"
            inline_part, sub = [], []
            for k in li.kids:
                if isinstance(k, Node) and k.tag in ("ul", "ol"):
                    sub.append(self.listing(k, k.tag == "ol", depth + 1))
                elif isinstance(k, Node) and k.tag in ("p", "pre", "div"):
                    sub.append(self.block(k, 3))
                else:
                    w = Node("#wrap", {})
                    w.kids = [k]
                    inline_part.append(self.inline(w))
            text = (self.anchor(li) + "".join(inline_part)).strip()
            pad = " " * (len(mark) + 1)
            lines.append(f"{mark} {text}")
            for s in sub:
                if s:
                    lines.append("")
                    lines.extend((pad + l) if l else "" for l in s.split("\n"))
        return "\n".join(lines)

    def deflist(self, n):
        out = []
        term = None
        for k in n.kids:
            if not isinstance(k, Node):
                continue
            if k.tag == "dt":
                term = (self.anchor(k) + self.inline(k)).strip()
            elif k.tag == "dd":
                out.append(f"{term}\n:   {self.inline(k).strip()}")
        return "\n\n".join(out)

    def table(self, n):
        rows = []
        for tr in n.find_all(lambda x: x.tag == "tr"):
            cells = [self.inline(c).strip().replace("|", "\\|") for c in tr.kids if isinstance(c, Node) and c.tag in ("td", "th")]
            nums = [c.has("num") for c in tr.kids if isinstance(c, Node) and c.tag in ("td", "th")]
            rows.append((cells, nums))
        if not rows:
            return ""
        width = max(len(r[0]) for r in rows)
        head, hnum = rows[0]
        head = head + [""] * (width - len(head))
        align = ["---:" if (k < len(hnum) and hnum[k]) else "---" for k in range(width)]
        out = ["| " + " | ".join(head) + " |", "|" + "|".join(align) + "|"]
        for cells, _ in rows[1:]:
            cells = cells + [""] * (width - len(cells))
            out.append("| " + " | ".join(cells) + " |")
        return "\n".join(out)

    def figure(self, n):
        cap_node = next((k for k in n.kids if isinstance(k, Node) and k.tag == "figcaption"), None)
        caption = squash(plain(cap_node)).strip() if cap_node else ""
        q = caption.replace('"', "'")
        if n.has("graph"):
            attrs = []
            if n.attrs.get("data-del"):
                attrs.append('delete="' + " ".join(x.strip() for x in n.attrs["data-del"].split(",")) + '"')
            if n.attrs.get("data-clique"):
                attrs.append('clique="' + " ".join(x.strip() for x in n.attrs["data-clique"].split(",")) + '"')
            alt = next((k for k in n.kids if isinstance(k, Node) and k.tag == "noscript"), None)
            body = squash(plain(alt)).strip() if alt else ""
            return "```{.graph" + "".join(" " + a for a in attrs) + f' caption="{q}"}}\n{body}\n```'
        svg = next((k for k in n.find_all(lambda x: x.tag == "svg")), None)
        if svg is not None and svg.has("diagram"):
            src = self.book.svgs[self.page][self.svg_i]
            self.svg_i += 1
            anchor = self.anchor(n)
            return (anchor + "\n\n" if anchor else "") + f'```{{.diagram caption="{q}"}}\n{src}\n```'
        return self.inner_blocks(n, 3)

    def predict(self, n):
        self.npredict += 1
        qid = f"{self.cid}-predict-{self.npredict}"
        summary = next(k for k in n.kids if isinstance(k, Node) and k.tag == "summary")
        rest = Node("#rest", {})
        rest.kids = [k for k in n.kids if k is not summary]
        answer = "\n\n".join(p for p in self.blocks(rest, 4) if p)
        self.answers.append((f"{qid}-answer", qid, "the question", answer))
        return f"::: {{.predict #{qid}}}\n{self.inline(summary).strip()} [Answer](#{qid}-answer)\n:::"

    def exercise(self, n, level):
        sid = self.bid(n.attrs.get("id", "")) or f"{self.cid}-{n.attrs.get('id')}"
        parts = []
        title = "Exercise"
        for k in n.kids:
            if isinstance(k, str) or web_only(k):
                continue
            if k.tag == "h2":
                title = self.inline(k).strip()
                parts.append(f"{'#' * level} {title} {{#{sid}}}")
            elif k.tag == "details" and k.has("solution"):
                aid = self.bid(k.attrs.get("id", "")) or f"{sid}-solution"
                rest = Node("#rest", {})
                rest.kids = [x for x in k.kids if not (isinstance(x, Node) and x.tag == "summary")]
                ans = "\n\n".join(p for p in self.blocks(rest, 4) if p)
                self.answers.append((aid, sid, title, ans))
                parts.append(f"[Solution](#{aid})")
            else:
                r = self.block(k, level)
                if r:
                    parts.append(r)
        return "::: exercise\n" + "\n\n".join(parts) + "\n:::"

    def answers_section(self, level):
        if not self.answers:
            return ""
        out = [f"{'#' * level} Answers {{#{self.cid}-answers .answers}}"]
        for aid, back, label, body in self.answers:
            out.append(f"::: {{.answer #{aid}}}\n[Back to {label}](#{back})\n\n{body}\n:::")
        return "\n\n".join(out)


# ---- the sources ----------------------------------------------------------------------------
def chapters():
    text = (ROOT / "guide" / "chapters.js").read_text(encoding="utf-8")
    block = text[text.index("export const CHAPTERS"):text.index("];", text.index("export const CHAPTERS"))]
    return [(m.group(1), m.group(2)) for m in re.finditer(r"file: '([^']+)', title: '((?:[^'\\]|\\.)*)'", block)]


def article(src):
    root = parse(src)
    arts = root.find_all(lambda x: x.tag == "article")
    return arts[0] if arts else root


def build():
    book = Book()
    guide = [("guide/index.html", "c00", "Introduction")]
    for i, (f, title) in enumerate(chapters(), 1):
        guide.append(("guide/" + f, f"c{i:02d}", title.replace("\\'", "'")))
    guide += [("guide/glossary.html", "glossary", "Glossary"), ("guide/bibliography.html", "bibliography", "Bibliography")]
    pages = []
    for key, cid, title in guide:
        src = (ROOT / key).read_text(encoding="utf-8")
        book.svgs[key] = re.findall(r'<svg class="diagram"[\s\S]*?</svg>', src)
        pages.append((key, cid, title, article(src)))
    # the tutorial: one chapter per h2 lesson
    tsrc = (ROOT / "tutorial.html").read_text(encoding="utf-8")
    troot = parse(tsrc)
    book.svgs["tutorial"] = []
    # the tutorial's own front matter (before the first lesson, or under a web-only h2) is left
    # out, except its book-only elements, which become the introduction of Part II
    lessons, cur = [], None
    preamble = Node("#preamble", {})
    for k in troot.kids:
        if isinstance(k, Node) and k.tag == "h2":
            if web_only(k):
                cur = None
                continue
            cur = Node("#lesson", {})
            cur.attrs["id"] = k.attrs.get("id")
            cur.heading = k
            lessons.append(cur)
            continue
        if cur is not None:
            cur.kids.append(k)
        elif isinstance(k, Node) and k.has("book-only"):
            preamble.kids.append(k)
    tpages = []
    for i, les in enumerate(lessons, 1):
        title = re.sub(r"^\d+\.\s*", "", squash(les.heading.text()).strip())
        tpages.append(("tutorial", f"t{i:02d}", title, les))
    # ids: chapter ids, then every element id with the chapter prefix
    for key, cid, title, root in pages:
        book.chapter_of[key] = cid
        for n in root.find_all(lambda x: "id" in x.attrs):
            book.ids[(key, n.attrs["id"])] = f"{cid}-{n.attrs['id']}"
    for key, cid, title, les in tpages:
        book.ids[("tutorial", les.attrs["id"])] = cid
        for n in les.find_all(lambda x: "id" in x.attrs):
            book.ids[("tutorial", n.attrs["id"])] = f"{cid}-{n.attrs['id']}"
    # two passes: the first collects the link targets, the second writes the anchors
    for _ in range(2):
        out = ["---", "title: Designing CEGAR loops", "subtitle: A course in counterexample-guided loops in ASP", "lang: en",
               "generator: tools/export-book.py (generated; do not edit)", "---", "",
               "# Part I: Designing CEGAR loops {#part-1}", ""]
        for key, cid, title, root in pages:
            r = Renderer(book, key, cid)
            out.append(f"## {title} {{#{cid}}}")
            out.append("")
            if cid == "c00":
                out.append(graph_data())
                out.append("")
            body = "\n\n".join(b for b in r.blocks(root, 3) if b)
            out.append(body)
            ans = r.answers_section(3)
            if ans:
                out.append("")
                out.append(ans)
            out.append("")
        out += ["# Part II: The playground {#part-2}", ""]
        pre = Renderer(book, "tutorial", "t00")
        out.append("\n\n".join(b for b in pre.blocks(preamble, 2) if b))
        out.append("")
        for key, cid, title, les in tpages:
            r = Renderer(book, key, cid)
            out.append(f"## {title} {{#{cid}}}")
            out.append("")
            # the tutorial's h3 are the sections of a lesson: ### (level 2 + 3 - 2)
            out.append("\n\n".join(b for b in r.blocks(les, 2) if b))
            ans = r.answers_section(3)
            if ans:
                out.append("")
                out.append(ans)
            out.append("")
        md = "\n".join(out)
    md = re.sub(r"\n{3,}", "\n\n", md).rstrip() + "\n"
    return md


def graph_data():
    js = (ROOT / "guide" / "guide.js").read_text(encoding="utf-8")
    m = re.search(r"export const GRAPH = \{\s*nodes: \{([\s\S]*?)\},\s*edges: \[([\s\S]*?)\],\s*\};", js)
    nodes = {int(a): [int(x), int(y)] for a, x, y in re.findall(r"(\d+): \[(\d+), (\d+)\]", m.group(1))}
    edges = [[int(a), int(b)] for a, b in re.findall(r"\[(\d+), (\d+)\]", m.group(2))]
    data = {"box": [100, 60], "nodes": {str(k): v for k, v in sorted(nodes.items())}, "edges": edges}
    return "The graph of the first four chapters, for the figures below (node coordinates in a 100 by 60 box, as `guide/guide.js` draws them):\n\n```{.graph-data}\n" + json.dumps(data) + "\n```"


# ---- the writing rules of the book (also checked by test/book.test.mjs) ----------------------
RULES = [
    (re.compile(r"\b(press(es|ed|ing)?|click(s|ed|ing)?|tick(s|ed)?|untick|drag)\b", re.I), "a UI action as an instruction"),
    (re.compile(r"(^|[.:;!?]\s+|^-\s+|^\d+\.\s+)(Run|Open|Load|Switch|Go back|Turn on) (it|them|the|a|an|this|that|any|two|its|your|both|one)\b"), "an instruction to use the app"),
    (re.compile(r"\bbuttons?\b", re.I), "a button"),
    (re.compile(r"\b(green|red|orange|blue|yellow|purple|pink|grey|gray)\b", re.I), "colour carrying meaning"),
    (re.compile(r"\b(this tab|this page|top of this page|on this page)\b", re.I), "deixis that assumes the app"),
    (re.compile(r"(?<!\\)<[a-zA-Z/!]"), "raw HTML"),
    (re.compile(r"\]\((?!#)"), "a link that is not internal"),
]


def lint(md):
    problems = []
    anchors = set(re.findall(r"\{#([A-Za-z0-9_-]+)", md)) | set(re.findall(r"\{\.[a-z-]+ #([A-Za-z0-9_-]+)", md))
    fence = None
    for i, line in enumerate(md.split("\n"), 1):
        m = re.match(r"^(```+)", line)
        if m:
            if not fence:
                for cap in re.findall(r'caption="([^"]*)"', line):
                    for rx, what in RULES[:4]:
                        if rx.search(cap):
                            problems.append(f"line {i}: {what} (in a caption): {cap[:110]}")
            fence = None if fence else m.group(1)
            continue
        if fence or line.startswith(("title:", "subtitle:", "generator:")):
            continue
        text = re.sub(r"`[^`]*`", "", line)
        for rx, what in RULES:
            if rx.search(text):
                problems.append(f"line {i}: {what}: {line.strip()[:110]}")
        for target in re.findall(r"\]\(#([A-Za-z0-9_-]+)\)", line):
            if target not in anchors:
                problems.append(f"line {i}: the link #{target} lands on no anchor")
    return problems


def main(argv):
    md = build()
    if "--lint" in argv:
        ps = lint(md)
        for p in ps:
            print(p)
        return 1 if ps else 0
    if "--stdout" in argv:
        sys.stdout.write(md)
        return 0
    if "--check" in argv:
        old = OUT.read_text(encoding="utf-8") if OUT.exists() else ""
        if old != md:
            print(f"{OUT.relative_to(ROOT)} is out of date: run python3 tools/export-book.py", file=sys.stderr)
            return 1
        return 0
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(md, encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)} ({len(md.splitlines())} lines)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
