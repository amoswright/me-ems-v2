import { useState, useCallback, useEffect } from 'react';

type YN = 'y' | 'n' | null;
type NA = 'normal' | 'abnormal' | null;
type Sc = 0 | 1 | 2 | null;

// ── localStorage-backed state ────────────────────────────────────────────────
function useLS<T>(key: string, init: T): [T, (v: T | ((p: T) => T)) => void, () => void] {
  const [val, setVal] = useState<T>(() => {
    try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : init; }
    catch { return init; }
  });
  const set = useCallback((v: T | ((p: T) => T)) => {
    setVal(prev => {
      const next = typeof v === 'function' ? (v as (p: T) => T)(prev) : v;
      try { localStorage.setItem(key, JSON.stringify(next)); } catch {}
      return next;
    });
  }, [key]);
  const clear = useCallback(() => {
    setVal(init);
    try { localStorage.removeItem(key); } catch {}
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return [val, set, clear];
}

// Shared Time Last Known Well — synced across all three tools for the same protocol
function sharedTLWKey(protocolId: string) { return `stroke-tlkw-${protocolId}`; }
function getSharedTLW(protocolId: string): string {
  try { return localStorage.getItem(sharedTLWKey(protocolId)) ?? ''; } catch { return ''; }
}
function persistSharedTLW(protocolId: string, v: string) {
  try {
    if (v) localStorage.setItem(sharedTLWKey(protocolId), v);
    else localStorage.removeItem(sharedTLWKey(protocolId));
  } catch {}
}

// ── Shared UI atoms ──────────────────────────────────────────────────────────
function YNPill({ value, onChange }: { value: YN; onChange: (v: YN) => void }) {
  return (
    <div className="flex gap-1.5 shrink-0">
      <button onClick={() => onChange(value === 'y' ? null : 'y')}
        className={`px-3 py-1 rounded-full text-xs font-bold transition-colors ${
          value === 'y'
            ? 'bg-green-500 text-white shadow-sm'
            : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-green-100 dark:hover:bg-green-900/30'
        }`}>YES</button>
      <button onClick={() => onChange(value === 'n' ? null : 'n')}
        className={`px-3 py-1 rounded-full text-xs font-bold transition-colors ${
          value === 'n'
            ? 'bg-red-500 text-white shadow-sm'
            : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-red-100 dark:hover:bg-red-900/30'
        }`}>NO</button>
    </div>
  );
}

function NAPill({ value, onChange }: { value: NA; onChange: (v: NA) => void }) {
  return (
    <div className="flex gap-1.5 shrink-0">
      <button onClick={() => onChange(value === 'normal' ? null : 'normal')}
        className={`px-3 py-1.5 rounded-full text-xs font-bold transition-colors ${
          value === 'normal'
            ? 'bg-green-500 text-white shadow-sm'
            : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-green-100 dark:hover:bg-green-900/30'
        }`}>NORMAL</button>
      <button onClick={() => onChange(value === 'abnormal' ? null : 'abnormal')}
        className={`px-3 py-1.5 rounded-full text-xs font-bold transition-colors ${
          value === 'abnormal'
            ? 'bg-red-500 text-white shadow-sm'
            : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-red-100 dark:hover:bg-red-900/30'
        }`}>ABNORMAL</button>
    </div>
  );
}

// Score cards — show all labels always, selected = filled blue
function ScoreCards({ value, labels, onChange }: {
  value: Sc;
  labels: string[];
  onChange: (v: Sc) => void;
}) {
  return (
    <div className="flex gap-2">
      {labels.map((label, n) => (
        <button key={n} onClick={() => onChange(value === n ? null : n as Sc)}
          className={`flex-1 rounded-xl p-2.5 text-left border-2 transition-all ${
            value === n
              ? 'bg-blue-500 border-blue-500 text-white shadow'
              : 'bg-gray-50 dark:bg-gray-800/80 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:border-blue-300 dark:hover:border-blue-600'
          }`}>
          <div className={`text-lg font-extrabold leading-none mb-1 ${value === n ? 'text-white' : 'text-blue-500 dark:text-blue-400'}`}>{n}</div>
          <div className="text-[10px] leading-tight">{label}</div>
        </button>
      ))}
    </div>
  );
}

// Mobile-friendly time input with shared-TLW support
function TimeField({ label, value, onChange, autoFilledFrom }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoFilledFrom?: string;
}) {
  return (
    <div className="rounded-xl border-2 border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-extrabold uppercase tracking-widest text-gray-400 dark:text-gray-500">{label}</p>
        {autoFilledFrom && !value && (
          <p className="text-[10px] text-blue-500 dark:text-blue-400 mt-0.5">↑ enter above to auto-fill here</p>
        )}
        {value && autoFilledFrom && (
          <p className="text-[10px] text-blue-500 dark:text-blue-400 mt-0.5">✓ synced from {autoFilledFrom}</p>
        )}
      </div>
      <input
        type="time"
        value={value}
        onChange={e => onChange(e.target.value)}
        className="text-base font-bold px-3 py-2.5 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-800 dark:text-gray-100 min-w-[120px] text-center focus:border-blue-400 focus:outline-none"
      />
    </div>
  );
}

function SectionHeader({ title, onClear }: { title: string; onClear: () => void }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <span className="text-xs font-extrabold tracking-widest uppercase text-gray-500 dark:text-gray-400">{title}</span>
      <button onClick={onClear}
        className="text-[11px] text-gray-400 hover:text-red-500 dark:hover:text-red-400 font-semibold px-2 py-0.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
        Clear
      </button>
    </div>
  );
}

// ── FAST Screen ──────────────────────────────────────────────────────────────
interface FastState {
  tlkw: string; witness: string;
  facial: NA; arm: NA; speech: NA;
  glucose: string;
  c1: YN; c2: YN; c3: YN; c4: YN;
}
const FAST_INIT: FastState = {
  tlkw: '', witness: '', facial: null, arm: null, speech: null, glucose: '',
  c1: null, c2: null, c3: null, c4: null,
};

function FastScreen({ storageKey, protocolId }: { storageKey: string; protocolId: string }) {
  const [s, set, clear] = useLS<FastState>(storageKey, FAST_INIT);
  const allYes = s.c1 === 'y' && s.c2 === 'y' && s.c3 === 'y' && s.c4 === 'y';
  const anyAbnormal = s.facial === 'abnormal' || s.arm === 'abnormal' || s.speech === 'abnormal';

  // Sync TLW to shared key so FAST-ED + Thrombolytics can auto-fill
  const handleTLW = (v: string) => {
    set({ ...s, tlkw: v });
    persistSharedTLW(protocolId, v);
  };

  const handleClear = () => {
    clear();
    persistSharedTLW(protocolId, '');
  };

  const fastItems = [
    {
      key: 'facial' as const,
      label: 'F — Facial Droop',
      instruction: 'Have patient smile and show teeth.',
      normal: 'Both sides move equally.',
      abnormal: "One side doesn't move as well.",
      value: s.facial,
      onChange: (v: NA) => set({ ...s, facial: v }),
    },
    {
      key: 'arm' as const,
      label: 'A — Arm Drift',
      instruction: 'Patient closes eyes, holds both arms extended.',
      normal: 'Both arms move the same.',
      abnormal: "One arm doesn't move or drifts down.",
      value: s.arm,
      onChange: (v: NA) => set({ ...s, arm: v }),
    },
    {
      key: 'speech' as const,
      label: 'S — Speech',
      instruction: '"You can\'t teach an old dog new tricks."',
      normal: 'Says words clearly.',
      abnormal: 'Slurs, wrong words, or unable to speak.',
      value: s.speech,
      onChange: (v: NA) => set({ ...s, speech: v }),
    },
  ];

  const criteria = [
    { key: 'c1' as const, val: s.c1, q: 'Time from onset of symptoms known to be <24 hours?' },
    { key: 'c2' as const, val: s.c2, q: 'Blood glucose is or has been corrected to >60 mg/dL?' },
    { key: 'c3' as const, val: s.c3, q: 'Any abnormal finding on Prehospital Stroke Scale?' },
    { key: 'c4' as const, val: s.c4, q: 'Deficit unlikely due to head trauma or other identifiable cause?' },
  ];

  return (
    <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50/40 dark:bg-amber-900/10 p-4 my-3">
      <SectionHeader title="Prehospital Stroke Scale (FAST)" onClear={handleClear} />

      <div className="space-y-2 mb-4">
        <TimeField label="Time Last Known Well" value={s.tlkw} onChange={handleTLW} />
        <div className="rounded-xl border-2 border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3">
          <p className="text-[10px] font-extrabold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-1.5">Witness Name / Contact</p>
          <input type="text" value={s.witness} onChange={e => set({ ...s, witness: e.target.value })}
            placeholder="Name   ( ) -"
            className="w-full text-sm px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-800 dark:text-gray-200 placeholder-gray-300 dark:placeholder-gray-600" />
        </div>
      </div>

      <div className="space-y-2 mb-4">
        {fastItems.map(item => (
          <div key={item.key} className={`rounded-xl p-3 border-2 transition-colors ${
            item.value === 'abnormal' ? 'bg-red-50 dark:bg-red-900/20 border-red-300 dark:border-red-700' :
            item.value === 'normal'   ? 'bg-green-50 dark:bg-green-900/20 border-green-300 dark:border-green-700' :
            'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700'
          }`}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-gray-800 dark:text-gray-100 mb-0.5">{item.label}</p>
                <p className="text-[11px] italic text-gray-500 dark:text-gray-400 mb-1">{item.instruction}</p>
                <p className="text-[11px] space-y-0.5">
                  <span className="text-green-600 dark:text-green-400">✓ {item.normal}</span>
                  {'  '}
                  <span className="text-red-500 dark:text-red-400">✗ {item.abnormal}</span>
                </p>
              </div>
              <NAPill value={item.value} onChange={item.onChange} />
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-xl border-2 border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 flex items-center gap-3 mb-4">
        <div className="flex-1">
          <p className="text-[10px] font-extrabold uppercase tracking-widest text-gray-400 dark:text-gray-500">Blood Glucose</p>
        </div>
        <div className="flex items-center gap-2">
          <input type="number" value={s.glucose} onChange={e => set({ ...s, glucose: e.target.value })}
            placeholder="—"
            className="w-24 text-base font-bold px-3 py-2 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-800 dark:text-gray-100 text-center focus:border-blue-400 focus:outline-none" />
          <span className="text-xs text-gray-400 dark:text-gray-500">mg/dL</span>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden mb-3">
        <div className="bg-gray-100 dark:bg-gray-700/60 px-3 py-2">
          <span className="text-[11px] font-extrabold uppercase tracking-widest text-gray-600 dark:text-gray-300">Stroke Alert Criteria — check Yes or No</span>
        </div>
        <div className="divide-y divide-gray-100 dark:divide-gray-700 bg-white dark:bg-gray-800">
          {criteria.map(row => (
            <div key={row.key} className="flex items-center gap-3 px-3 py-2.5">
              <YNPill value={row.val} onChange={v => set({ ...s, [row.key]: v })} />
              <span className="text-xs text-gray-700 dark:text-gray-300 flex-1">{row.q}</span>
            </div>
          ))}
        </div>
      </div>

      {allYes && (
        <div className="rounded-xl bg-red-500 text-white text-center font-extrabold text-sm py-2.5 px-3 tracking-wide">
          ⚡ CODE STROKE — Contact Receiving Hospital
        </div>
      )}
      {!allYes && anyAbnormal && (
        <div className="rounded-xl bg-amber-100 dark:bg-amber-900/30 border border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-200 text-xs font-semibold text-center py-2 px-3">
          Abnormal finding — complete all Stroke Alert Criteria above
        </div>
      )}
    </div>
  );
}

// ── FAST-ED Screen ───────────────────────────────────────────────────────────
interface FastEdState {
  facial: Sc; arm: Sc; speech: Sc; eye: Sc; denial: Sc; timeLkw: string;
}
const FASTED_INIT: FastEdState = { facial: null, arm: null, speech: null, eye: null, denial: null, timeLkw: '' };

const FASTED_ROWS: Array<{
  key: keyof Omit<FastEdState, 'timeLkw'>;
  letter: string;
  name: string;
  instruction: string;
  labels: string[];
}> = [
  {
    key: 'facial', letter: 'F', name: 'Facial Palsy',
    instruction: 'Ask the patient to smile.',
    labels: ['Normal or mild asymmetry', 'Obvious droop one side'],
  },
  {
    key: 'arm', letter: 'A', name: 'Arm Weakness',
    instruction: 'Extend weak arm, palm down, 90° sitting / 45° supine. Hold 10 sec.',
    labels: ['No drift × 10 sec', 'Partial drift down', 'Full drift / no movement'],
  },
  {
    key: 'speech', letter: 'S', name: 'Speech Changes',
    instruction: 'Note speech; name 3 items; show 2 fingers (no visual demo).',
    labels: ['Normal speech', 'Impaired but comprehensible', 'Incomprehensible or mute'],
  },
  {
    key: 'eye', letter: 'E', name: 'Eye Deviation',
    instruction: 'Observe horizontal eye movements.',
    labels: ['Normal movements', 'Tends to one side', 'Forced to one side'],
  },
  {
    key: 'denial', letter: 'D', name: 'Denial / Neglect',
    instruction: 'Touch both arms — feel both? Show weak hand: "Whose hand is this?"',
    labels: ['Feels both; recognizes hand', "Misses one side; recognizes hand", "Misses one side; unrecognized"],
  },
];

function FastEdScreen({ storageKey, protocolId }: { storageKey: string; protocolId: string }) {
  const sharedTLW = getSharedTLW(protocolId);
  const [s, set, clear] = useLS<FastEdState>(storageKey, {
    ...FASTED_INIT,
    timeLkw: sharedTLW,
  });

  // Auto-fill timeLkw from shared TLW if still empty after mount
  useEffect(() => {
    if (!s.timeLkw && sharedTLW) {
      set(prev => ({ ...prev, timeLkw: sharedTLW }));
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleTLW = (v: string) => {
    set(prev => ({ ...prev, timeLkw: v }));
    persistSharedTLW(protocolId, v);
  };

  const scores = [s.facial, s.arm, s.speech, s.eye, s.denial];
  const answered = scores.filter(v => v !== null).length;
  const total = scores.reduce<number>((a, b) => a + (b ?? 0), 0);
  const isComplete = answered === 5;
  const isLVO = isComplete && total >= 4;

  return (
    <div className="rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50/40 dark:bg-blue-900/10 p-4 my-3">
      <SectionHeader title="FAST-ED — LVO Screening" onClear={clear} />

      <div className="space-y-2 mb-3">
        {FASTED_ROWS.map(row => {
          const val = s[row.key] as Sc;
          return (
            <div key={row.key} className={`rounded-xl p-3 border-2 transition-colors ${
              val !== null
                ? 'bg-white dark:bg-gray-800 border-blue-300 dark:border-blue-600'
                : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700'
            }`}>
              <div className="flex items-start gap-3">
                <span className="text-xl font-extrabold text-blue-500 dark:text-blue-400 w-6 shrink-0 mt-0.5 leading-none">{row.letter}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-gray-800 dark:text-gray-100 mb-0.5">{row.name}</p>
                  <p className="text-[11px] italic text-gray-500 dark:text-gray-400 mb-2">{row.instruction}</p>
                  <ScoreCards
                    value={val}
                    labels={row.labels}
                    onChange={v => set({ ...s, [row.key]: v })}
                  />
                </div>
              </div>
            </div>
          );
        })}

        <TimeField
          label="T — Time Last Known Well (not scored)"
          value={s.timeLkw}
          onChange={handleTLW}
          autoFilledFrom="FAST"
        />
      </div>

      <div className={`rounded-xl flex items-center justify-between px-4 py-3 ${
        isLVO      ? 'bg-red-500 text-white' :
        isComplete ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200' :
        'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
      }`}>
        <span className="text-xs font-extrabold uppercase tracking-widest">FAST-ED Score</span>
        <div className="flex items-center gap-2">
          <span className="text-2xl font-extrabold">{answered > 0 ? total : '—'}</span>
          {isLVO      && <span className="text-xs font-bold">≥ 4 → Possible LVO</span>}
          {isComplete && !isLVO && <span className="text-xs font-medium">{'< 4 — LVO less likely'}</span>}
        </div>
      </div>
      <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1 text-right">
        Score ≥ 4: sensitivity 0.61 · specificity 0.89 for LVO
      </p>
    </div>
  );
}

// ── Thrombolytics Checklist ──────────────────────────────────────────────────
interface ThrombolyticsState { timeLkw: string; q1: YN; q2: YN; q3: YN; }
const THROMBO_INIT: ThrombolyticsState = { timeLkw: '', q1: null, q2: null, q3: null };

const THROMBO_QS = [
  {
    key: 'q1' as const,
    question: 'Recent trauma, surgeries, or procedures in the last 3 months?',
    detail: 'Severe head trauma ×3mo · Intracranial/spinal surgery ×3mo · Major non-cranial surgery/trauma ×14 days with uncontrollable bleeding',
  },
  {
    key: 'q2' as const,
    question: 'Any bleeding problems in the past?',
    detail: 'Spontaneous intracranial hemorrhage · GI malignancy or GI bleed ×21 days',
  },
  {
    key: 'q3' as const,
    question: 'Patient taking anticoagulants (oral or injectable)?',
    detail: 'Warfarin · Heparin / Lovenox · Dabigatran (Pradaxa) · Rivaroxaban (Xarelto) · Apixaban (Eliquis) · Betrixaban · Edoxaban',
  },
];

function ThrombolyticsScreen({ storageKey, protocolId }: { storageKey: string; protocolId: string }) {
  const sharedTLW = getSharedTLW(protocolId);
  const [s, set, clear] = useLS<ThrombolyticsState>(storageKey, {
    ...THROMBO_INIT,
    timeLkw: sharedTLW,
  });

  useEffect(() => {
    if (!s.timeLkw && sharedTLW) {
      set(prev => ({ ...prev, timeLkw: sharedTLW }));
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleTLW = (v: string) => {
    set(prev => ({ ...prev, timeLkw: v }));
    persistSharedTLW(protocolId, v);
  };

  const anyYes = s.q1 === 'y' || s.q2 === 'y' || s.q3 === 'y';
  const allNo  = s.q1 === 'n' && s.q2 === 'n' && s.q3 === 'n';

  return (
    <div className="rounded-xl border border-purple-200 dark:border-purple-800 bg-purple-50/40 dark:bg-purple-900/10 p-4 my-3">
      <SectionHeader title="Thrombolytics Screening Checklist" onClear={clear} />

      <div className="mb-4">
        <TimeField
          label="Time of Symptom Onset / Last Known Well"
          value={s.timeLkw}
          onChange={handleTLW}
          autoFilledFrom="FAST"
        />
      </div>

      <div className="space-y-2 mb-3">
        {THROMBO_QS.map(q => {
          const val = s[q.key];
          return (
            <div key={q.key} className={`rounded-xl p-3 border-2 transition-colors ${
              val === 'y' ? 'bg-red-50 dark:bg-red-900/20 border-red-300 dark:border-red-700' :
              val === 'n' ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800' :
              'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700'
            }`}>
              <div className="flex items-start gap-3">
                <YNPill value={val} onChange={v => set({ ...s, [q.key]: v })} />
                <div className="flex-1">
                  <p className="text-xs font-semibold text-gray-800 dark:text-gray-100 mb-0.5">{q.question}</p>
                  <p className="text-[11px] italic text-gray-400 dark:text-gray-500">{q.detail}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {anyYes && (
        <div className="rounded-xl bg-red-100 dark:bg-red-900/30 border border-red-300 dark:border-red-700 text-red-700 dark:text-red-300 text-xs font-semibold px-3 py-2.5">
          ⚠ YES response — relay findings to Emergency Medicine staff at receiving hospital
        </div>
      )}
      {allNo && (
        <div className="rounded-xl bg-green-100 dark:bg-green-900/30 border border-green-300 dark:border-green-700 text-green-700 dark:text-green-300 text-xs font-semibold px-3 py-2.5">
          ✓ All negative — patient may be candidate for thrombolytics (if time criteria met)
        </div>
      )}
    </div>
  );
}

// ── Main export ──────────────────────────────────────────────────────────────
export function StrokeScreeningTool({ tool, protocolId }: { tool: string; protocolId: string }) {
  const key = `stroke-screen-${protocolId}-${tool}`;
  if (tool === 'stroke-fast')          return <FastScreen storageKey={key} protocolId={protocolId} />;
  if (tool === 'stroke-fasted')        return <FastEdScreen storageKey={key} protocolId={protocolId} />;
  if (tool === 'stroke-thrombolytics') return <ThrombolyticsScreen storageKey={key} protocolId={protocolId} />;
  return null;
}
