#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Generate the GitHub documentation's theme-aware, dependency-free SVG system.

Embedded provider marks come from the pinned MIT-licensed Lobe Icons assets.
Run with --check to detect stale generated artwork without changing files.
"""

import argparse
import copy
import textwrap
from html import escape
from pathlib import Path
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs/assets/github"
NS = "http://www.w3.org/2000/svg"
ET.register_namespace("", NS)
PALETTES = {
    "dark": dict(bg="#0B111B", panel="#121D2B", raised="#182738", ink="#F0F5FC",
                 sub="#A4B6CA", line="#293B50", teal="#78E7D3", soft="#173E3C",
                 blue="#A8BEFF", edge="#607A99", faint="#1A293C", white="#FFFFFF"),
    "light": dict(bg="#F4F7FC", panel="#FFFFFF", raised="#E8EFF8", ink="#14253D",
                  sub="#526881", line="#D3DEEC", teal="#087467", soft="#DDF4EE",
                  blue="#465FC3", edge="#7187A3", faint="#DFE7F3", white="#FFFFFF"),
}


class Art:
    def __init__(self, width, height, theme, title, description):
        self.w, self.h, self.p = width, height, PALETTES[theme]
        self.parts = [f'<svg xmlns="{NS}" width="{width}" height="{height}" '
                      f'viewBox="0 0 {width} {height}" role="img" aria-labelledby="title desc">',
                      f'<title id="title">{escape(title)}</title><desc id="desc">{escape(description)}</desc>',
                      '<!-- Lobe Icons marks: MIT; see ../lobe/LICENSE and ../lobe/SOURCES.json. -->',
                      '<defs><pattern id="grid" width="28" height="28" patternUnits="userSpaceOnUse">'
                      f'<circle cx="1" cy="1" r="1" fill="{self.p["line"]}" opacity=".48"/>'
                      '</pattern><linearGradient id="wash" x1="0" y1="0" x2="1" y2="1">'
                      f'<stop stop-color="{self.p["teal"]}" stop-opacity=".12"/>'
                      f'<stop offset="1" stop-color="{self.p["blue"]}" stop-opacity=".02"/>'
                      '</linearGradient></defs>',
                      '<style>text{font-family:"Segoe UI",Arial,sans-serif} .mono{font-family:Consolas,monospace}</style>']
        self.rect(0, 0, width, height, self.p["bg"], radius=24)
        self.parts.append(f'<rect width="{width}" height="{height}" rx="24" fill="url(#grid)"/>')

    def rect(self, x, y, w, h, fill=None, stroke=None, radius=14):
        self.parts.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{radius}" '
                          f'fill="{fill or self.p["panel"]}"'
                          + (f' stroke="{stroke}"' if stroke else '') + '/>')

    def text(self, x, y, value, size=20, color=None, weight=400, spacing=None, anchor=None):
        attrs = f'x="{x}" y="{y}" font-size="{size}" font-weight="{weight}" fill="{color or self.p["ink"]}"'
        if spacing is not None:
            attrs += f' letter-spacing="{spacing}"'
        if anchor:
            attrs += f' text-anchor="{anchor}"'
        self.parts.append(f'<text {attrs}>{escape(value)}</text>')

    def lines(self, x, y, values, size=20, color=None, weight=400, leading=None):
        for index, value in enumerate(values):
            self.text(x, y + index * (leading or size * 1.4), value, size, color, weight)

    def line(self, points, color=None, width=2, dash=None):
        self.parts.append(f'<path d="{points}" fill="none" stroke="{color or self.p["line"]}" '
                          f'stroke-width="{width}" stroke-linecap="round" stroke-linejoin="round"'
                          + (f' stroke-dasharray="{dash}"' if dash else '') + '/>')

    def arrow(self, x1, y1, x2, y2, color=None):
        color = color or self.p["teal"]
        self.line(f'M{x1} {y1} L{x2} {y2}', color)
        if x1 == x2:
            self.line(f'M{x2-4} {y2-6} L{x2} {y2} L{x2+4} {y2-6}', color)
        else:
            self.line(f'M{x2-6} {y2-4} L{x2} {y2} L{x2-6} {y2+4}', color)

    def pill(self, x, y, value, active=False, size=13, width=None):
        w = width or (len(value) * size * .62 + 24)
        self.rect(x, y, w, 28, self.p["soft"] if active else self.p["raised"], radius=7)
        self.text(x + 12, y + 19, value, size, self.p["teal"] if active else self.p["sub"], 600)

    def logo(self, x, y, size=32, name="claude-color.svg"):
        node = copy.deepcopy(ET.fromstring((ROOT / "docs/assets/lobe" / name).read_text()))
        node.attrib.update(x=str(x), y=str(y), width=str(size), height=str(size))
        node.attrib.pop("style", None)
        self.parts.append(ET.tostring(node, encoding="unicode"))

    def finish(self):
        self.parts.append('</svg>')
        result = '\n'.join(self.parts) + '\n'
        ET.fromstring(result)
        return result


def hero(theme, mobile=False):
    w, h = (440, 538) if mobile else (1200, 430)
    a = Art(w, h, theme, "Agentic Software Factory", "One Headquarters, specialized labs, observable work. Public pre-alpha; Claude Code is the first planned runtime.")
    p = a.p
    a.rect(w * .57, 0, w * .43, h, 'url(#wash)', radius=24)
    x = 24 if mobile else 54
    a.text(x, 48 if mobile else 54, "SOFTWARE DEVELOPMENT, ORCHESTRATED", 12 if mobile else 14, p['sub'], 600, 2)
    a.lines(x, 116 if mobile else 143, ["Agentic Software", "Factory"], 40 if mobile else 70, weight=700, leading=72 if not mobile else 57)
    a.lines(x, 236 if mobile else 270, ["One Headquarters. Specialized labs.", "Work you can inspect."], 20 if mobile else 22, p['sub'], leading=32)
    if mobile:
        a.rect(24, 310, 392, 100, p['panel'], p['line'])
        for i, label in enumerate(['PLAN', 'BUILD', 'VERIFY']):
            xx = 36 + i * 128
            a.pill(xx, 346, label, i == 2, 14, 104)
            if i < 2:
                a.arrow(xx + 110, 360, xx + 121, 360, p['sub'])
        a.pill(24, 442, 'PUBLIC PRE-ALPHA', True, 14, 178)
        a.logo(24, 486, 25)
        a.text(60, 505, 'Claude Code · first planned runtime', 17, p['sub'])
    else:
        a.rect(744, 94, 402, 236, p['panel'], p['line'], 20)
        a.text(768, 127, 'FROM INTENT TO EVIDENCE', 12, p['sub'], 600, 1.5)
        a.rect(768, 150, 155, 62, p['raised'], radius=10)
        a.text(786, 177, '01 / PLAN', 12, p['sub'], 600)
        a.text(786, 199, 'Bound the work', 17, weight=600)
        a.arrow(930, 181, 955, 181)
        a.rect(964, 150, 158, 62, p['raised'], radius=10)
        a.text(982, 177, '02 / EXECUTE', 12, p['sub'], 600)
        a.text(982, 199, 'Coordinate labs', 17, weight=600)
        a.line('M1043 219 V237 H846 V250', p['teal'])
        a.rect(768, 250, 354, 57, p['soft'], radius=10)
        a.text(786, 275, '03 / VERIFY', 12, p['teal'], 600)
        a.text(786, 297, 'Evidence before delivery', 18, weight=600)
        a.logo(766, 354, 30)
        a.text(808, 374, 'Claude Code · first planned runtime', 17, p['sub'])
        a.pill(54, 356, 'PUBLIC PRE-ALPHA', True, 14, 183)
        a.text(253, 376, 'Architecture + repository foundation', 17, p['sub'])
    return a.finish()


LABS = [
    ('01', 'Research', 'Facts & reproductions'),
    ('02', 'Architecture', 'Decisions & contracts'),
    ('03', 'Production', 'Scoped implementation'),
    ('04', 'QA', 'Independent verification'),
    ('05', 'Security', 'Boundaries & findings'),
    ('06', 'Delivery', 'Exact action previews'),
    ('07', 'Operations', 'Health & recovery'),
]


def lab(a, x, y, w, number, title, detail, mobile=False):
    a.rect(x, y, w, 118 if mobile else 112, a.p['panel'], a.p['line'])
    a.text(x + 18, y + 25, number, 12, a.p['blue'], 600, 1)
    a.text(x + 18, y + 53, title, 21 if mobile else 24, weight=600)
    if mobile:
        a.lines(x+18, y+80, textwrap.wrap(detail, width=18), 18, a.p['sub'], leading=21)
    else:
        a.text(x + 18, y + 79, detail, 17, a.p['sub'])


def architecture(theme, mobile=False):
    a = Art(440 if mobile else 1200, 1380 if mobile else 900, theme,
            'Factory architecture — proposed runtime',
            'You talk to Headquarters. A coordinator owns task state, authority and evidence; the web Headquarters follows its events. Seven specialist labs execute bounded work. External actions require a separate exact approval. The runtime is not implemented.')
    p = a.p
    a.text(20 if mobile else 48, 40 if mobile else 48, 'FACTORY ARCHITECTURE / PROPOSED RUNTIME', 11 if mobile else 14, p['teal'], 600, 1 if mobile else 1.5)
    if mobile:
        a.lines(20, 82, ['One interface.', 'Many specialists.'], 30, weight=600, leading=36)
    else:
        a.text(48, 102, 'One interface. Many specialists.', 40, weight=600)
    if mobile:
        a.rect(20, 150, 400, 132, p['panel'], p['line'])
        a.text(40, 180, 'YOU → HEADQUARTERS', 12, p['teal'], 600, 1)
        a.text(40, 214, 'Intent, plans & decisions', 24, weight=600)
        a.logo(40, 236, 25)
        a.text(76, 255, 'Claude Code · planned adapter', 16, p['sub'])
        a.arrow(220, 288, 220, 316)
        a.rect(20, 322, 400, 130, p['panel'], p['line'])
        a.text(40, 354, 'DURABLE COORDINATOR', 12, p['teal'], 600, 1)
        a.text(40, 390, 'State + policy + evidence', 24, weight=600)
        a.text(40, 424, 'Tasks · leases · approvals · event history', 16, p['sub'])
        a.arrow(220, 458, 220, 486)
        a.rect(20, 492, 400, 114, p['soft'], p['line'])
        a.text(40, 523, 'WEB HEADQUARTERS', 12, p['teal'], 600, 1)
        a.text(40, 557, 'Live graph, traces & replay', 24, weight=600)
        a.text(40, 584, 'One event projection across every view', 16, p['sub'])
        a.line('M20 390 H10 V664 H220 V1224', p['edge'])
        a.text(20, 646, 'SPECIALIST LABS / TASKS & FINDINGS', 11, p['sub'], 600, .8)
        for i, (number, title, detail) in enumerate(LABS):
            row, col = divmod(i, 2)
            x, y = 20 + col * 210, 680 + row * 134
            a.line(f'M220 {y+58} H{210 if col==0 else 230}', p['edge'])
            lab(a, x, y, 190, number, title, detail, True)
        a.line('M325 1066 V1264', p['teal'])
        a.rect(20, 1270, 400, 84, p['soft'])
        a.text(40, 1297, 'YOUR EXACT APPROVAL', 16, p['teal'], 600, 1)
        a.lines(40, 1323, ['Push · PR · external message', 'Deployment'], 18, weight=600, leading=23)
    else:
        a.text(48, 136, 'A shared control plane connects intent, specialist work, and visible evidence.', 20, p['sub'])
        for x in (64, 444, 824):
            a.rect(x, 190, 312, 164, p['panel'], p['line'], 16)
        a.text(86, 222, 'YOU → HEADQUARTERS', 13, p['teal'], 600, 1)
        a.text(86, 259, 'Intent & decisions', 27, weight=600)
        a.logo(86, 282, 29)
        a.text(125, 302, 'Claude Code · planned', 17, p['sub'])
        a.text(86, 330, 'One operator-facing entry point', 16, p['sub'])
        a.text(466, 222, 'DURABLE COORDINATOR', 13, p['teal'], 600, 1)
        a.text(466, 259, 'State + policy', 27, weight=600)
        a.lines(466, 300, ['Plans, tasks, leases & approvals', 'Evidence and event history'], 17, p['sub'], leading=28)
        a.text(846, 222, 'WEB HEADQUARTERS', 13, p['teal'], 600, 1)
        a.text(846, 259, 'Live observability', 27, weight=600)
        a.lines(846, 300, ['Graph, traces & communications', 'Inspect, reconnect, replay'], 17, p['sub'], leading=28)
        a.arrow(382, 270, 438, 270)
        a.text(410, 253, 'scope', 12, p['sub'], anchor='middle')
        a.arrow(762, 270, 818, 270)
        a.text(790, 253, 'events', 12, p['sub'], anchor='middle')
        a.text(64, 404, 'SPECIALIST LABS / ACTIVATED FOR THE TASK', 13, p['sub'], 600, 1.5)
        a.line('M600 354 V590 M190 434 H1010 M326 590 H874', p['edge'])
        for x in (190, 464, 738, 1012):
            a.arrow(x, 434, x, 456, p['edge'])
        for x in (326, 600, 874):
            a.arrow(x, 590, x, 600, p['edge'])
        for i, values in enumerate(LABS):
            x, y = (64 + i * 274, 462) if i < 4 else (201 + (i-4) * 274, 606)
            lab(a, x, y, 250, *values)
        a.arrow(600, 723, 600, 753)
        a.rect(64, 760, 1072, 80, p['soft'], radius=14)
        a.text(86, 792, 'DELIVERY IS A SEPARATE DECISION', 13, p['teal'], 600, 1)
        a.text(86, 821, 'Your exact approval', 26, weight=600)
        a.text(525, 808, 'Push  /  PR  /  External message  /  Deployment', 22, p['ink'], 500)
        a.text(64, 874, 'Isolated workspaces · bounded parallelism · linked evidence · remote workers', 17, p['sub'])
    return a.finish()


def principles(theme, mobile=False):
    a = Art(440 if mobile else 1200, 578 if mobile else 242, theme, 'Factory operating principles',
            'The proposed factory supports concurrent missions, evidence-bound results, and explicit authority for external actions.')
    cards = [('01', 'Parallel work.', 'Separate authority.', ['Multiple missions, scoped workspaces,', 'shared limits and conflict leases.']),
             ('02', 'Evidence first.', 'Every result linked.', ['Checks bind to the source snapshot.', 'Missing evidence blocks promotion.']),
             ('03', 'Visible boundaries.', 'Deliberate delivery.', ['Trace every supported handoff.', 'Approve each exact external action.'])]
    for i, (number, first, second, body) in enumerate(cards):
        x, y, w = (20, 24+i*182, 400) if mobile else (36+i*384, 24, 360)
        a.rect(x, y, w, 164 if mobile else 194, a.p['panel'], a.p['line'])
        a.text(x+20, y+28, number, 12, a.p['blue'], 600, 1)
        a.lines(x+20, y+65, [first, second], 25 if mobile else 26, weight=600, leading=32)
        a.lines(x+20, y+125 if mobile else y+141, body, 18 if mobile else 17, a.p['sub'], leading=25)
    return a.finish()


def roadmap(theme, mobile=False):
    a = Art(440 if mobile else 1200, 730 if mobile else 246, theme, 'An honest development roadmap',
            'Repository foundation and CI exist. Durable core, visual Headquarters, Claude adapter, and a qualified preview remain planned milestones.')
    stages = [('Repository', 'foundation', 'CI + policies', True), ('Durable', 'core', 'State + concurrency', False),
              ('Visual', 'Headquarters', 'Graph + recovery', False), ('Claude', 'adapter', 'Qualified execution', False),
              ('Qualified', 'preview', 'Evidence + release gates', False)]
    for i, (first, second, detail, done) in enumerate(stages):
        x, y, w = (20, 24+i*142, 400) if mobile else (32+i*234, 24, 216)
        a.rect(x, y, w, 124 if mobile else 198, a.p['panel'], a.p['teal'] if done else a.p['line'])
        a.text(x+18, y+28, f'0{i+1}', 12, a.p['teal'] if done else a.p['sub'], 600, 1)
        a.pill(x+w-111, y+12, 'PRESENT' if done else 'PLANNED', done, 16 if mobile else 14, 97)
        a.lines(x+18, y+64, [first, second], 24 if mobile else 23, weight=600, leading=29)
        a.text(x+190 if mobile else x+18, y+93 if mobile else y+157, detail.replace(' + release gates',' + releases') if mobile else detail, 16 if mobile else 15, a.p['sub'])
    return a.finish()


GUIDES = {
    'contributing': ('CONTRIBUTOR FIELD GUIDE', 'Contribute with evidence.', 'Focused changes. Reproducible results. Clear review.', ['SCOPE', 'PATCH', 'PROOF']),
    'security': ('TRUST & RESPONSIBILITY', 'Make every boundary explicit.', 'Protect credentials, authority, and the people behind the work.', ['ISOLATE', 'CONSTRAIN', 'VERIFY']),
    'governance': ('PROJECT GOVERNANCE', 'Authority stays accountable.', 'Public development, explicit decisions, reviewable change.', ['INTENT', 'AUTHORITY', 'REVIEW']),
    'releasing': ('RELEASE FIELD GUIDE', 'Ship what the evidence proves.', 'Exact artifacts. Deliberate approval. Verified outcomes.', ['QUALIFY', 'APPROVE', 'VERIFY']),
    'conduct': ('COMMUNITY STANDARD', 'Good work starts with respect.', 'Be specific. Stay open to correction. Protect privacy.', ['RESPECT', 'EVIDENCE', 'PRIVACY']),
}


def guide(theme, key, mobile=False):
    eyebrow, title, detail, chips = GUIDES[key]
    a = Art(440 if mobile else 1200, 280 if mobile else 216, theme, title, detail)
    a.text(28 if mobile else 42, 40 if mobile else 43, eyebrow, 12 if mobile else 14, a.p['teal'], 600, 1.5)
    if mobile:
        words = title.split(); lines = []; current = ''
        for word in words:
            if len(current+' '+word) > 22 and current:
                lines.append(current); current = word
            else:
                current = (current+' '+word).strip()
        lines.append(current)
        a.lines(20, 91, lines, 32, weight=600, leading=42)
        a.text(20, 189, 'AGENTIC SOFTWARE FACTORY / PUBLIC PRE-ALPHA', 10, a.p['sub'], 600, .8)
        for i, label in enumerate(chips):
            a.pill(20+i*134, 219, label, i==0, 16, 120)
    else:
        a.text(42, 102, title, 43, weight=600)
        a.text(42, 146, detail, 20, a.p['sub'])
        for i, label in enumerate(chips):
            a.pill(42+i*150, 170, label, i==0, 14, 134)
        a.text(1157, 187, 'SF / FIELD GUIDE', 12, a.p['sub'], 600, 1, 'end')
    return a.finish()


def build_assets():
    assets = {}
    for theme in PALETTES:
        for mobile in (False, True):
            suffix = ('-mobile' if mobile else '') + '-' + theme + '.svg'
            for name, renderer in [('hero', hero), ('architecture', architecture), ('principles', principles), ('roadmap', roadmap)]:
                assets[OUT / (name+suffix)] = renderer(theme, mobile)
            for key in GUIDES:
                assets[OUT / (key+suffix)] = guide(theme, key, mobile)
    return assets


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    stale = []
    assets = build_assets()
    for path, content in assets.items():
        if args.check:
            if not path.is_file() or path.read_text() != content:
                stale.append(str(path.relative_to(ROOT)))
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content)
    if stale:
        raise SystemExit('Stale documentation artwork: '+', '.join(stale))
    print(f'Documentation artwork {"verified" if args.check else "generated"}: {len(assets)} SVG assets.')


if __name__ == '__main__':
    main()
