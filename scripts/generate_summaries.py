#!/usr/bin/env python3
"""
Generate AI summaries for protocol steps using Claude.

Usage:
  python3 scripts/generate_summaries.py <protocol_id> [--overwrite]

Examples:
  python3 scripts/generate_summaries.py blue_006_blue_007_blue_008
  python3 scripts/generate_summaries.py gold_001_gold_002_gold_003 --overwrite

Summaries are saved directly into the protocol's JSON file as:
  step.summary = { "label": "...", "detail": "..." }

Steps that already have a summary are skipped unless --overwrite is passed.
"""

import sys, json, re, os, argparse
import anthropic

DATA_DIR = os.path.join(os.path.dirname(__file__), '..', 'public', 'data', 'protocols')
COLORS = ['red','gold','green','grey','brown','orange','purple','lavender','pink','yellow','blue']

SYSTEM_PROMPT = """You are a concise clinical medical writing assistant helping EMS clinicians.
You summarize individual protocol steps for display on a mobile device.

For each step you output exactly two fields as JSON:
- "label": 2-5 words. The core action. No punctuation at the end. Examples:
    "Request ALS", "DuoNeb Nebulizer", "Epinephrine IM", "Dexamethasone",
    "Cardiac Monitor", "Magnesium Sulfate", "CPAP — Severe Bronchospasm"
- "detail": 1-3 lines of plain text (no HTML). Prioritize:
    • For medication steps: drug · dose · route · interval/repeat. Adult and pediatric on separate lines if both present.
    • For decision/conditional steps: the key clinical trigger and action.
    • For procedural steps: the essential technique or threshold.
    • Omit detail entirely (null) if the label already says everything.

Use × for "times" (×2, ×3), → for "then", / for "per", ≤ ≥ for comparisons.
Keep doses exact. Use abbreviations: IM, IV, IO, PO, NEB, SL, IN, SQ, ET.
Format weight-based doses as: 0.6 mg/kg (max 16 mg).
Max line length ~60 chars."""

def strip_html(h):
    h = re.sub(r'<[^>]+>', ' ', h)
    h = re.sub(r'&amp;', '&', h)
    h = re.sub(r'&lt;', '<', h)
    h = re.sub(r'&gt;', '>', h)
    h = re.sub(r'&nbsp;', ' ', h)
    h = re.sub(r'<img[^>]*>', '', h)
    h = re.sub(r'<[^>]*>', '', h)
    h = re.sub(r'\s+', ' ', h)
    return h.strip()

def find_protocol(protocol_id):
    for color in COLORS:
        path = os.path.join(DATA_DIR, f'{color}.json')
        if not os.path.exists(path): continue
        with open(path) as f:
            data = json.load(f)
        for p in data:
            if p['id'] == protocol_id:
                return color, path, data, p
    return None, None, None, None

def generate_summary(client, protocol_title, provider_level, step_num, step_text):
    level_label = provider_level.replace('_', ' / ').title()
    user_msg = f"""Protocol: {protocol_title}
Provider level: {level_label}
Step {step_num}:

{step_text}

Respond with only valid JSON on a single line, e.g.:
{{"label": "DuoNeb Nebulizer", "detail": "Ipratropium 0.5mg + Albuterol 2.5mg NEB\\nAge >1yr. Repeat q5min ×2"}}
or if detail is not needed:
{{"label": "Cardiac Monitor", "detail": null}}"""

    response = client.messages.create(
        model='claude-sonnet-4-6',
        max_tokens=200,
        system=SYSTEM_PROMPT,
        messages=[{'role': 'user', 'content': user_msg}]
    )
    raw = response.content[0].text.strip()
    # Extract JSON even if there's surrounding text
    match = re.search(r'\{.*\}', raw, re.DOTALL)
    if not match:
        raise ValueError(f"No JSON found in response: {raw}")
    obj = json.loads(match.group())
    label = obj.get('label', '').strip()
    detail = obj.get('detail')
    if detail:
        detail = detail.strip()
    return {'label': label, 'detail': detail} if detail else {'label': label}

def main():
    parser = argparse.ArgumentParser(description='Generate AI summaries for protocol steps')
    parser.add_argument('protocol_id', help='Protocol ID, e.g. blue_006_blue_007_blue_008')
    parser.add_argument('--overwrite', action='store_true', help='Overwrite existing summaries')
    args = parser.parse_args()

    color, path, data, protocol = find_protocol(args.protocol_id)
    if not protocol:
        print(f"Protocol '{args.protocol_id}' not found.")
        sys.exit(1)

    print(f"Protocol: {protocol['title']} ({len(protocol['steps'])} steps)")

    api_key = os.environ.get('ANTHROPIC_API_KEY')
    if not api_key:
        print("Error: ANTHROPIC_API_KEY environment variable not set.")
        sys.exit(1)

    client = anthropic.Anthropic(api_key=api_key)

    changed = 0
    for i, step in enumerate(protocol['steps']):
        if step.get('summary') and not args.overwrite:
            print(f"  Step {step['num']} [{step['providerLevel']}] — skipped (already has summary)")
            continue

        text = strip_html(step['html'])
        if not text.strip():
            continue

        print(f"  Step {step['num']} [{step['providerLevel']}] — generating...", end=' ', flush=True)
        try:
            summary = generate_summary(
                client,
                protocol['title'],
                step['providerLevel'],
                step['num'],
                text
            )
            step['summary'] = summary
            changed += 1
            label = summary['label']
            detail_preview = (summary.get('detail') or '')[:50]
            print(f"✓  \"{label}\" — {detail_preview}")
        except Exception as e:
            print(f"✗  Error: {e}")

    if changed > 0:
        # Write back to file
        for j, p in enumerate(data):
            if p['id'] == args.protocol_id:
                data[j] = protocol
                break
        with open(path, 'w') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        print(f"\nSaved {changed} summaries to {path}")
    else:
        print("\nNo changes made.")

if __name__ == '__main__':
    main()
