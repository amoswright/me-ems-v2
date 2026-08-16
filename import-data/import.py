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
PEARLS_BLOCK_RE = re.compile(
    r'^>\s*#{2,3}\s*PEARLS(?:\s+for\s+(?P<title>.+?))?\s*$\n(?P<body>(?:^>.*$\n?)*)',
    re.MULTILINE
)

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


def md_to_html(text: str) -> str:
    text = text.strip()
    if not text:
        return ''
    text = normalize_list_spacing(text)
    return md_lib.markdown(text, extensions=MD_EXTENSIONS)


def rewrite_asset_paths(html: str) -> str:
    # figures referenced as ../../assets/figures/xxx.webp -> /assets/figures/xxx.webp
    return re.sub(r'(?:\.\./)*assets/figures/', '/assets/figures/', html)


def extract_pearls(markdown_text: str):
    """Pull out '> ### PEARLS for X' blockquote sections. Returns (remaining_markdown, pearls_list)."""
    pearls = []

    def _consume(m):
        title = (m.group('title') or '').strip() or None
        body_lines = m.group('body').splitlines()
        stripped = []
        for line in body_lines:
            line = re.sub(r'^>\s?', '', line)
            stripped.append(line)
        body_md = '\n'.join(stripped).strip()
        html = md_to_html(body_md)
        html = rewrite_asset_paths(html)
        # split into paragraph/list-level chunks for ProtocolPearl.html: string[]
        soup = BeautifulSoup(html, 'html.parser')
        chunks = [str(el) for el in soup.contents if str(el).strip()]
        pearls.append({'title': title, 'html': chunks if chunks else [html]})
        return ''

    remaining = PEARLS_BLOCK_RE.sub(_consume, markdown_text)
    return remaining, pearls


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


def segment_to_intro_and_steps(provider_level: str, segment_md: str, level_counters: dict):
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
            all_pearls = []
            page_refs = []
            level_counters = {}

            carry_level = 'ALL'
            for page_idx, page in enumerate(group):
                page_md = re.sub(r'^#\s+.*\n+', '', page['markdown'], count=1)
                page_md = re.sub(r'^\(continued\)\s*\n+', '', page_md, count=1, flags=re.IGNORECASE)
                remaining_md, pearls = extract_pearls(page_md)
                all_pearls.extend(pearls)

                # Only carry the previous page's provider level into a continuation page
                # (one with no heading of its own) — the first page always starts at ALL.
                seed_level = carry_level if page_idx > 0 else 'ALL'
                segments = split_by_provider(remaining_md, seed_level)
                for level, seg_md in segments:
                    intro_items, steps = segment_to_intro_and_steps(level, seg_md, level_counters)
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
                'pearls': [pe for pe in all_pearls if pe],
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
                texts.append(BeautifulSoup(item['html'], 'html.parser').get_text(' ', strip=True))
                levels.add(item['providerLevel'])
            for step in p['steps']:
                texts.append(BeautifulSoup(step['html'], 'html.parser').get_text(' ', strip=True))
                levels.add(step['providerLevel'])
            for pearl in p['pearls']:
                if pearl.get('title'):
                    texts.append(pearl['title'])
                for h in pearl['html']:
                    texts.append(BeautifulSoup(h, 'html.parser').get_text(' ', strip=True))
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
