#!/usr/bin/env python3
"""
Import Declan's page-level markdown extraction (import-data/pages/*.json +
navigation.json) into this app's Protocol/TOC schema (public/data/*.json).

Source of truth for text: import-data/pages/*.json (markdown field).
Grouping: pages sharing the same topic_id become one Protocol, in pdf_page order.
"""
import json
import re
import glob
import os
import markdown as md_lib
from bs4 import BeautifulSoup

ROOT = os.path.dirname(os.path.abspath(__file__))
APP_ROOT = os.path.dirname(ROOT)
PAGES_DIR = os.path.join(ROOT, 'pages')
NAV_PATH = os.path.join(ROOT, 'navigation.json')
FIGURES_SRC = os.path.join(ROOT, 'figures')
FIGURES_DST = os.path.join(APP_ROOT, 'public', 'assets', 'figures')
PAGES_IMG_DST = os.path.join(APP_ROOT, 'public', 'assets', 'pages_webp')
DATA_DST = os.path.join(APP_ROOT, 'public', 'data')

CATEGORY_META = {
    'brown':    {'name': 'Foreword',                           'displayName': 'Brown - Foreword',                          'color': '#8B4513'},
    'purple':   {'name': 'Definitions',                         'displayName': 'Purple - Definitions',                      'color': '#800080'},
    'blue':     {'name': 'Airway and Respiratory',              'displayName': 'Blue - Airway and Respiratory',             'color': '#0066CC'},
    'red':      {'name': 'Cardiac',                             'displayName': 'Red - Cardiac',                             'color': '#DC143C'},
    'gold':     {'name': 'Medical',                             'displayName': 'Gold - Medical',                            'color': '#FFB800'},
    'green':    {'name': 'Trauma',                              'displayName': 'Green - Trauma',                            'color': '#00AA00'},
    'yellow':   {'name': 'Environmental and Toxicology',        'displayName': 'Yellow - Environmental and Toxicology',     'color': '#FFD700'},
    'pink':     {'name': 'Pediatrics',                          'displayName': 'Pink - Pediatrics',                         'color': '#FF69B4'},
    'lavender': {'name': 'Obstetrics and Newborn',              'displayName': 'Lavender - Obstetrics and Newborn',         'color': '#9966CC'},
    'orange':   {'name': 'Behavioral Health',                   'displayName': 'Orange - Behavioral Health',                'color': '#FF8800'},
    'grey':     {'name': 'Operations and Special Situations',   'displayName': 'Grey - Operations and Special Situations',  'color': '#808080'},
    'black':    {'name': 'Non-EMS System Medical Interveners',  'displayName': 'Black - Non-EMS System Medical Interveners','color': '#222222'},
    'od-green': {'name': 'Operational K9 Annex',                'displayName': 'OD Green - Operational K9 Annex',           'color': '#4B5320'},
}

PROVIDER_HEADING_LINE_RE = re.compile(r'^#{2,4}\s*(.+?)\s*$', re.MULTILINE)
_TOKEN_MAP = {
    'EMT': 'EMT',
    'AEMT': 'ADVANCED_EMT',
    'ADVANCED EMT': 'ADVANCED_EMT',
    'PARAMEDIC': 'PARAMEDIC',
}
_COMBO_MAP = {
    frozenset(['EMT']): 'EMT',
    frozenset(['ADVANCED_EMT']): 'ADVANCED_EMT',
    frozenset(['PARAMEDIC']): 'PARAMEDIC',
    frozenset(['EMT', 'ADVANCED_EMT']): 'EMT_ADVANCED_EMT',
    frozenset(['ADVANCED_EMT', 'PARAMEDIC']): 'ADVANCED_EMT_PARAMEDIC',
    frozenset(['EMT', 'ADVANCED_EMT', 'PARAMEDIC']): 'EMT_ADVANCED_EMT_PARAMEDIC',
}


def parse_provider_heading(text: str):
    """Return a ProviderLevel enum value if `text` is (only) a provider-level heading, else None."""
    cleaned = text.strip().rstrip(':').strip()
    if not cleaned or len(cleaned) > 40:
        return None
    tokens = re.split(r'\s*/\s*', cleaned)
    normalized = []
    for tok in tokens:
        key = tok.strip().upper()
        if key not in _TOKEN_MAP:
            return None
        normalized.append(_TOKEN_MAP[key])
    return _COMBO_MAP.get(frozenset(normalized))
BLOCKQUOTE_RUN_RE = re.compile(r'(?:^>.*\n?)+', re.MULTILINE)
ALERT_BLOCKQUOTE_RE = re.compile(r'^\**(CAUTION|WARNING|NOTE|IMPORTANT|ALERT|LEGEND)\b', re.IGNORECASE)
PEARLS_HEADING_RE = re.compile(r'^#{1,4}\s*PEARLS?\b(?:\s+for\s+(?P<title>.+?))?\s*$', re.IGNORECASE)
PEARLS_INLINE_RE = re.compile(
    r'^\**PEARLS?\b(?:\s+for\s+(?P<title>[^:*]+))?\s*\**\s*:?\s*\**\s*(?P<rest>.*)$', re.IGNORECASE
)
# A blockquote whose first line is *only* a short bold/heading label ending in ':' (e.g.
# "**\*Asthmatic patients:**", "### Pediatric Considerations:") — the source PDF renders these
# as the same gold callout box as a literal "PEARLS for X" section, just without the word PEARLS.
ASIDE_TITLE_RE = re.compile(r'^(?:#{1,4}\s*)?(?:\\?\*\s*){0,4}([A-Za-z][A-Za-z0-9 /\-]{2,40}):(?:\\?\*){0,4}\s*$')

MD_EXTENSIONS = ['tables', 'sane_lists', 'fenced_code']


_TOP_LIST_RE = re.compile(r'^(\d+\.|[*+-])\s')


def normalize_list_spacing(text: str) -> str:
    """Insert a blank line before a top-level (unindented) list run that directly follows
    non-list text with no separating blank line — Declan's markdown often has
    '**Label**\\n1. item' with no blank line, which python-markdown then reads as one
    paragraph instead of a list. Indented continuation lines are untouched."""
    lines = text.split('\n')
    out = []
    prev_blank = True
    prev_was_top_list = False
    for line in lines:
        is_top_list = bool(_TOP_LIST_RE.match(line))
        if is_top_list and not prev_blank and not prev_was_top_list:
            out.append('')
        out.append(line)
        prev_blank = (line.strip() == '')
        prev_was_top_list = is_top_list
    return '\n'.join(out)


_TOP_ITEM_RE = re.compile(r'^(\d+)\.\s+(.*)$')
_SUB_ITEM_RE = re.compile(r'^(\d+\.|[a-zA-Z]{1,4}\.|[*+-])\s+(.*)$')


def _md_inline(text: str) -> str:
    """Render inline markdown (bold/italic/links) for one list-item's text, without wrapping <p>."""
    html = md_lib.markdown(text.strip(), extensions=['fenced_code'])
    if html.startswith('<p>') and html.endswith('</p>'):
        html = html[3:-4]
    return html


def _parse_sub_items(lines):
    """lines: [(indent:int, raw_text_after_stripping_leading_space), ...] — the indented lines
    that follow a list item's own first line. Groups them into a nested tree by indent, using a
    stack keyed on indent value. Lines with no marker are treated as continuation text appended
    to the innermost currently-open item."""
    root = []
    stack = [(-1, root)]
    last_node = None
    for indent, raw in lines:
        m = _SUB_ITEM_RE.match(raw)
        if not m:
            if last_node is not None:
                last_node['text'] = (last_node['text'] + ' ' + raw).strip()
            continue
        marker, content = m.groups()
        node = {'text': content, 'children': [], 'marker': marker}
        while len(stack) > 1 and indent <= stack[-1][0]:
            stack.pop()
        stack[-1][1].append(node)
        stack.append((indent, node['children']))
        last_node = node
    return root


def _group_marker_type(nodes, parent_type):
    """Decide the <ol type=...> for a sibling group. Declan's protocols always nest
    decimal -> alpha (a, b, c) -> roman (i, ii, iii); a lettered group directly under
    another lettered (alpha) group is roman, otherwise it's alpha. Digit markers are
    always decimal (a further nested numbered sub-list, e.g. step 5's Adult/Pediatric)."""
    first_marker = nodes[0]['marker'].rstrip('.')
    if first_marker.isdigit():
        return None  # plain <ol>, no type attribute
    if first_marker in ('*', '+', '-'):
        return 'bullet'
    return 'i' if parent_type == 'a' else 'a'


def _render_nodes(nodes, parent_type=None):
    if not nodes:
        return ''
    group_type = _group_marker_type(nodes, parent_type)
    tag = 'ul' if group_type == 'bullet' else 'ol'
    type_attr = f' type="{group_type}"' if group_type not in (None, 'bullet') else ''
    items = []
    for node in nodes:
        inline = _md_inline(node['text'])
        children_html = _render_nodes(node['children'], group_type)
        items.append(f'<li>{inline}{children_html}</li>')
    return f'<{tag}{type_attr}>' + ''.join(items) + f'</{tag}>'


def _render_top_item(own_text: str, sub_lines):
    own_html = _md_inline(own_text)
    sub_html = _render_nodes(_parse_sub_items(sub_lines)) if sub_lines else ''
    return own_html + sub_html


def _extract_top_ordered_lists(text: str) -> str:
    """Find runs of top-level '1. 2. 3.' list items (possibly with indented lettered/roman/
    nested-decimal/bulleted sub-items) and replace each run with a fully-rendered raw <ol> HTML
    block, so python-markdown never has to guess at 'a.'/'i.' markers it doesn't understand."""
    lines = text.split('\n')
    out = []
    i, n = 0, len(lines)
    while i < n:
        m = _TOP_ITEM_RE.match(lines[i])
        if not m:
            out.append(lines[i])
            i += 1
            continue

        items = []  # list of (num, own_text, [(indent, raw), ...])
        while i < n:
            m = _TOP_ITEM_RE.match(lines[i])
            if m:
                items.append([int(m.group(1)), m.group(2), []])
                i += 1
                continue
            if lines[i].strip() == '':
                j = i + 1
                while j < n and lines[j].strip() == '':
                    j += 1
                nxt = lines[j] if j < n else ''
                if j < n and (_TOP_ITEM_RE.match(nxt) or nxt.startswith(' ') or nxt.startswith('\t')):
                    i += 1
                    continue
                break
            if lines[i].startswith(' ') or lines[i].startswith('\t'):
                indent = len(lines[i]) - len(lines[i].lstrip(' '))
                items[-1][2].append((indent, lines[i].strip()))
                i += 1
                continue
            break

        html_items = ''.join(
            f'<li>{_render_top_item(own_text, sub_lines)}</li>' for _, own_text, sub_lines in items
        )
        out.append('')
        out.append(f'<ol start="{items[0][0]}">{html_items}</ol>')
        out.append('')
    return '\n'.join(out)


def md_to_html(text: str) -> str:
    text = text.strip()
    if not text:
        return ''
    text = normalize_list_spacing(text)
    text = _extract_top_ordered_lists(text)
    return md_lib.markdown(text, extensions=MD_EXTENSIONS)


def rewrite_asset_paths(html: str) -> str:
    # figures referenced as ../../assets/figures/xxx.webp -> /assets/figures/xxx.webp
    return re.sub(r'(?:\.\./)*assets/figures/', '/assets/figures/', html)


def _classify_blockquote(first_line: str):
    """Decide whether a blockquote's first line marks it as a PEARLS-style gold callout box.
    Returns (title_or_None, leftover_text_from_first_line_or_None) if it is one, else None.
    Plain alert boxes (CAUTION/WARNING/...) and ordinary reference-text blockquotes (the
    majority — body prose the OCR pipeline happened to indent as a blockquote) return None
    and are left as regular content."""
    if ALERT_BLOCKQUOTE_RE.match(first_line):
        return None
    m = PEARLS_HEADING_RE.match(first_line)
    if m:
        return (m.group('title') or '').strip() or None, None
    m = PEARLS_INLINE_RE.match(first_line)
    if m:
        title = (m.group('title') or '').strip() or None
        return title, m.group('rest').strip() or None
    m = ASIDE_TITLE_RE.match(first_line)
    if m:
        return m.group(1).strip(), None
    return None


def extract_pearls(markdown_text: str, pearls_out: list):
    """Pull out PEARLS-style gold callout boxes (see _classify_blockquote), rendering each to
    HTML and appending {'title', 'html'} to `pearls_out` (shared across a whole protocol so
    indices stay unique). Each is replaced in-place with a <div data-pearls-idx="N"> placeholder
    so it keeps its original document position instead of moving to the end of the protocol —
    segment_to_intro_and_steps swaps the placeholder back out for a real 'pearls' intro item
    once the surrounding markdown has been rendered. Blockquotes that don't classify as a callout
    box (plain CAUTION notices, ordinary reference prose) are left untouched."""

    def _consume(m):
        lines = [re.sub(r'^>\s?', '', line) for line in m.group(0).splitlines()]
        first, rest_lines = lines[0], lines[1:]
        classified = _classify_blockquote(first.strip())
        if classified is None:
            return m.group(0)
        title, leftover = classified
        body_lines = ([leftover] if leftover else []) + rest_lines
        body_md = '\n'.join(body_lines).strip()
        if not body_md:
            return m.group(0)
        html = md_to_html(body_md)
        html = rewrite_asset_paths(html)
        idx = len(pearls_out)
        pearls_out.append({'title': title, 'html': html})
        return f'\n\n<div data-pearls-idx="{idx}"></div>\n\n'

    return BLOCKQUOTE_RUN_RE.sub(_consume, markdown_text)


def split_by_provider(markdown_text: str, carry_level: str = 'ALL'):
    """Split remaining markdown into [(providerLevel, segment_markdown), ...] using
    ### EMT / ADVANCED EMT / PARAMEDIC (and combined, e.g. EMT/ADVANCED EMT) headings.
    `carry_level` seeds any content that precedes the first heading (e.g. a page break
    mid-section, continuing the previous page's provider-level segment)."""
    matches = []
    for m in PROVIDER_HEADING_LINE_RE.finditer(markdown_text):
        level = parse_provider_heading(m.group(1))
        if level:
            matches.append((m.start(), m.end(), level))

    if not matches:
        return [(carry_level, markdown_text)]

    segments = []
    preamble = markdown_text[:matches[0][0]].strip()
    if preamble:
        segments.append((carry_level, preamble))

    for i, (_, end, level) in enumerate(matches):
        seg_end = matches[i + 1][0] if i + 1 < len(matches) else len(markdown_text)
        body = markdown_text[end:seg_end].strip()
        if body:
            segments.append((level, body))
    return segments


def segment_to_intro_and_steps(provider_level: str, segment_md: str, level_counters: dict, pearls_list: list):
    """Render one provider-level segment; split its top-level <ol> into ProtocolStep entries,
    everything else becomes ProtocolIntroItem entries, in original order.

    `level_counters` (mutated in place, keyed by providerLevel) makes step numbering
    monotonically increasing across the whole protocol: the first <ol> seen for a level
    seeds the counter from its markdown `start`; any later <ol> for that same level
    (e.g. a second decision-branch list on the same page) continues counting rather than
    restarting at 1 — the UI renders one flat <ol> per level and duplicate `num`s would
    collide as React keys.
    """
    html = md_to_html(segment_md)
    html = rewrite_asset_paths(html)
    soup = BeautifulSoup(html, 'html.parser')

    intro_items = []
    steps = []

    for el in list(soup.contents):
        tag = getattr(el, 'name', None)
        if tag == 'ol':
            if provider_level not in level_counters:
                start = el.get('start')
                level_counters[provider_level] = int(start) - 1 if start else 0
            for li in el.find_all('li', recursive=False):
                level_counters[provider_level] += 1
                inner = ''.join(str(c) for c in li.contents).strip()
                steps.append({
                    'num': level_counters[provider_level],
                    'providerLevel': provider_level,
                    'html': inner,
                })
        elif tag == 'table':
            intro_items.append({'type': 'table', 'providerLevel': provider_level, 'html': str(el)})
        elif tag in ('ul', 'ol'):
            intro_items.append({'type': 'list', 'providerLevel': provider_level, 'html': str(el)})
        elif tag == 'div' and el.get('data-pearls-idx') is not None:
            pearl = pearls_list[int(el['data-pearls-idx'])]
            intro_items.append({
                'type': 'pearls',
                'providerLevel': provider_level,
                'html': pearl['html'],
                'pearlsTitle': pearl['title'],
            })
        else:
            text = str(el).strip()
            plain = el.get_text(strip=True) if hasattr(el, 'get_text') else text
            if text and not re.fullmatch(r'\(?continued(?:\s+from\s+previous\s+page)?\)?\.?', plain, re.IGNORECASE):
                intro_items.append({'type': 'content', 'providerLevel': provider_level, 'html': text})

    return intro_items, steps


def slugify_id(chapter_id: str, page_nums: list):
    return '_'.join([chapter_id] + [f'{n:03d}' for n in page_nums])


def clean_title(raw_title: str, protocol_label: str):
    return raw_title.strip() if raw_title else protocol_label


def main():
    nav = json.load(open(NAV_PATH))
    chapter_by_id = {c['id']: c for c in nav['chapters']}

    page_files = sorted(glob.glob(os.path.join(PAGES_DIR, '*.json')))
    pages = []
    for f in page_files:
        d = json.load(open(f))
        if d.get('kind') != 'protocol' or not d.get('topic_id'):
            continue
        pages.append(d)
    pages.sort(key=lambda p: p['pdf_page'])

    groups = {}
    group_order = []
    for p in pages:
        tid = p['topic_id']
        if tid not in groups:
            groups[tid] = []
            group_order.append(tid)
        groups[tid].append(p)

    os.makedirs(FIGURES_DST, exist_ok=True)
    os.makedirs(os.path.join(DATA_DST, 'protocols'), exist_ok=True)

    protocols_by_category = {}
    toc_categories = []
    page_map = {}  # "Blue 9" -> protocol id
    total_protocols = 0
    total_pages = 0

    for chapter in nav['chapters']:
        cid = chapter['id']
        meta = CATEGORY_META.get(cid, {
            'name': chapter['name'], 'displayName': f"{chapter['color']} - {chapter['name']}", 'color': '#999999'
        })
        toc_protocols = []
        protocols_by_category[cid] = []

        for tid in chapter['topics']:
            group = groups.get(tid)
            if not group:
                continue

            page_nums = [p['pdf_page'] for p in group]
            protocol_id = slugify_id(cid, page_nums)
            title = clean_title(group[0]['title'], group[0]['protocol_label'])

            all_intro = []
            all_steps = []
            page_refs = []
            level_counters = {}
            pearls_list = []

            carry_level = 'ALL'
            for page_idx, page in enumerate(group):
                page_md = re.sub(r'^#\s+.*\n+', '', page['markdown'], count=1)
                page_md = re.sub(r'^\(continued\)\s*\n+', '', page_md, count=1, flags=re.IGNORECASE)
                remaining_md = extract_pearls(page_md, pearls_list)

                # Only carry the previous page's provider level into a continuation page
                # (one with no heading of its own) — the first page always starts at ALL.
                seed_level = carry_level if page_idx > 0 else 'ALL'
                segments = split_by_provider(remaining_md, seed_level)
                for level, seg_md in segments:
                    intro_items, steps = segment_to_intro_and_steps(level, seg_md, level_counters, pearls_list)
                    all_intro.extend(intro_items)
                    all_steps.extend(steps)
                if segments:
                    carry_level = segments[-1][0]

                page_id = f"{cid}_{page['pdf_page']:03d}"
                jpg_ref = f"/assets/pages_webp/{page['pdf_page']:04d}.webp"
                page_refs.append({
                    'pageId': page_id,
                    'htmlFile': '',
                    'jpgFile': jpg_ref,
                    'jpgPageNumber': page['pdf_page'],
                    'protocolPageNumber': page['protocol_label'],
                })
                page_map[page['protocol_label']] = protocol_id
                total_pages += 1

            protocol_obj = {
                'id': protocol_id,
                'title': title,
                'category': cid,
                'intro': all_intro,
                'steps': all_steps,
                'pearls': [],
                'pages': [
                    {'pageId': pr['pageId'], 'pageNumber': pr['protocolPageNumber'], 'jpgReference': pr['jpgFile']}
                    for pr in page_refs
                ],
            }
            protocols_by_category[cid].append(protocol_obj)
            toc_protocols.append({
                'id': protocol_id,
                'title': title,
                'pages': page_refs,
            })
            total_protocols += 1

        toc_categories.append({
            'id': cid,
            'name': meta['name'],
            'displayName': meta['displayName'],
            'color': meta['color'],
            'protocols': toc_protocols,
        })

    # Write per-category protocol files
    for cid, protos in protocols_by_category.items():
        if not protos:
            continue
        with open(os.path.join(DATA_DST, 'protocols', f'{cid}.json'), 'w') as f:
            json.dump(protos, f, indent=2)

    with open(os.path.join(DATA_DST, 'toc.json'), 'w') as f:
        json.dump({'categories': toc_categories}, f, indent=2)

    with open(os.path.join(DATA_DST, 'protocol-page-map.json'), 'w') as f:
        json.dump(page_map, f, indent=2)

    # Search index: matches src/types/protocol.ts SearchIndex
    search_index = []
    for cid, protos in protocols_by_category.items():
        for p in protos:
            texts = []
            levels = set()
            for item in p['intro']:
                if item.get('pearlsTitle'):
                    texts.append(item['pearlsTitle'])
                texts.append(BeautifulSoup(item['html'], 'html.parser').get_text(' ', strip=True))
                levels.add(item['providerLevel'])
            for step in p['steps']:
                texts.append(BeautifulSoup(step['html'], 'html.parser').get_text(' ', strip=True))
                levels.add(step['providerLevel'])
            content = ' '.join(t for t in texts if t)
            search_index.append({
                'id': p['id'],
                'category': cid,
                'title': p['title'],
                'content': content,
                'providerLevels': sorted(levels),
                'keywords': [],
            })
    with open(os.path.join(DATA_DST, 'search-index.json'), 'w') as f:
        json.dump(search_index, f, indent=2)

    with open(os.path.join(DATA_DST, 'metadata.json'), 'w') as f:
        json.dump({
            'buildDate': __import__('datetime').datetime.now().isoformat(),
            'version': '2.0.0-declan-import',
            'totalProtocols': total_protocols,
            'totalPages': total_pages,
            'categories': len(toc_categories),
        }, f, indent=2)

    print(f'Wrote {total_protocols} protocols across {len(toc_categories)} categories, {total_pages} pages.')


if __name__ == '__main__':
    main()
