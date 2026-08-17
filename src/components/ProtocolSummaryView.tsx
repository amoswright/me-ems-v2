import React from 'react';
import { Baby } from 'lucide-react';
import type { Protocol, SummaryCategory, StepSummary } from '@/types/protocol';
import { renderProtocolHtml } from '@/utils/renderProtocolHtml';
import { MermaidDiagram } from '@/components/MermaidDiagram';
import { extractMermaidContent } from '@/utils/parseMermaid';

// ─── Archetype detection ───────────────────────────────────────────────────

type ArchetypeKey =
  | 'request-als'
  | 'contact-olmc'
  | 'ecg-12lead'
  | 'airway'
  | 'cardiac-monitor'
  | 'oxygen'
  | 'iv-access'
  | 'transport'
  | 'blood-glucose'
  | 'cpr'
  | 'defibrillation'
  | 'fluid-bolus'
  | 'epinephrine'
  | 'naloxone'
  | 'notify-hospital'
  | 'spinal'
  | 'shock'
  | 'rosc'
  | 'refer-protocol'
  | 'medication'
  | 'assess-patient'
  | 'pain-management'
  | 'bleeding-control'
  | 'positioning'
  | 'pediatric'
  | 'family-support'
  | 'temperature'
  | 'default';

interface Archetype {
  key: ArchetypeKey;
  label: string;
}

// Each rule: [key, label, regex] — first match wins, order matters
const ARCHETYPES: [ArchetypeKey, string, RegExp][] = [
  // ── High-specificity clinical actions ──
  ['request-als',    'Request ALS',           /request als|contact als|\bals.*if available\b|aemt to request als/],
  ['contact-olmc',   'Contact OLMC',          /\bolmc\b|on.?line medical control/],
  ['ecg-12lead',     '12-Lead ECG',           /12.lead\s*(ecg|ekg)|twelve.lead/],
  ['airway',         'Manage Airway',         /manage.*airway|airway.*manag|airway algorithm|manage the airway|advanced airway|oral.*airway|nasal.*airway|place.*airway|bvm ventil|capnograph|etco[₂2]|end.tidal/],
  ['cardiac-monitor','Cardiac Monitor',       /cardiac monitor|place.*on a.*monitor|continuous.*cardiac|attach.*monitor/],
  ['oxygen',         'Supplemental O\u2082',  /\bo[₂2]\b|supplemental o[₂2]|high.flow o|non.rebreather|\bnrm\b|\boxygen\b/],
  ['iv-access',      'IV / IO Access',        /establish iv|obtain iv\b|\biv en route\b|initiate iv|establish io|obtain io|initiate io|\biv.*access\b|start.*iv\b/],
  ['fluid-bolus',    'Fluid Bolus',           /fluid bolus|ns bolus|\bsaline bolus\b|bolus.*saline|lactated ringer|bolus.*ml.*kg/],
  ['cpr',            'CPR',                   /\bcpr\b|chest compressions|begin compressions|start cpr|initiate cpr/],
  ['defibrillation', 'Defibrillate / AED',    /defibril|\baed\b/],
  ['epinephrine',    'Epinephrine',           /\bepinephrine\b/],
  ['naloxone',       'Naloxone',              /\bnaloxone\b|\bnarcan\b/],
  ['blood-glucose',  'Blood Glucose',         /finger stick|blood glucose|glucometer|blood sugar|glucose measurement/],
  ['spinal',         'Spinal Precautions',    /spinal.*motion|cervical collar|spine.*precaution|spinal immobil|immobilize.*spine/],
  // ── Medications not covered above ──
  ['medication',     'Medication',            /\bamiodarone\b|\batropine\b|\bmagnesium\b|\bdiphenhydramine\b|\bfentanyl\b|\bmidazolam\b|\bketamine\b|\baspirin\b|\bnitroglycerin\b|\bondansetron\b|\bzofran\b|\badenosine\b|\bdextrose\b|\bdiazepam\b|\blorazepam\b|\bdopamine\b|\bvasopressin\b|\bprocainamide\b|\blidocaine\b|\btranexamic\b|\btxa\b|\boxytocin\b|\bdexamethasone\b|\bhydrocortisone\b|\bnorepinephrine\b|\bmetoprolol\b|\blabetalol\b|\bketorolac\b|\bacetaminophen\b|\bibuprofen\b|\bglucagon\b|\bbenadryl\b/],
  // ── Post-resuscitation ──
  ['rosc',           'Post-ROSC Care',        /\brosc\b|return of spontaneous circulation/],
  // ── Shock ──
  ['shock',          'Treat for Shock',       /\bshock\b.*(?:refer|treat|if indicated|if appropriate|if present|suspected)|if shock present|treat for shock|evidence of shock/],
  // ── Hemorrhage ──
  ['bleeding-control','Hemorrhage Control',   /tourniquet|direct pressure|hemostatic|control.*bleed|bleed.*control|hemorrhage.*control|pack.*wound/],
  // ── Cross-protocol references ──
  ['refer-protocol', 'See Protocol',          /refer to .{3,50} protocol\b|see .{3,30} protocol,/],
  // ── Assessment ──
  ['assess-patient', 'Assess Patient',        /\breassess\b|obtain vital signs|monitor vital|vital signs|perform.*assessment|detailed.*exam|primary.*survey|secondary.*survey|glasgow|gcs\b|blood pressure|spo[₂2]\b|pulse oxim/],
  // ── Pain ──
  ['pain-management','Pain Management',       /pain.*scal|pain.*rating|pain.*manag|analges|pain.*control|universal pain/],
  // ── Positioning ──
  ['positioning',    'Patient Positioning',   /position of comfort|left lateral|right lateral|lateral recumbent|trendelenburg|fowler|elevate.*head|elevate.*legs|semi.recumbent|recovery position/],
  // ── Pediatric ──
  ['pediatric',      'Pediatric',             /\bpediatric\b|\bpeds\b|\binfant\b|\bnewborn\b|\bneonate\b|length.based tape|broselow|child.*under.*year|pediatric.*dose/],
  // ── Family / support ──
  ['family-support', 'Family Support',        /family.*bystander|support.*family|provide.*support|focus.*family|notify.*family|comfort.*family/],
  // ── Temperature management ──
  ['temperature',    'Temperature Management', /passive cooling|active cooling|begin.*cool|cool.*patient|warming.*patient|warm.*patient|hypotherm.*treat|rewarming|heat stroke|hyperthermi.*treat|remove.*clothing.*cool|ice.*pack/],
  // ── Transport (after medication/shock so those don't false-positive) ──
  ['transport',      'Transport',             /transport in position|transport to the (most|nearest|appropriate)|\btransport\b(?! time| guidelines)/],
  // ── Notify hospital ──
  ['notify-hospital','Notify Hospital',       /notify.*hospital|notify.*receiving|alert.*hospital/],
];

function detectArchetype(html: string): Archetype {
  const t = html.replace(/<[^>]+>/g, ' ');
  const tl = t.toLowerCase();
  for (const [key, label, ...patterns] of ARCHETYPES) {
    for (const pat of patterns) {
      if (pat.test(tl)) return { key, label };
    }
  }
  return { key: 'default', label: '' };
}

// ─── Route icon detection (for default/unmatched steps) ───────────────────

const ROUTE_ICONS = [
  { key: 'IM',  file: '/assets/route-icons/im-thigh.svg',      pattern: /\bIM\b/ },
  { key: 'IV',  file: '/assets/route-icons/iv-arm.svg',        pattern: /\bIV\b/ },
  { key: 'IO',  file: '/assets/route-icons/io-lower-leg.svg',  pattern: /\bIO\b/ },
  { key: 'SL',  file: '/assets/route-icons/sl-sublingual.svg', pattern: /\bSL\b/ },
  { key: 'IN',  file: '/assets/route-icons/in-nasal.svg',      pattern: /\bIN\b/ },
  { key: 'PO',  file: '/assets/route-icons/po-oral.svg',       pattern: /\bPO\b/ },
  { key: 'Neb', file: '/assets/route-icons/neb-mask.svg',      pattern: /\bneb/i },
] as const;

type RouteIcon = typeof ROUTE_ICONS[number];

function detectRoutes(html: string): RouteIcon[] {
  const stripped = html.replace(/<[^>]+>/g, ' ');
  return ROUTE_ICONS.filter(r => r.pattern.test(stripped));
}

// ─── Provider level styles ─────────────────────────────────────────────────

export const LEVEL_STYLES: Record<string, { border: string; iconBg: string; pillGrad: string; label: string }> = {
  EMT:                         { border: 'border-l-green-500',  iconBg: 'bg-green-50 dark:bg-green-900/20',   pillGrad: 'from-green-700 to-green-500 text-white',         label: 'EMT' },
  ADVANCED_EMT:                { border: 'border-l-yellow-500', iconBg: 'bg-yellow-50 dark:bg-yellow-900/20', pillGrad: 'from-yellow-600 to-yellow-400 text-gray-900',    label: 'Advanced EMT' },
  PARAMEDIC:                   { border: 'border-l-red-500',    iconBg: 'bg-red-50 dark:bg-red-900/20',       pillGrad: 'from-red-700 to-red-500 text-white',             label: 'Paramedic' },
  EMT_ADVANCED_EMT:            { border: 'border-l-green-400',  iconBg: 'bg-green-50 dark:bg-green-900/20',   pillGrad: 'from-green-600 to-yellow-500 text-white',        label: 'EMT / Advanced EMT' },
  ADVANCED_EMT_PARAMEDIC:      { border: 'border-l-yellow-400', iconBg: 'bg-yellow-50 dark:bg-yellow-900/20', pillGrad: 'from-yellow-500 to-red-500 text-white',          label: 'Advanced EMT / Paramedic' },
  EMT_ADVANCED_EMT_PARAMEDIC:  { border: 'border-l-green-400',  iconBg: 'bg-green-50 dark:bg-green-900/20',   pillGrad: 'from-green-600 to-red-500 text-white',           label: 'EMT / Advanced EMT / Paramedic' },
  PEARLS:                      { border: 'border-l-amber-500',  iconBg: 'bg-amber-50 dark:bg-amber-900/20',   pillGrad: 'from-amber-500 to-yellow-400 text-white',        label: 'PEARLS' },
  ALL:                         { border: 'border-l-gray-200',   iconBg: 'bg-gray-50 dark:bg-gray-800',        pillGrad: '',                                              label: '' },
};

function iconStroke(level: string): string {
  if (level === 'EMT' || level.startsWith('EMT_')) return '#16a34a';
  if (level.startsWith('ADVANCED_EMT')) return '#ca8a04';
  if (level === 'PARAMEDIC') return '#dc2626';
  if (level === 'PEARLS') return '#f59e0b';
  return '#94a3b8';
}

// ─── Category icons (hand-authored summaries only — see StepSummary.category) ──
//
// One bold, solid-fill glyph per category, deliberately coarse (6 categories, not 28)
// so the same icon shows up for every medication regardless of drug name, every
// procedure regardless of which one, etc. Unlike ArchetypeIcon below, this is driven
// by an explicit field the summary author sets — not a guess from step text — so it
// can't silently diverge between two steps that say almost the same thing.

const CATEGORY_ICON_BG: Record<SummaryCategory | 'default', string> = {
  medication: 'bg-purple-100 dark:bg-purple-900/40',
  procedure: 'bg-orange-100 dark:bg-orange-900/40',
  assessment: 'bg-teal-100 dark:bg-teal-900/40',
  communication: 'bg-pink-100 dark:bg-pink-900/40',
  decision: 'bg-gray-200 dark:bg-gray-700',
  default: 'bg-gray-200 dark:bg-gray-700',
};

function CategoryIcon({ category }: { category?: SummaryCategory }) {
  const bg = CATEGORY_ICON_BG[category ?? 'default'];
  return (
    <div className={`flex items-center justify-center rounded-xl flex-shrink-0 ${bg}`} style={{ width: 52, height: 52 }}>
      <svg width="40" height="40" viewBox="0 0 24 24">
        {category === 'medication' && (
          <g transform="rotate(35 12 12)">
            <rect x="2.5" y="8.5" width="19" height="7" rx="3.5" fill="#7F77DD" stroke="#3C3489" strokeWidth={1} />
            <rect x="2.5" y="8.5" width="9.5" height="7" rx="3.5" fill="#3C3489" />
            <line x1="12" y1="8.5" x2="12" y2="15.5" stroke="#EEEDFE" strokeWidth={0.8} />
          </g>
        )}
        {category === 'procedure' && (
          <path d="M10 4h4v6h6v4h-6v6h-4v-6H4v-4h6V4Z" fill="#D85A30" />
        )}
        {category === 'assessment' && (
          <>
            <path d="M12 21C7 17 2 13 2 8.5 2 5 5 3 8 3c2 0 3.5 1 4 2.5C12.5 4 14 3 16 3c3 0 6 2 6 5.5C22 13 17 17 12 21Z" fill="#1D9E75" />
            <path d="M4 12h4l1.5-4.5 2 8 1.5-5.5 1.5 2h5" stroke="#E1F5EE" strokeWidth={1.8} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </>
        )}
        {category === 'communication' && (
          <path d="M6 3c-2 0-3 1-3 3 0 8 7 15 15 15 2 0 3-1 3-3v-2.3c0-.9-.6-1.6-1.4-1.8l-3.2-.8c-.7-.2-1.4.1-1.8.7l-.9 1.3c-2.2-1-4-2.8-5-5l1.3-.9c.6-.4.9-1.1.7-1.8L9.9 4.4C9.7 3.6 9 3 8.1 3H6Z" fill="#D4537E" />
        )}
        {category === 'decision' && (
          <path d="M12 3v7M12 10 6 18M12 10l6 8" stroke="#444441" strokeWidth={4.2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        )}
        {!category && (
          <path d="M4 12.5l5 5L20 6" stroke="#888780" strokeWidth={3.4} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        )}
      </svg>
    </div>
  );
}

// ─── Archetype SVG icons (fallback for steps with no hand-authored summary) ───

function ArchetypeIcon({ archetype, level }: { archetype: ArchetypeKey; level: string }) {
  const s = LEVEL_STYLES[level] ?? LEVEL_STYLES.ALL;
  const c = iconStroke(level);
  const props = { viewBox: '0 0 28 28', width: 28, height: 28, fill: 'none', stroke: c, strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

  return (
    <div className={`flex items-center justify-center rounded-xl flex-shrink-0 ${s.iconBg}`} style={{ width: 52, height: 52 }}>
      {archetype === 'request-als' && (
        // Walkie-talkie: body + antenna + speaker + button
        <svg {...props}>
          <rect x="9" y="9" width="10" height="15" rx="2" />
          <line x1="14" y1="9" x2="14" y2="4" />
          <line x1="11" y1="13" x2="17" y2="13" strokeWidth={1.2} />
          <line x1="11" y1="15" x2="17" y2="15" strokeWidth={1.2} />
          <rect x="11" y="18" width="6" height="3" rx="1" />
        </svg>
      )}
      {archetype === 'contact-olmc' && (
        // Phone handset
        <svg {...props}>
          <path d="M8 6h4l1.5 4-2.5 1.5c1 2.5 3.5 5 6 6l1.5-2.5 4 1.5v4a1 1 0 01-1 1C10 22 6 12 6 7a1 1 0 012-1z" />
          <path d="M18 6c2 0 4 2 4 4" strokeWidth={1.4} />
          <path d="M18 9c.8 0 1.5.7 1.5 1.5" strokeWidth={1.4} />
        </svg>
      )}
      {archetype === 'ecg-12lead' && (
        // 4 stacked short ECG traces representing multiple leads
        <svg {...props}>
          <polyline points="2 9 4 9 5 6 6.5 12 7.5 8 8.5 10 9.5 9 13 9" strokeWidth={1.4} />
          <polyline points="15 9 17 9 18 6 19.5 12 20.5 8 21.5 10 22.5 9 26 9" strokeWidth={1.4} />
          <polyline points="2 16 4 16 5 13 6.5 19 7.5 15 8.5 17 9.5 16 13 16" strokeWidth={1.4} />
          <polyline points="15 16 17 16 18 13 19.5 19 20.5 15 21.5 17 22.5 16 26 16" strokeWidth={1.4} />
          <text x="13.5" y="25" fontSize="5" fontWeight="bold" stroke="none" fill={c} textAnchor="middle" fontFamily="sans-serif">12L</text>
        </svg>
      )}
      {archetype === 'airway' && (
        // Trachea splitting into bronchi
        <svg {...props}>
          <path d="M14 4v6" />
          <path d="M14 10 C11 12 8 13 8 17 C8 20 10 21 12 21" />
          <path d="M14 10 C17 12 20 13 20 17 C20 20 18 21 16 21" />
          <ellipse cx="14" cy="8" rx="2.5" ry="2" />
          <line x1="11" y1="14" x2="9" y2="14" strokeWidth={1.2} />
          <line x1="17" y1="14" x2="19" y2="14" strokeWidth={1.2} />
        </svg>
      )}
      {archetype === 'cardiac-monitor' && (
        // Heart with ECG line through it
        <svg {...props}>
          <path d="M14 22 C14 22 5 16 5 10 a5 5 0 0110-1 5 5 0 0110 1 C25 16 14 22 14 22z" />
          <polyline points="8 13 10 13 11.5 10 13 16 14.5 12 15.5 14 17 13 20 13" strokeWidth={1.3} stroke="white" />
        </svg>
      )}
      {archetype === 'oxygen' && (
        // O2 face mask with tube
        <svg {...props}>
          <path d="M8 14 C8 10 20 10 20 14 L19 21 C17 23 11 23 9 21 Z" />
          <path d="M11 14 C11 12 17 12 17 14 L16.5 20 C15.5 21.5 12.5 21.5 11.5 20 Z" fill={c} fillOpacity="0.15" strokeWidth={1} />
          <line x1="14" y1="10" x2="14" y2="7" />
          <path d="M14 7 C14 7 10 6 10 4" />
          <path d="M10 4 h8" />
        </svg>
      )}
      {archetype === 'iv-access' && (
        // Needle/catheter with insertion angle
        <svg {...props}>
          <line x1="5" y1="20" x2="20" y2="8" strokeWidth={2} />
          <path d="M18 8 l4-2 -1 4z" fill={c} stroke="none" />
          <path d="M5 20 l-2 2 2 1z" fill={c} stroke="none" />
          <path d="M14 12 C16 14 17 16 16 19" strokeWidth={1.3} />
          <circle cx="16" cy="20" r="2" />
          <line x1="10" y1="22" x2="22" y2="22" strokeWidth={1.2} />
        </svg>
      )}
      {archetype === 'transport' && (
        // Stretcher / gurney
        <svg {...props}>
          <rect x="5" y="10" width="18" height="6" rx="1.5" />
          <path d="M5 11 L8 8 H20 L23 11" />
          <circle cx="8" cy="19" r="2.5" />
          <circle cx="20" cy="19" r="2.5" />
          <line x1="3" y1="13" x2="5" y2="13" />
          <line x1="23" y1="13" x2="25" y2="13" />
        </svg>
      )}
      {archetype === 'blood-glucose' && (
        // Blood drop with tick/meter line
        <svg {...props}>
          <path d="M14 5 C14 5 8 13 8 17 a6 6 0 0012 0 C20 13 14 5 14 5z" />
          <line x1="10" y1="17" x2="18" y2="17" stroke="white" strokeWidth={1.4} />
          <line x1="14" y1="14" x2="14" y2="20" stroke="white" strokeWidth={1.4} />
          <path d="M20 8 L24 4" strokeWidth={1.5} />
          <circle cx="25" cy="3.5" r="1.5" fill={c} stroke="none" />
        </svg>
      )}
      {archetype === 'cpr' && (
        // Two hands pressing on chest outline
        <svg {...props}>
          <ellipse cx="14" cy="20" rx="9" ry="4" />
          <rect x="10" y="12" width="8" height="5" rx="2" />
          <line x1="12" y1="12" x2="11" y2="8" />
          <line x1="16" y1="12" x2="17" y2="8" />
          <line x1="9" y1="9" x2="13" y2="7" />
          <line x1="19" y1="9" x2="15" y2="7" />
        </svg>
      )}
      {archetype === 'defibrillation' && (
        // Lightning bolt
        <svg {...props}>
          <polygon points="16 3 9 16 14 16 12 25 19 12 14 12 16 3" fill={c} fillOpacity="0.2" />
          <polygon points="16 3 9 16 14 16 12 25 19 12 14 12 16 3" />
        </svg>
      )}
      {archetype === 'fluid-bolus' && (
        // IV bag
        <svg {...props}>
          <path d="M10 7 Q9 7 9 9 v10 Q9 22 14 22 Q19 22 19 18 V9 Q19 7 18 7 Z" />
          <path d="M11 7 L13 4 H15 L17 7" />
          <circle cx="14" cy="3.5" r="1" fill={c} stroke="none" />
          <line x1="14" y1="22" x2="14" y2="26" />
          <line x1="9" y1="14" x2="19" y2="14" strokeWidth={1.2} />
          <path d="M13 24 L15 24" strokeWidth={1.2} />
        </svg>
      )}
      {archetype === 'epinephrine' && (
        // Syringe (vertical)
        <svg {...props}>
          <rect x="11" y="9" width="6" height="12" rx="1" />
          <line x1="14" y1="5" x2="14" y2="9" />
          <line x1="11" y1="5" x2="17" y2="5" />
          <line x1="14" y1="21" x2="14" y2="25" />
          <line x1="11" y1="13" x2="9" y2="13" strokeWidth={1.2} />
          <line x1="11" y1="16" x2="9" y2="16" strokeWidth={1.2} />
          <line x1="11" y1="19" x2="9" y2="19" strokeWidth={1.2} />
          <rect x="13" y="9" width="2" height="5" fill={c} fillOpacity="0.4" stroke="none" />
        </svg>
      )}
      {archetype === 'naloxone' && (
        // Nasal spray device
        <svg {...props}>
          <rect x="10" y="13" width="8" height="12" rx="2" />
          <path d="M13 13 L12 9 L16 9 L15 13" />
          <path d="M14 9 L14 6" />
          <circle cx="14" cy="5" r="1.2" fill={c} fillOpacity="0.5" stroke={c} strokeWidth={1} />
          <circle cx="17.5" cy="4" r="0.8" fill={c} fillOpacity="0.4" stroke="none" />
          <circle cx="11" cy="5" r="0.8" fill={c} fillOpacity="0.4" stroke="none" />
          <rect x="8" y="14" width="4" height="3" rx="1" />
        </svg>
      )}
      {archetype === 'notify-hospital' && (
        // Hospital building with H cross
        <svg {...props}>
          <rect x="5" y="8" width="18" height="16" rx="1.5" />
          <path d="M5 12 H23" strokeWidth={1.2} />
          <path d="M11 5 H17 V8" strokeWidth={1.4} />
          <line x1="10" y1="17" x2="10" y2="22" strokeWidth={2} />
          <line x1="18" y1="17" x2="18" y2="22" strokeWidth={2} />
          <line x1="10" y1="19.5" x2="18" y2="19.5" strokeWidth={2} />
        </svg>
      )}
      {archetype === 'spinal' && (
        // Vertebrae stack
        <svg {...props}>
          <rect x="10" y="3" width="8" height="4" rx="1" />
          <rect x="10" y="9" width="8" height="4" rx="1" />
          <rect x="10" y="15" width="8" height="4" rx="1" />
          <rect x="10" y="21" width="8" height="4" rx="1" />
          <line x1="14" y1="7" x2="14" y2="9" strokeWidth={1.4} />
          <line x1="14" y1="13" x2="14" y2="15" strokeWidth={1.4} />
          <line x1="14" y1="19" x2="14" y2="21" strokeWidth={1.4} />
          <line x1="7" y1="5" x2="10" y2="5" strokeWidth={1.2} />
          <line x1="7" y1="11" x2="10" y2="11" strokeWidth={1.2} />
          <line x1="7" y1="17" x2="10" y2="17" strokeWidth={1.2} />
          <line x1="7" y1="23" x2="10" y2="23" strokeWidth={1.2} />
          <line x1="18" y1="5" x2="21" y2="5" strokeWidth={1.2} />
          <line x1="18" y1="11" x2="21" y2="11" strokeWidth={1.2} />
          <line x1="18" y1="17" x2="21" y2="17" strokeWidth={1.2} />
          <line x1="18" y1="23" x2="21" y2="23" strokeWidth={1.2} />
        </svg>
      )}
      {archetype === 'shock' && (
        // Heart with downward arrow (hemodynamic compromise)
        <svg {...props}>
          <path d="M14 17 C14 17 7 12 7 8 a5 5 0 0110-1 5 5 0 0110 1 C21 12 14 17 14 17z" />
          <line x1="14" y1="17" x2="14" y2="23" />
          <polyline points="11 21 14 24 17 21" />
        </svg>
      )}
      {archetype === 'rosc' && (
        // Heart with circular refresh arrow (return of circulation)
        <svg {...props}>
          <path d="M14 16 C14 16 8 11 8 8 a4.5 4.5 0 019-1 4.5 4.5 0 019 1 C20 11 14 16 14 16z" />
          <path d="M6 20 a8 8 0 0016 0" strokeDasharray="2.5 1.5" />
          <polyline points="21 17 22 20 19 21" />
        </svg>
      )}
      {archetype === 'refer-protocol' && (
        // Arrow pointing into a document
        <svg {...props}>
          <rect x="14" y="5" width="10" height="18" rx="1.5" />
          <line x1="16" y1="9" x2="22" y2="9" strokeWidth={1.3} />
          <line x1="16" y1="12" x2="22" y2="12" strokeWidth={1.3} />
          <line x1="16" y1="15" x2="20" y2="15" strokeWidth={1.3} />
          <line x1="4" y1="14" x2="13" y2="14" />
          <polyline points="10 11 13 14 10 17" />
        </svg>
      )}
      {archetype === 'medication' && (
        // Pill / capsule
        <svg {...props}>
          <rect x="5" y="10" width="18" height="8" rx="4" />
          <line x1="14" y1="10" x2="14" y2="18" />
          <rect x="5" y="10" width="9" height="8" rx="4" fill={c} fillOpacity="0.2" stroke="none" />
        </svg>
      )}
      {archetype === 'assess-patient' && (
        // Stethoscope
        <svg {...props}>
          <path d="M8 5 C8 5 8 9 12 10" />
          <path d="M20 5 C20 5 20 9 16 10" />
          <path d="M12 10 C12 13 16 13 16 10" />
          <path d="M14 13 C14 19 21 19 21 23" />
          <circle cx="21" cy="23" r="2.5" />
          <circle cx="8" cy="4" r="1.2" fill={c} stroke="none" />
          <circle cx="20" cy="4" r="1.2" fill={c} stroke="none" />
        </svg>
      )}
      {archetype === 'pain-management' && (
        // Face with pain expression + scale bar
        <svg {...props}>
          <circle cx="14" cy="10" r="6" />
          <path d="M11 12.5 C12 11 16 11 17 12.5" />
          <line x1="11.5" y1="8" x2="13" y2="9" strokeWidth={1.4} />
          <line x1="16.5" y1="8" x2="15" y2="9" strokeWidth={1.4} />
          <line x1="5" y1="22" x2="23" y2="22" strokeWidth={1.3} />
          <circle cx="8" cy="22" r="1.5" fill={c} fillOpacity="0.4" stroke={c} strokeWidth={1} />
          <circle cx="14" cy="22" r="1.5" fill={c} fillOpacity="0.6" stroke={c} strokeWidth={1} />
          <circle cx="20" cy="22" r="1.5" fill={c} strokeWidth={1} />
        </svg>
      )}
      {archetype === 'bleeding-control' && (
        // Bandage cross
        <svg {...props}>
          <rect x="5" y="11" width="18" height="6" rx="3" />
          <rect x="11" y="5" width="6" height="18" rx="3" />
          <rect x="11" y="11" width="6" height="6" fill={c} fillOpacity="0.25" stroke="none" />
        </svg>
      )}
      {archetype === 'positioning' && (
        // Reclined figure on stretcher
        <svg {...props}>
          <rect x="3" y="19" width="22" height="3" rx="1.5" />
          <circle cx="8" cy="13" r="3" />
          <path d="M8 16 L8 19 L20 19" />
          <line x1="14" y1="19" x2="20" y2="17" />
          <path d="M3 19 L8 15" strokeWidth={1.3} />
          <circle cx="6" cy="24" r="1.5" />
          <circle cx="20" cy="24" r="1.5" />
        </svg>
      )}
      {archetype === 'pediatric' && (
        // Child figure (large head, small body)
        <svg {...props}>
          <circle cx="14" cy="8" r="5" />
          <line x1="14" y1="13" x2="14" y2="21" strokeWidth={2} />
          <line x1="14" y1="15" x2="9" y2="19" />
          <line x1="14" y1="15" x2="19" y2="19" />
          <line x1="14" y1="21" x2="10" y2="26" />
          <line x1="14" y1="21" x2="18" y2="26" />
        </svg>
      )}
      {archetype === 'family-support' && (
        // Two figures with a heart above
        <svg {...props}>
          <circle cx="10" cy="9" r="3" />
          <circle cx="18" cy="9" r="3" />
          <path d="M6 22 L6 16 Q6 13 10 13 Q14 13 14 16 L14 22" />
          <path d="M14 22 L14 16 Q14 13 18 13 Q22 13 22 16 L22 22" />
          <path d="M14 6 C14 6 11 3 11 5 a3 3 0 006 0 C17 3 14 6 14 6z" fill={c} fillOpacity="0.5" />
        </svg>
      )}
      {archetype === 'temperature' && (
        // Thermometer with arrows indicating cooling or warming
        <svg {...props}>
          <rect x="12" y="4" width="4" height="14" rx="2" />
          <circle cx="14" cy="21" r="4" />
          <rect x="13" y="12" width="2" height="6" fill={c} fillOpacity="0.5" stroke="none" />
          <circle cx="14" cy="21" r="2.5" fill={c} fillOpacity="0.4" stroke="none" />
          <path d="M20 8 L23 5 M23 5 L21 5 M23 5 L23 7" strokeWidth={1.3} />
          <path d="M20 12 L23 15 M23 15 L21 15 M23 15 L23 13" strokeWidth={1.3} />
        </svg>
      )}
      {archetype === 'default' && (
        // Document with lines (generic step)
        <svg {...props}>
          <rect x="4" y="4" width="20" height="20" rx="3" />
          <line x1="8" y1="10" x2="20" y2="10" />
          <line x1="8" y1="14" x2="20" y2="14" />
          <line x1="8" y1="18" x2="15" y2="18" />
        </svg>
      )}
    </div>
  );
}

// ─── Medication detail renderer ────────────────────────────────────────────

// Split on route abbreviations (compound first so IV/IM/IO isn't split into IV + IM + IO)
const ROUTE_SPLIT_RE = /\b(IV\/IM\/IO|IV\/IO|IM\/IO|NEB|IM|IV|IO|PO|SL|IN|SQ|ET)\b/g;

// Each route gets a consistent color across the whole app so the eye learns to jump
// straight to the right one — same palette as the route-badge legend in the style guide.
const ROUTE_COLORS: Record<string, string> = {
  IV: 'bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300',
  IM: 'bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300',
  IO: 'bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-300',
  PO: 'bg-green-100 dark:bg-green-900/50 text-green-700 dark:text-green-300',
  IN: 'bg-teal-100 dark:bg-teal-900/50 text-teal-700 dark:text-teal-300',
  SL: 'bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300',
  SQ: 'bg-pink-100 dark:bg-pink-900/50 text-pink-700 dark:text-pink-300',
  NEB: 'bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300',
  ET: 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300',
  // Compound routes (offer a choice of sites) stay neutral rather than picking one color
  'IV/IO': 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300',
  'IM/IO': 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300',
  'IV/IM/IO': 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300',
};

function routePillsOf(text: string): React.ReactNode[] {
  return text.split(ROUTE_SPLIT_RE).map((part, i) =>
    ROUTE_COLORS[part]
      ? <span key={i} className={`inline-block ${ROUTE_COLORS[part]} text-[13px] font-mono font-bold px-2 py-0.5 rounded-md mx-0.5 leading-none align-middle`}>{part}</span>
      : part
  );
}

function MedDetailLine({ line }: { line: string }) {
  // Adult [qualifier]: rest
  const adultM = line.match(/^(Adult)\s*(\([^)]+\))?\s*:\s*(.+)/i);
  if (adultM) {
    return (
      <div className="flex items-center gap-2.5 py-0.5">
        <span className="shrink-0 bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 text-[13px] font-bold px-2.5 py-1 rounded-lg leading-none">
          Adult{adultM[2] ? ` ${adultM[2]}` : ''}
        </span>
        <span className="text-[15px] text-gray-700 dark:text-gray-200">{routePillsOf(adultM[3])}</span>
      </div>
    );
  }

  // Peds [qualifier]: rest  (handles "Peds:", "Peds <25kg:", "Peds ≥25kg:")
  const pedsM = line.match(/^(Peds|Ped|Pediatric)\s*([^:]+)?\s*:\s*(.+)/i);
  if (pedsM) {
    const qualifier = pedsM[2]?.trim();
    return (
      <div className="flex items-center gap-2.5 py-0.5">
        <span className="shrink-0 inline-flex items-center gap-1 bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 text-[13px] font-bold px-2.5 py-1 rounded-lg leading-none whitespace-nowrap">
          <Baby size={13} className="shrink-0" aria-hidden="true" />
          {qualifier ? `Peds ${qualifier}` : 'Peds'}
        </span>
        <span className="text-[15px] text-gray-700 dark:text-gray-200">{routePillsOf(pedsM[3])}</span>
      </div>
    );
  }

  // Drug/context label: rest  (e.g. "Epi IM:", "Mag Sulfate:", "Albuterol 2.5mg NEB:")
  const drugM = line.match(/^([A-Za-z][^:]{2,25}):\s*(.+)/);
  if (drugM) {
    return (
      <div className="text-[15px] text-gray-700 dark:text-gray-200 py-0.5">
        <span className="font-semibold text-gray-900 dark:text-gray-100">{drugM[1]}:</span>{' '}
        {routePillsOf(drugM[2])}
      </div>
    );
  }

  // Default — route pills inline
  return (
    <div className="text-[14px] text-gray-500 dark:text-gray-400">
      {routePillsOf(line)}
    </div>
  );
}

function MedDetail({ text }: { text: string }) {
  const lines = text.split('\n').filter(l => l.trim());
  return (
    <div className="mt-2 space-y-1.5">
      {lines.map((line, i) => <MedDetailLine key={i} line={line} />)}
    </div>
  );
}

// ─── List item parsing ─────────────────────────────────────────────────────

function getActionText(liHtml: string): string {
  const olIdx = liHtml.search(/<ol\b/i);
  const ulIdx = liHtml.search(/<ul\b/i);
  const brIdx = liHtml.search(/<br\s*\/?>/i);
  const candidates = [olIdx, ulIdx, brIdx].filter(i => i >= 0);
  const cutIdx = candidates.length > 0 ? Math.min(...candidates) : -1;
  const slice = cutIdx >= 0 ? liHtml.slice(0, cutIdx) : liHtml;
  const text = slice
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
  return text.length > 80 ? text.slice(0, 77) + '…' : text;
}

function getDetailHtml(liHtml: string): string {
  const olIdx = liHtml.search(/<ol\b/i);
  const ulIdx = liHtml.search(/<ul\b/i);
  const candidates = [olIdx, ulIdx].filter(i => i >= 0);
  if (candidates.length > 0) return liHtml.slice(Math.min(...candidates));
  const brIdx = liHtml.search(/<br\s*\/?>/i);
  return brIdx >= 0 ? liHtml.slice(brIdx) : '';
}

// ─── Route icon stack (used for default steps with admin routes) ───────────

function RouteIconStack({ routes }: { routes: RouteIcon[] }) {
  if (routes.length === 1) {
    return <img src={routes[0].file} alt={routes[0].key} style={{ width: 64, height: 64, flexShrink: 0 }} />;
  }
  return (
    <div style={{ position: 'relative', width: 64, height: 64, flexShrink: 0 }}>
      {routes.map(r => (
        <img key={r.key} src={r.file} alt={r.key} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }} />
      ))}
    </div>
  );
}

// ─── Step card ─────────────────────────────────────────────────────────────

function StepCard({ num, liHtml, level, summary }: { num: number; liHtml: string; level: string; summary?: StepSummary }) {
  const s = LEVEL_STYLES[level] ?? LEVEL_STYLES.ALL;
  const archetype = detectArchetype(liHtml);
  const isMatched = archetype.key !== 'default';

  // Priority: AI summary label > archetype canonical label > truncated text
  const strippedLen = liHtml.replace(/<[^>]+>/g, '').length;
  const action = summary?.label ?? (isMatched && strippedLen <= 150 ? archetype.label : getActionText(liHtml));

  // Priority: AI summary detail > nested HTML sub-list
  const detailHtml = summary ? null : getDetailHtml(liHtml);
  const detailText = summary?.detail ?? null;

  // Route icons only for unmatched steps without a hand-authored summary
  const routes = (isMatched || summary) ? [] : detectRoutes(liHtml);

  return (
    <div className={`flex items-start gap-4 bg-white dark:bg-gray-800 rounded-xl shadow-sm border-l-4 ${s.border} p-4 mb-2.5 relative`}>
      <span className="absolute top-2 right-3 text-[11px] font-bold text-gray-400 opacity-40 select-none">{num}</span>
      {summary?.category
        ? <CategoryIcon category={summary.category} />
        : routes.length > 0
        ? <RouteIconStack routes={routes} />
        : <ArchetypeIcon archetype={archetype.key} level={level} />
      }
      <div className="flex-1 min-w-0 pt-0.5">
        <p className="font-bold text-gray-900 dark:text-white text-[18px] leading-snug">{action}</p>
        {detailText && <MedDetail text={detailText} />}
        {!detailText && detailHtml && (
          <div className="mt-1.5 text-[14px] text-gray-500 dark:text-gray-400 leading-relaxed">
            {renderProtocolHtml(detailHtml)}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Level divider ─────────────────────────────────────────────────────────

function LevelDivider({ level }: { level: string }) {
  const s = LEVEL_STYLES[level] ?? LEVEL_STYLES.ALL;
  if (!s.pillGrad) return null;
  return (
    <div className="flex items-center gap-3 my-5 first:mt-0">
      <span className={`bg-gradient-to-r ${s.pillGrad} text-[10px] font-extrabold tracking-widest uppercase px-3 py-1.5 rounded-xl shadow-sm whitespace-nowrap`}>
        {s.label}
      </span>
      <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
    </div>
  );
}

// ─── Info card (for content/pearls sections) ───────────────────────────────

function InfoCard({ html, level, summary }: { html: string; level: string; summary?: StepSummary }) {
  const s = LEVEL_STYLES[level] ?? LEVEL_STYLES.ALL;

  if (summary) {
    // Summarized intro item: icon + label + optional detail (like StepCard but without num)
    const archetype = detectArchetype(html);
    return (
      <div className={`flex items-start gap-4 bg-white dark:bg-gray-800 rounded-xl shadow-sm border-l-4 ${s.border} p-4 mb-2.5`}>
        {summary.category ? <CategoryIcon category={summary.category} /> : <ArchetypeIcon archetype={archetype.key} level={level} />}
        <div className="flex-1 min-w-0 pt-0.5">
          <p className="font-bold text-gray-900 dark:text-white text-[18px] leading-snug">{summary.label}</p>
          {summary.detail && <MedDetail text={summary.detail} />}
        </div>
      </div>
    );
  }

  return (
    <div className={`bg-white dark:bg-gray-800 rounded-xl shadow-sm border-l-4 ${s.border} p-4 mb-3`}>
      <div className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
        {renderProtocolHtml(html)}
      </div>
    </div>
  );
}

// Canonical EMT < Advanced EMT < Paramedic ordering — see levelRank in ProtocolPage.tsx for why.
const LEVEL_RANK: Record<string, number> = {
  EMT: 0,
  EMT_ADVANCED_EMT: 0,
  EMT_ADVANCED_EMT_PARAMEDIC: 0,
  ADVANCED_EMT: 1,
  ADVANCED_EMT_PARAMEDIC: 1,
  PARAMEDIC: 2,
};
function levelRank(level: string): number {
  return LEVEL_RANK[level] ?? 1;
}

// ─── Main component ────────────────────────────────────────────────────────

export function ProtocolSummaryView({ protocol }: { protocol: Protocol }) {
  // Group by provider level, always in EMT → Advanced EMT → Paramedic order (ALL leads, as the
  // header/description block) — matching the color bar that runs top-to-bottom on the source
  // page regardless of which levels happen to have numbered steps. This mirrors ProtocolPage.tsx's
  // Full Text view so both views present content in the same order.
  const seenLevels = new Set<string>();
  const levelOrder: string[] = [];
  const hasAll =
    protocol.intro.some(item => item.providerLevel === 'ALL') ||
    protocol.steps.some(step => step.providerLevel === 'ALL');
  if (hasAll) {
    seenLevels.add('ALL');
    levelOrder.push('ALL');
  }
  for (const step of protocol.steps) {
    if (!seenLevels.has(step.providerLevel)) {
      seenLevels.add(step.providerLevel);
      levelOrder.push(step.providerLevel);
    }
  }
  for (const item of protocol.intro) {
    if (!seenLevels.has(item.providerLevel)) {
      seenLevels.add(item.providerLevel);
      levelOrder.push(item.providerLevel);
    }
  }
  const restLevels = levelOrder.filter(l => l !== 'ALL');
  restLevels.sort((a, b) => levelRank(a) - levelRank(b));
  const sortedLevelOrder = hasAll ? ['ALL', ...restLevels] : restLevels;

  // PEARLS boxes are collected separately and rendered after every level group — in the source
  // document they always sit below the whole EMT/AEMT/Paramedic color bar, never nested inside
  // one level's colored region.
  const groups = sortedLevelOrder.map(level => ({
    level,
    introItems: protocol.intro.filter(item => item.providerLevel === level && item.type !== 'pearls'),
    steps: protocol.steps.filter(step => step.providerLevel === level),
  }));
  const pearlsItems = protocol.intro.filter(item => item.type === 'pearls');

  return (
    <div>
      {groups.map((group, gi) => (
        <React.Fragment key={gi}>
          <LevelDivider level={group.level} />
          {group.introItems.map((item, i) => {
            if (item.type === 'mermaid') {
              const content = extractMermaidContent(item.html);
              return content
                ? <div key={`i-${i}`} className="mb-4"><MermaidDiagram content={content} id={`g${gi}-intro-${i}`} /></div>
                : null;
            }
            return <InfoCard key={`i-${i}`} html={item.html} level={item.providerLevel} summary={item.summary} />;
          })}
          {group.steps.map((step, si) => (
            <StepCard key={`s-${step.num}-${si}`} num={step.num} liHtml={step.html} level={group.level} summary={step.summary} />
          ))}
        </React.Fragment>
      ))}
      {pearlsItems.map((pearl, pi) => (
        <div key={`p-${pi}`} className="bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800 rounded-xl p-4 mb-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="bg-gradient-to-r from-amber-500 to-yellow-400 text-white text-[10px] font-extrabold tracking-widest uppercase px-3 py-1.5 rounded-xl">
              {pearl.pearlsTitle ? `PEARLS: ${pearl.pearlsTitle}` : 'PEARLS'}
            </span>
          </div>
          <div className="space-y-2">
            <InfoCard html={pearl.html} level="PEARLS" />
          </div>
        </div>
      ))}
    </div>
  );
}
