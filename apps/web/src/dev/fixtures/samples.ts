// Sample data copied from design/v4/*.dc.html renderVals().
// Keep control callbacks, filtering and layout in the app, not the fixture data.

const TL = {
  checked: {
    label: 'Checked against source',
    p1: 'M.5 6a5.5 5.5 0 1 0 11 0a5.5 5.5 0 1 0-11 0',
    f1: '#1E7F45',
    s1: 'none',
    p2: 'M3.5 6.2 5.2 7.8 8.5 4.4',
    f2: 'none',
    s2: '#FFFFFF',
  },
  reviewed: {
    label: 'Reviewed',
    p1: 'M1 6a5 5 0 1 0 10 0a5 5 0 1 0-10 0',
    f1: 'none',
    s1: '#7A5A00',
    p2: 'M6 1a5 5 0 0 1 0 10z',
    f2: '#7A5A00',
    s2: 'none',
  },
  none: {
    label: 'Not reviewed',
    p1: 'M1.25 6a4.75 4.75 0 1 0 9.5 0a4.75 4.75 0 1 0-9.5 0',
    f1: 'none',
    s1: '#6B7280',
    p2: '',
    f2: 'none',
    s2: 'none',
  },
  recheck: {
    label: 'Under re-check',
    p1: 'M6 .8 11.4 10.8H.6z',
    f1: '#C25A0A',
    s1: 'none',
    p2: 'M6 4.6v2.8M6 8.6v.5',
    f2: 'none',
    s2: '#FFFFFF',
  },
  error: {
    label: 'Confirmed error',
    p1: 'M4 .8h4L11.2 4v4L8 11.2H4L.8 8V4z',
    f1: '#C33027',
    s1: 'none',
    p2: 'M4.3 4.3l3.4 3.4M7.7 4.3 4.3 7.7',
    f2: 'none',
    s2: '#FFFFFF',
  },
};

const Main = (() => {
  const popular = [
    'pinhole size',
    'PSF FWHM',
    'deconvolution iterations',
    'booking the LSM 980',
    'mounting media',
  ];
  const notices = [
    {
      t: TL.recheck,
      title: 'Confocal microscopy › Principle is under re-check',
      text: 'You used this section on 12 Nov. A reader reported the pinhole wording is outdated and a page author confirmed it. A fix is being reviewed.',
      action: 'Read the section',
      href: 'Page.dc.html',
      when: '22 Nov',
    },
    {
      t: TL.recheck,
      title: 'A source in Deconvolution was retracted',
      text: 'The Richardson–Lucy section cites Okafor et al. 2019, retracted on 21 Nov. Don’t rely on the iteration count until the page authors re-check it.',
      action: 'See what is affected',
      href: 'Page.dc.html',
      when: '21 Nov',
    },
    {
      t: TL.checked,
      title: 'Your source check counted',
      text: 'You checked Pawley Table 2.1 for Confocal microscopy › Resolution. The section is now Checked against source.',
      action: 'See the section',
      href: 'Page.dc.html',
      when: '12 Nov',
    },
  ];
  const allRecent = [
    {
      mine: true,
      page: 'Point spread function',
      section: 'NA table',
      change: 'Corrected the 1.4 NA oil value',
      t: TL.reviewed,
      when: '3 h ago',
    },
    {
      mine: true,
      page: 'Confocal microscopy',
      section: 'Detectors',
      change: 'Hybrid detectors named HyD; link to Detectors page',
      t: TL.reviewed,
      when: '5 h ago',
    },
    {
      mine: false,
      page: 'Light-sheet microscopy',
      section: 'Overview',
      change: 'Lead reworded',
      t: TL.reviewed,
      when: '5 h ago',
    },
    {
      mine: false,
      page: 'STED microscopy',
      section: 'New page',
      change: 'Principle, depletion wavelength, booking',
      t: TL.none,
      when: '1 d ago',
    },
    {
      mine: true,
      page: 'Pinhole alignment',
      section: 'Steps',
      change: 'Step 4 checked against the service manual',
      t: TL.checked,
      when: '2 d ago',
    },
    {
      mine: false,
      page: 'Sample mounting',
      section: 'Refractive index',
      change: 'Added glycerol mixtures table',
      t: TL.reviewed,
      when: '3 d ago',
    },
  ];
  const sdefs = [
    { id: 'mine', label: 'Pages you use' },
    { id: 'all', label: 'All pages' },
  ];
  const start = [
    { page: 'Booking and access', t: TL.checked, spread: 'All 4 sections checked against source' },
    {
      page: 'Confocal microscopy',
      t: TL.recheck,
      spread: '1 under re-check · 1 checked · 2 reviewed · 1 not reviewed',
    },
    { page: 'Point spread function', t: TL.reviewed, spread: '3 reviewed · 2 checked' },
    {
      page: 'Deconvolution',
      t: TL.recheck,
      spread: '1 under re-check (source retracted) · 3 reviewed',
    },
    { page: 'Sample mounting', t: TL.reviewed, spread: '4 reviewed · 1 checked' },
  ];
  const topics = [
    { name: 'Microscopy techniques', n: 24 },
    { name: 'Image processing', n: 31 },
    { name: 'Sample preparation', n: 18 },
    { name: 'Instruments and booking', n: 22 },
    { name: 'Protocols', n: 33 },
  ];
  const legend = [
    { t: TL.checked, meaning: 'A person compared this version with its source and it matched.' },
    {
      t: TL.reviewed,
      meaning: 'A reviewer approved the change. Nobody has checked it against the source yet.',
    },
    { t: TL.none, meaning: 'Written before review started, or never approved.' },
    { t: TL.recheck, meaning: 'A problem was confirmed or a source was withdrawn. Use with care.' },
    { t: TL.error, meaning: 'Known to be wrong. Don’t rely on it until it is fixed.' },
  ];
  return { popular, notices, allRecent, sdefs, start, topics, legend };
})();

// Frame-data keys (the frame's renderVals), not a wire type: the /search response below is inferred from
// its values; generated bindings replace this when the search endpoint exists (system-logic.md §1 rule 3).
type FrameLabel = 'checked' | 'reviewed' | 'not_reviewed' | 'recheck' | 'error';
interface SearchFrameHit {
  before: string;
  hit: string;
  after: string;
  k: FrameLabel;
  rel: number;
  age: number;
  path: string;
  anchor: string;
  page: string;
  section: string;
  warnText?: string;
  meta: string;
  since?: string;
  updatedAt: string;
  checkedBy?: number;
  sourceName?: string;
  usedByTeams: number;
}

// Keep the verbatim reference captions separately from the API-shaped fixture.
export const searchFrame = (() => {
  // Times use UTC and break the tie on 12 Nov in the order of the frame's recent sort.
  const all: SearchFrameHit[] = [
    {
      k: 'recheck',
      rel: 1,
      age: 2,
      path: 'confocal-microscopy.md',
      anchor: 'principle',
      page: 'Confocal microscopy',
      section: 'Principle',
      before: 'Emitted fluorescence returns to a point detector. Closing the ',
      hit: 'pinhole',
      after: ' improves sectioning and reduces the detected signal.',
      warnText:
        'Under re-check since 22 Nov: reported as outdated, confirmed by a page author. A fix is being reviewed.',
      meta: 'Updated 20 Nov · used by 4 teams',
      since: '2026-11-22T00:00:00Z',
      updatedAt: '2026-11-20T00:00:00Z',
      usedByTeams: 4,
    },
    {
      k: 'checked',
      rel: 2,
      age: 4,
      path: 'pinhole-alignment.md',
      anchor: 'choosing-the-size',
      page: 'Pinhole alignment',
      section: 'Choosing the size',
      before: 'Start at 1 Airy unit. The software shows the ',
      hit: 'pinhole size',
      after: ' in AU and in µm for the selected objective; use AU when you report it.',
      meta: 'Checked against the LSM 980 manual by 2 people · updated 12 Nov · used by 5 teams',
      updatedAt: '2026-11-12T00:00:00Z',
      checkedBy: 2,
      sourceName: 'LSM 980 manual',
      usedByTeams: 5,
    },
    {
      k: 'checked',
      rel: 3,
      age: 3,
      path: 'confocal-microscopy.md',
      anchor: 'resolution',
      page: 'Confocal microscopy',
      section: 'Resolution',
      before: 'Lateral resolution is about 0.51 λ / NA with a ',
      hit: 'pinhole',
      after: ' of one Airy unit. Axial resolution is two to three times worse.',
      meta: 'Checked against Pawley Table 2.1 · updated 12 Nov · used by 4 teams',
      updatedAt: '2026-11-12T01:00:00Z',
      sourceName: 'Pawley Table 2.1',
      usedByTeams: 4,
    },
    {
      k: 'reviewed',
      rel: 4,
      age: 1,
      path: 'point-spread-function.md',
      anchor: 'fwhm',
      page: 'Point spread function',
      section: 'FWHM',
      before: 'The measured FWHM grows when the ',
      hit: 'pinhole size',
      after: ' is above 1 AU; below it, the gain is small.',
      meta: 'Reviewed 23 Nov · not yet checked against a source · used by 2 teams',
      since: '2026-11-23T00:00:00Z',
      updatedAt: '2026-11-23T00:00:00Z',
      usedByTeams: 2,
    },
    {
      k: 'not_reviewed',
      rel: 5,
      age: 5,
      path: 'spinning-disk-confocal.md',
      anchor: 'pinhole-crosstalk',
      page: 'Spinning disk confocal',
      section: 'Pinhole crosstalk',
      before: 'The disk has a fixed ',
      hit: 'pinhole size',
      after: ' of 50 µm, so crosstalk rises in thick samples.',
      meta: 'Not reviewed · written in 2023 · used by 1 team',
      updatedAt: '2023-01-01T00:00:00Z',
      usedByTeams: 1,
    },
  ];
  const labels = { checked: 12, reviewed: 18, not_reviewed: 3, recheck: 2, error: 0 };
  const sdefs = [
    { id: 'relevance', label: 'Best match' },
    { id: 'trust', label: 'Most checked first' },
    { id: 'recent', label: 'Newest' },
  ];
  const topics = [
    { id: 'microscopy-techniques', name: 'Microscopy techniques', n: 21 },
    { id: 'protocols', name: 'Protocols', n: 9 },
    { id: 'instruments-and-booking', name: 'Instruments and booking', n: 3 },
    { id: 'image-processing', name: 'Image processing', n: 2 },
  ];
  return { all, sdefs, facets: { labels, topics } };
})();

// The frame shows five hit previews, not the full set behind the aggregate totals.
const Search = {
  total: 35,
  pageCount: 14,
  facets: searchFrame.facets,
  items: searchFrame.all.map((hit) => ({
    path: hit.path,
    pageTitle: hit.page,
    anchor: hit.anchor,
    sectionTitle: hit.section,
    label: {
      label: hit.k,
      since: hit.since ?? null,
      reviewerKind: null,
      reason: hit.warnText ?? null,
    },
    snippet: [{ before: hit.before, hit: hit.hit, after: hit.after }],
    meta: {
      updatedAt: hit.updatedAt,
      checkedBy: hit.checkedBy ?? null,
      sourceName: hit.sourceName ?? null,
      usedByTeams: hit.usedByTeams,
    },
  })),
  nextCursor: null,
};

const Page = (() => {
  const data = [
    {
      id: 'overview',
      k: 'reviewed',
      title: 'Overview',
      fn: '1',
      body: 'A confocal microscope places a pinhole in a plane conjugate to the focus to reject out-of-focus light, so thick samples can be imaged as thin optical sections.',
      evidence: [
        { what: 'Approved by the reviewer agent', meta: '23 Nov · change lightsheet-lead-2' },
        {
          what: 'An agent compared it with Pawley §1.2: matches',
          meta: 'Not enough on its own: a person must check it',
        },
      ],
      changes: 'Becomes Checked against source when a person checks a source on this version.',
      counts: '1 team found it useful.',
    },
    {
      id: 'principle',
      k: 'recheck',
      title: 'Principle',
      fn: '2',
      warn: true,
      body: 'A laser is scanned across the sample. Emitted fluorescence returns through the objective and the same scanning optics to a point detector. Closing the pinhole improves sectioning and reduces the detected signal.',
      evidence: [
        {
          what: 'Report confirmed: outdated',
          meta: 'Reported by a reader in Light-sheet team · confirmed by m.nguyen, 22 Nov',
        },
        { what: 'Approved by a page author', meta: '4 Sep · this version' },
        {
          what: 'A fix is being reviewed',
          meta: 'Escalated to the page authors because it adds a claim',
        },
      ],
      changes:
        'Goes back to Reviewed when the fix is published, or when the page authors close the report.',
      counts: '3 teams used it in practice · 1 confirmed report.',
    },
    {
      id: 'resolution',
      k: 'checked',
      title: 'Resolution',
      fn: '3',
      body: 'Lateral resolution is about 0.51 λ / NA with a pinhole of one Airy unit. Axial resolution is two to three times worse.',
      evidence: [
        {
          what: 'Checked against Pawley Table 2.1 by a person',
          meta: '12 Nov · archived copy · this version',
        },
        {
          what: 'Agrees with Point spread function › FWHM',
          meta: 'Independent source, confirmed by a reviewer',
        },
        { what: 'Linked from 14 pages', meta: 'Shows reach only. Links never count as evidence.' },
      ],
      changes: 'Any edit to this section resets it until it is reviewed again.',
      counts: '2 people in 2 teams checked this version · 1 used it in practice.',
    },
    {
      id: 'detectors',
      k: 'reviewed',
      title: 'Detectors',
      fn: '4',
      body: 'Photomultiplier tubes remain common. Hybrid detectors (HyD) offer higher quantum efficiency and lower noise. See Detectors for models on our instruments.',
      evidence: [
        { what: 'Approved by the reviewer agent', meta: '23 Nov · 5 h ago' },
        { what: 'Source could not be checked', meta: 'The vendor page changed; no archived copy' },
        {
          what: '3 people checked the previous version',
          meta: 'They don’t count for this version',
        },
      ],
      changes: 'Becomes Checked against source when a person checks a source on this version.',
      counts: '3 checks on the previous version · none yet on this one.',
    },
    {
      id: 'history',
      k: 'none',
      title: 'History',
      fn: '5',
      body: 'Minsky patented the principle in 1957. Commercial laser scanning systems followed in the 1980s.',
      evidence: [
        { what: 'Written before review started', meta: 'Imported in 2023; never reviewed' },
      ],
      changes: 'Gets reviewed when someone suggests an edit with a source.',
      counts: 'No one has said they rely on it.',
    },
  ];
  const siblings = [
    { name: 'Confocal microscopy', k: 'recheck', cur: true },
    { name: 'Light-sheet microscopy', k: 'reviewed' },
    { name: 'Spinning disk confocal', k: 'none' },
    { name: 'STED microscopy', k: 'none' },
    { name: 'Widefield fluorescence', k: 'checked' },
  ];
  const sources = [
    {
      cite: 'Pawley, Handbook of Biological Confocal Microscopy, ch. 1',
      status: 'handbook · archived copy',
    },
    { cite: 'Pawley, ch. 2 §2.4', status: 'handbook · archived copy' },
    { cite: 'Pawley, Table 2.1', status: 'handbook · checked by a person 12 Nov' },
    {
      cite: 'Vendor detector overview (web page)',
      status: 'vendor · page changed, no archived copy',
    },
    { cite: 'Minsky, US patent 3,013,467', status: 'primary · archived copy' },
  ];
  const hdefs = [
    { id: 'yes', label: 'Yes' },
    { id: 'partly', label: 'Partly' },
    { id: 'no', label: 'No' },
  ];
  const hq = {
    '': 'Did this page help with your work?',
    yes: 'Thanks. Counted for your team.',
    partly: 'Thanks. What was missing? Report it on the section.',
    no: 'Sorry. Report the section that let you down so it gets fixed.',
  };
  return { data, siblings, sources, hdefs, hq };
})();

const Trust = (() => {
  const tdefs = [
    { id: 'why', label: 'Why this label' },
    { id: 'check', label: 'I checked a source' },
    { id: 'use', label: 'I used it' },
    { id: 'report', label: 'Report a problem' },
  ];
  const evidence = [
    {
      when: '12 Nov',
      what: 'Checked against Pawley Table 2.1 by a person',
      meta: 'Supports the text · numbers compared · archived copy',
    },
    {
      when: '12 Nov',
      what: 'Change update-confocal-psf-2 published',
      meta: 'Approved by m.nguyen (page author)',
    },
    {
      when: '12 Nov',
      what: 'Agrees with Point spread function › FWHM',
      meta: 'Independent source · link confirmed by a reviewer',
    },
    { when: '4 Sep', what: 'First reviewed', meta: 'Approved by h.pham' },
  ];
  const rdefs = [
    {
      id: 'supports',
      label: 'It supports the text',
      hint: 'The section says what the source says',
    },
    { id: 'partly', label: 'Partly', hint: 'Some of it matches, some doesn’t' },
    {
      id: 'contradicts',
      label: 'It contradicts the text',
      hint: 'This also sends a report to the page authors',
    },
    {
      id: 'cant',
      label: 'I couldn’t check',
      hint: 'Paywall, missing page, can’t find the passage',
    },
  ];
  const worked = [
    { id: 'yes', label: 'Yes' },
    { id: 'changes', label: 'With changes' },
    { id: 'no', label: 'No' },
  ];
  const kinds = [
    { id: 'wrong', label: 'Wrong' },
    { id: 'outdated', label: 'Outdated' },
    { id: 'unclear', label: 'Unclear' },
    { id: 'source', label: 'Missing or weak source' },
    { id: 'other', label: 'Something else' },
  ];
  const contradicts = 'Because it contradicts the text, the page authors got a report too.';
  const D = {
    check: {
      title: 'Source check saved',
      text: 'It counts for this version of Resolution.',
      next: [
        'It shows in the evidence for this section straight away.',
        'If the section is edited, you’ll be asked to check again.',
        'Checks from different teams carry more weight than several from one team.',
      ],
      counts:
        '3 people in 3 teams have checked this version, including you · 1 used it in practice.',
    },
    use: {
      title: 'Thanks, saved for your team',
      text: 'Readers will see that Imaging core used this section.',
      next: [
        'You’ll be told if this section changes or goes under re-check.',
        'If it stops matching what you do, report it from here.',
      ],
      counts:
        '2 people in 2 teams checked this version · 2 teams used it in practice, including yours.',
    },
    report: {
      title: 'Report sent to m.nguyen and h.pham',
      text: 'The section keeps its label until a page author confirms the problem.',
      next: [
        'The page authors confirm or dismiss it, with a reason. You’ll be told either way.',
        'If confirmed, everyone sees Under re-check on this section until it is fixed.',
        'You can follow the fix from your activity.',
      ],
      counts: '2 people in 2 teams checked this version · 1 open report (yours).',
    },
  };
  return { tdefs, evidence, rdefs, worked, kinds, D, contradicts };
})();

const You = (() => {
  const D = {
    following: {
      cols: ['Page', 'Last change', 'Trust now', ''],
      rows: [
        {
          page: 'Confocal microscopy',
          section: 'You used Principle, Resolution',
          what: 'Principle went under re-check (22 Nov)',
          t: TL.recheck,
          status: '1 section under re-check',
          detail: 'Fix being reviewed',
          action: 'Open',
          href: 'Page.dc.html',
        },
        {
          page: 'Deconvolution',
          section: 'You used Richardson–Lucy',
          what: 'A cited source was retracted (21 Nov)',
          t: TL.recheck,
          status: '1 section under re-check',
          detail: 'Page authors re-checking',
          action: 'Open',
          href: 'Page.dc.html',
        },
        {
          page: 'Point spread function',
          section: 'Whole page',
          what: 'NA table value corrected (3 h ago)',
          t: TL.reviewed,
          status: 'Reviewed',
          detail: 'Your old check on #table stopped counting',
          action: 'Check again',
          href: 'Trust.dc.html',
        },
        {
          page: 'Pinhole alignment',
          section: 'Whole page',
          what: 'Step 4 checked against the manual',
          t: TL.checked,
          status: 'Checked against source',
          detail: 'All 6 sections',
          action: 'Open',
          href: 'Page.dc.html',
        },
        {
          page: 'Booking and access',
          section: 'Whole page',
          what: 'No change in 30 days',
          t: TL.checked,
          status: 'Checked against source',
          detail: '',
          action: 'Unfollow',
          href: '#unfollow',
        },
      ],
    },
    trust: {
      cols: ['Section', 'What you did', 'Outcome', ''],
      rows: [
        {
          page: 'Confocal microscopy',
          section: 'Resolution',
          what: 'Checked a source: supports (12 Nov)',
          t: TL.checked,
          status: 'Counting',
          detail: 'Section is Checked against source',
          action: 'View',
          href: 'Trust.dc.html',
        },
        {
          page: 'Point spread function',
          section: 'NA table',
          what: 'Checked a source: supports (2 Nov)',
          t: TL.none,
          status: 'Stopped counting',
          detail: 'The section was edited 3 h ago',
          action: 'Check again',
          href: 'Trust.dc.html',
        },
        {
          page: 'Light-sheet microscopy',
          section: 'Sample mounting',
          what: 'Reported: outdated (18 Nov)',
          t: TL.reviewed,
          status: 'Fixed and published',
          detail: 'Confirmed by a.tran · fixed 20 Nov',
          action: 'View',
          href: 'Page.dc.html',
        },
        {
          page: 'Sample mounting',
          section: 'Refractive index',
          what: 'Reported: wrong (9 Nov)',
          t: TL.none,
          status: 'Dismissed',
          detail: '“The table is for 20 °C; noted in the text.”',
          action: 'Reply',
          href: 'Discussions.dc.html',
        },
        {
          page: 'Confocal microscopy',
          section: 'Principle',
          what: 'Used in practice: setting up acquisition',
          t: TL.recheck,
          status: 'Section now under re-check',
          detail: 'You may want to look at your settings',
          action: 'Open',
          href: 'Page.dc.html',
        },
      ],
    },
    suggestions: {
      cols: ['Page', 'Your suggestion', 'Status', ''],
      rows: [
        {
          page: 'Confocal microscopy',
          section: 'Detectors',
          what: 'Detector comparison table',
          t: TL.recheck,
          status: 'Needs your attention',
          detail: 'The page changed under it',
          action: 'Resolve',
          href: 'Conflict.dc.html',
        },
        {
          page: 'STED microscopy',
          section: 'Principle',
          what: 'Depletion wavelength',
          t: TL.reviewed,
          status: 'Published',
          detail: 'Approved by h.pham · 1 d ago',
          action: 'View',
          href: 'Page.dc.html',
        },
        {
          page: 'Confocal microscopy',
          section: 'Principle',
          what: 'Draft: pinhole units',
          t: TL.none,
          status: 'Draft',
          detail: 'Saved 10:42',
          action: 'Continue',
          href: 'Editor.dc.html',
        },
      ],
    },
  };
  const tdefs = [
    { id: 'following', label: 'Followed pages', n: '6' },
    { id: 'trust', label: 'Your checks and reports', n: '14' },
    { id: 'suggestions', label: 'Your suggestions', n: '3' },
  ];
  const pdefs = [
    { id: 'recheck', label: 'A section I used goes under re-check' },
    { id: 'changed', label: 'A section I checked is edited' },
    { id: 'report', label: 'My report is confirmed, dismissed or fixed' },
    { id: 'digest', label: 'Weekly summary of followed pages' },
  ];
  return { D, tdefs, pdefs, prefs: { recheck: true, changed: true, report: true, digest: false } };
})();

const Editor = (() => {
  const tdefs = [
    { id: 'write', label: 'Write' },
    { id: 'preview', label: 'Preview' },
    { id: 'diff', label: 'Changes' },
  ];
  const tools = [
    { label: 'B', aria: 'Bold' },
    { label: 'I', aria: 'Italic' },
    { label: 'H', aria: 'Heading' },
    { label: '[ ]', aria: 'Link' },
    { label: '¹', aria: 'Footnote' },
    { label: '⊞', aria: 'Table' },
  ];
  const sources = [
    {
      path: 'sources/pawley-handbook.md §2.4',
      meta: 'Version 20261118-1 · handbook tier · not retracted',
    },
    {
      path: 'confocal-microscopy.md (target)',
      meta: 'Version 20261120-1 · read when you opened the editor',
    },
  ];
  return { tdefs, tools, sources, baseLabel: '20261120-1' };
})();

const Conflict = (() => {
  const plain = 'padding: 0 4px';
  const del = 'padding: 0 4px; background: #FCEDEC; color: #7D1B16';
  const add = 'padding: 0 4px; background: #E6F4EC; color: #11512E';
  const theirs = 'padding: 0 4px; background: #FFF4DB; color: #5C4300';
  const panes = [
    {
      title: 'What you read',
      meta: '20261120-1',
      lines: [
        { t: '## Detectors', style: plain },
        { t: 'Photomultiplier tubes remain common.', style: plain },
        { t: 'Hybrid detectors offer higher quantum', style: del },
        { t: 'efficiency and lower noise.', style: del },
      ],
    },
    {
      title: 'What changed since',
      meta: '20261123-2 · reviewer-agent',
      lines: [
        { t: '## Detectors', style: plain },
        { t: 'Photomultiplier tubes remain common.', style: plain },
        { t: 'Hybrid detectors (HyD) offer higher', style: theirs },
        { t: 'quantum efficiency and lower noise.', style: theirs },
        { t: 'See detectors.md.', style: theirs },
      ],
    },
    {
      title: 'Your proposal',
      meta: 'detector-table',
      lines: [
        { t: '## Detectors', style: plain },
        { t: '| Detector | QE | Noise |', style: add },
        { t: '| PMT | 20–30% | higher |', style: add },
        { t: '| Hybrid | 40–45% | lower |', style: add },
      ],
    },
  ];
  const C = {
    merge: {
      label: 'Combine both',
      hint: 'Keep the new wording and add your table',
      editorTitle: 'Combined section',
      from: 'current page + your table',
      submit: 'Submit as new proposal',
      text: '## Detectors\nPhotomultiplier tubes remain common.\nHybrid detectors (HyD) offer higher quantum efficiency and lower noise.\nSee detectors.md.\n\n| Detector | QE | Noise |\n| PMT | 20–30% | higher |\n| Hybrid | 40–45% | lower |',
    },
    mine: {
      label: 'Replace with mine',
      hint: 'Your table replaces the new wording; reviewers see both diffs',
      editorTitle: 'Your section',
      from: 'your proposal',
      submit: 'Submit as new proposal',
      text: '## Detectors\n| Detector | QE | Noise |\n| PMT | 20–30% | higher |\n| Hybrid | 40–45% | lower |',
    },
    drop: {
      label: 'Drop my change',
      hint: 'The current page already says enough',
      editorTitle: 'Current section (no change)',
      from: '20261123-2',
      submit: 'Withdraw with reason',
      text: '## Detectors\nPhotomultiplier tubes remain common.\nHybrid detectors (HyD) offer higher quantum efficiency and lower noise.\nSee detectors.md.',
    },
  };
  return { panes, C };
})();

const Inbox = (() => {
  const dot = (c: string, sq?: boolean) =>
    'width: 8px; height: 8px; border-radius: ' + (sq ? '1px' : '4px') + '; background: ' + c;
  const all = [
    {
      cat: 'decide',
      type: 'Re-review',
      dot: dot('#C25A0A'),
      age: '2 h',
      title: 'Pinhole claim added to a sourced sentence',
      where: 'confocal-microscopy.md#principle · fix-pinhole-units',
      why: 'The reviewer agent may not approve this: it adds a claim to a sentence that cites a source. Either page author can decide.',
      props: [
        { k: 'Proposal', v: 'fix-pinhole-units by lab-agent (agent)' },
        { k: 'Trigger', v: 'Adds a claim to a sourced sentence' },
        { k: 'Assigned to', v: 'm.nguyen, h.pham' },
        { k: 'Quality check', v: '1 finding (medium)' },
        { k: 'Publishes', v: 'Automatically on approval' },
      ],
      hasAi: true,
      ai: [
        'Units match pawley-handbook.md §2.4.',
        '§2.4 shows the effect for a 1.4 NA oil objective only.',
      ],
      primary: 'Open review',
      href: 'Review.dc.html',
      secondary: ['Assign to h.pham', 'Snooze 1 day'],
    },
    {
      cat: 'decide',
      type: 'Discussion',
      dot: dot('#C25A0A'),
      age: '22 h',
      title: 'Lateral FWHM differs between two pages',
      where: 'point-spread-function.md#fwhm ↔ deconvolution.md#psf-model',
      why: 'The agent found a possible contradiction while reviewing psf-fwhm-table. Approval is held until the discussion is resolved.',
      props: [
        { k: 'Proposal held', v: 'psf-fwhm-table by lab-agent' },
        { k: 'Values', v: '0.51 λ/NA vs 0.61 λ/NA' },
        { k: 'Participants', v: 'm.nguyen, h.pham, reviewer-agent' },
        { k: 'Replies', v: '2 · last 3 h ago' },
      ],
      hasAi: true,
      ai: [
        '0.61 λ/NA is the Rayleigh criterion; 0.51 λ/NA is FWHM. They may both be right with different definitions.',
      ],
      primary: 'Open discussion',
      href: 'Discussions.dc.html',
      secondary: ['Reply here'],
    },
    {
      cat: 'check',
      type: 'Source retracted',
      dot: dot('#C33027', true),
      age: '2 d',
      title: 'A cited article was retracted',
      where: 'deconvolution.md#richardson-lucy',
      why: 'Smith et al. 2019 was retracted on 18 Nov. The section shows “Under re-check” until someone records a new source check.',
      props: [
        { k: 'Detected by', v: 'Retraction check (Crossref), 21 Nov 06:00' },
        { k: 'Also flagged', v: 'denoising.md#iterations, psf-guide.md#tuning (derived)' },
        { k: 'Previous check', v: '2 Oct, no longer counts' },
      ],
      hasAi: false,
      ai: [],
      primary: 'Record source check',
      href: 'Credibility.dc.html',
      secondary: ['Propose correction'],
    },
    {
      cat: 'check',
      type: 'Report',
      dot: dot('#C25A0A'),
      age: '1 d',
      title: 'Reported as outdated',
      where: 'confocal-microscopy.md#principle',
      why: '“The pinhole wording predates the hybrid detector we now use.” Nothing changes for readers until a page author confirms.',
      props: [
        { k: 'From', v: 'Someone in Light-sheet team' },
        { k: 'Kind', v: 'Outdated' },
        { k: 'Topic', v: 'principle-pinhole-detector' },
        { k: 'Related', v: 'fix-pinhole-units is waiting on the same section' },
      ],
      hasAi: false,
      ai: [],
      primary: 'Confirm report',
      href: 'Credibility.dc.html',
      secondary: ['Confirm as error', 'Dismiss'],
    },
    {
      cat: 'spot',
      type: 'Spot check',
      dot: dot('#2453D6'),
      age: '3 h',
      title: 'Check an agent approval',
      where: 'point-spread-function.md · na-table-typo',
      why: 'Picked at random from the reviewer agent’s approvals on your pages (10%). A failed check is recorded as a confirmed error.',
      props: [
        { k: 'Published', v: 'Today 09:12 as 20261123-1' },
        { k: 'Decided by', v: 'reviewer-agent' },
        { k: 'Change', v: '1 line, table value 1.40 → 1.4' },
      ],
      hasAi: false,
      ai: [],
      primary: 'Looks right',
      href: 'Review.dc.html',
      secondary: ['Report a problem', 'View diff'],
    },
  ];
  const cats = [
    { id: 'all', label: 'All' },
    { id: 'decide', label: 'Decide' },
    { id: 'check', label: 'Check' },
    { id: 'spot', label: 'Spot checks' },
    { id: 'mentions', label: 'Mentions' },
    { id: 'done', label: 'Done' },
  ];
  const counts = { all: 5, decide: 2, check: 2, spot: 1, mentions: 0, done: 31 };
  return { all, cats, counts };
})();

const Proposals = (() => {
  const d = (c: string) => 'width: 8px; height: 8px; border-radius: 4px; background: ' + c;
  const amber = d('#B07C00'),
    orange = d('#C25A0A'),
    red = d('#C33027'),
    green = d('#1E7F45'),
    grey = d('#8A909C');
  const all = [
    {
      s: 'open',
      id: 'fix-pinhole-units',
      title: 'Pinhole units and sectioning',
      where: 'confocal-microscopy.md#principle',
      author: 'lab-agent',
      kind: 'agent',
      dot: orange,
      status: 'Escalated',
      detail: 'Re-review: claim added to sourced sentence',
      with: 'm.nguyen, h.pham',
      quality: '1 finding',
      age: '2 h',
    },
    {
      s: 'open',
      id: 'psf-fwhm-table',
      title: 'FWHM table',
      where: 'point-spread-function.md#fwhm',
      author: 'lab-agent',
      kind: 'agent',
      dot: orange,
      status: 'Escalated',
      detail: 'Discussion: contradiction candidate',
      with: 'Discussion (2 replies)',
      quality: 'No findings',
      age: '22 h',
    },
    {
      s: 'open',
      id: 'resolution-axial-factor',
      title: 'Axial factor',
      where: 'confocal-microscopy.md#resolution',
      author: 't.le',
      kind: 'person',
      dot: orange,
      status: 'Disputed',
      detail: 'Hold opened by h.pham',
      with: 'reviewer-agent (waiting)',
      quality: '1 finding',
      age: '1 d',
    },
    {
      s: 'open',
      id: 'new-sted-page',
      title: 'New page: STED microscopy',
      where: 'sted-microscopy.md (new)',
      author: 'a.tran',
      kind: 'person',
      dot: amber,
      status: 'Pending',
      detail: 'Quality check running',
      with: 'reviewer-agent',
      quality: 'Running',
      age: '12 min',
    },
    {
      s: 'stale',
      id: 'detector-table',
      title: 'Detector table',
      where: 'confocal-microscopy.md#detectors',
      author: 'h.pham',
      kind: 'person',
      dot: red,
      status: 'Stale',
      detail: 'Page changed after the author read it',
      with: 'h.pham (resubmit)',
      quality: '—',
      age: '1 d',
    },
    {
      s: 'blocked',
      id: 'deconv-iterations',
      title: 'Iteration count',
      where: 'deconvolution.md#richardson-lucy',
      author: 'h.pham',
      kind: 'person',
      dot: red,
      status: 'Blocked',
      detail: 'Publish outcome unknown since 09:31',
      with: 'Owner (investigate)',
      quality: 'No findings',
      age: '9 h',
    },
    {
      s: 'published',
      id: 'na-table-typo',
      title: 'NA table value',
      where: 'point-spread-function.md#table',
      author: 'lab-agent',
      kind: 'agent',
      dot: green,
      status: 'Published',
      detail: 'Automatically · 20261123-1 · spot check',
      with: 'Decided by reviewer-agent',
      quality: 'No findings',
      age: '3 h',
    },
    {
      s: 'published',
      id: 'lightsheet-lead-2',
      title: 'Lead wording',
      where: 'light-sheet-microscopy.md#lead',
      author: 'lab-agent',
      kind: 'agent',
      dot: green,
      status: 'Published',
      detail: 'Automatically · 20261123-1',
      with: 'Decided by reviewer-agent',
      quality: 'No findings',
      age: '5 h',
    },
    {
      s: 'published',
      id: 'sted-wavelength',
      title: 'Depletion wavelength',
      where: 'sted-microscopy.md#principle',
      author: 'a.tran',
      kind: 'person',
      dot: green,
      status: 'Published',
      detail: 'Approved by h.pham after escalation',
      with: 'Decided by h.pham',
      quality: 'No findings',
      age: '1 d',
    },
    {
      s: 'rejected',
      id: 'lightsheet-lead',
      title: 'Lead wording',
      where: 'light-sheet-microscopy.md#lead',
      author: 'lab-agent',
      kind: 'agent',
      dot: grey,
      status: 'Rejected',
      detail: 'Revision requested: promotional wording',
      with: 'Decided by reviewer-agent',
      quality: '3 findings',
      age: '6 h',
    },
  ];
  const defs = [
    { id: 'open', label: 'Open', count: 4 },
    { id: 'stale', label: 'Stale', count: 1 },
    { id: 'blocked', label: 'Blocked', count: 1 },
    { id: 'published', label: 'Published', count: 51 },
    { id: 'rejected', label: 'Rejected', count: 7 },
    { id: 'all', label: 'All', count: 64 },
  ];
  const stats = [
    { n: '14', label: 'published by the agent today' },
    { n: '2', label: 'escalated to page authors' },
    { n: '3', label: 'sent back for revision today' },
    { n: '1', label: 'blocked, owner must check' },
  ];
  return { all, defs, stats };
})();

const Review = (() => {
  const d = (c: string) => 'width: 8px; height: 8px; border-radius: 4px; background: ' + c;
  const S = {
    escalated: {
      label: 'Escalated to page authors',
      dot: d('#C25A0A'),
      border: '#E4E7EC',
      bannerTitle: 'Assigned to you.',
      bannerText:
        'The reviewer agent could not approve this. Either page author decides; nothing is decided by timeout.',
      bannerAction: 'Read agent notes',
      bannerHref: '#agent',
      discussionVersion: 1,
      disputeVersion: 0,
    },
    disputed: {
      label: 'Disputed',
      dot: d('#C25A0A'),
      border: '#F0C9A6',
      bannerTitle: 'Held by a dispute.',
      bannerText:
        'h.pham asked whether the claim holds for other objectives. You can still ask for changes.',
      bannerAction: 'Go to dispute',
      bannerHref: 'Discussions.dc.html',
      discussionVersion: 1,
      disputeVersion: 1,
    },
    locked: {
      label: 'Escalated to page authors',
      dot: d('#C25A0A'),
      border: '#F0C2BF',
      bannerTitle: 'New discussion entry.',
      bannerText: 'Reread before deciding. Your reason is kept.',
      bannerAction: 'Reload',
      bannerHref: '#reload',
      discussionVersion: 2,
      disputeVersion: 0,
    },
    publishing: {
      label: 'Approved · publishing',
      dot: d('#2453D6'),
      border: '#E4E7EC',
      bannerTitle: 'Publishing automatically.',
      bannerText: 'AUTO_PUBLISH is on. The page authors will see it in their weekly summary.',
      bannerAction: 'View page',
      bannerHref: 'Page.dc.html',
      discussionVersion: 1,
      disputeVersion: 0,
    },
    blocked: {
      label: 'Blocked',
      dot: d('#C33027'),
      border: '#F0C2BF',
      bannerTitle: 'Publish outcome unknown.',
      bannerText:
        'The write timed out. Nobody can publish to this page until the owner confirms what was written.',
      bannerAction: 'Investigate in Operations',
      bannerHref: 'Ops.dc.html',
      discussionVersion: 1,
      disputeVersion: 0,
    },
  };
  const tdefs = [
    { id: 'changes', label: 'Changes' },
    { id: 'final', label: 'Final page' },
    { id: 'base', label: 'Current page' },
    { id: 'discussion', label: 'Discussion (1)' },
    { id: 'history', label: 'History (6)' },
  ];
  const other = {
    final:
      'The exact file that will be written, with its status block. Rendered as readers will see it.',
    base: 'confocal-microscopy.md at 20261120-1, the version the author read.',
    discussion: 'One topic on #principle: “Is the claim general?” See Discussions.',
  };
  const history = [
    { t: '10:05', e: 'Submitted by lab-agent through the API' },
    { t: '10:05', e: 'Quality check queued' },
    { t: '10:07', e: 'Quality check finished: 1 finding, 1 dropped' },
    {
      t: '10:09',
      e: 'reviewer-agent tried to approve; refused by trigger “claim added to sourced sentence”',
    },
    { t: '10:09', e: 'Escalated: re-review assigned to m.nguyen, h.pham' },
    { t: '10:31', e: 'Preview opened by m.nguyen' },
  ];
  const cdefs = [
    {
      id: 'approve',
      label: 'Approve and publish',
      hint: 'published at once',
      submit: 'Approve and publish',
    },
    {
      id: 'changes',
      label: 'Request changes',
      hint: 'back to the author with your reason',
      submit: 'Send back with reason',
    },
    {
      id: 'hold',
      label: 'Hold for discussion',
      hint: 'opens a dispute on the section',
      submit: 'Open dispute',
    },
  ];
  return { S, tdefs, other, history, cdefs };
})();

const Discussions = (() => {
  const d = (c: string) => 'width: 8px; height: 8px; border-radius: 4px; background: ' + c;
  const all = [
    {
      f: 'open',
      title: 'Lateral FWHM differs between two pages',
      where: 'point-spread-function.md#fwhm',
      dot: d('#C25A0A'),
      status: 'Holds psf-fwhm-table',
      meta: '3 replies · 3 h',
      props: [
        { k: 'Opened by', v: 'reviewer-agent, as an escalation' },
        { k: 'Participants', v: 'm.nguyen, h.pham (page authors)' },
        { k: 'Also about', v: 'deconvolution.md#psf-model' },
        { k: 'Version', v: 'discussion v2' },
      ],
      posts: [
        {
          ini: 'RA',
          bg: '#EDE8FA',
          who: 'reviewer-agent',
          role: 'agent',
          t: '22 h',
          ai: true,
          text: 'psf-fwhm-table states lateral FWHM = 0.51 λ/NA. deconvolution.md#psf-model states 0.61 λ/NA. I can’t approve while the pages disagree.',
        },
        {
          ini: 'HP',
          bg: '#E7ECFA',
          who: 'h.pham',
          role: 'page author',
          t: '5 h',
          ai: false,
          text: '0.61 is the Rayleigh distance, not FWHM. Both are right, but deconvolution.md should say which one it means.',
        },
        {
          ini: 'MN',
          bg: '#E7ECFA',
          who: 'm.nguyen',
          role: 'page author',
          t: '3 h',
          ai: false,
          text: 'Agreed. I’ll propose a wording fix on deconvolution.md and we can resolve this.',
        },
      ],
    },
    {
      f: 'open',
      title: 'Is the claim general?',
      where: 'confocal-microscopy.md#principle',
      dot: d('#C25A0A'),
      status: 'Dispute on fix-pinhole-units',
      meta: '1 reply · 20 min',
      props: [
        { k: 'Opened by', v: 'h.pham' },
        { k: 'Kind', v: 'Semantic dispute (holds approval)' },
        { k: 'Version', v: 'dispute v1' },
      ],
      posts: [
        {
          ini: 'HP',
          bg: '#E7ECFA',
          who: 'h.pham',
          role: 'page author',
          t: '20 min',
          ai: false,
          text: '§2.4 covers the 1.4 NA case only. Is “little extra sectioning” true for water objectives?',
        },
      ],
    },
    {
      f: 'open',
      title: 'Pinhole wording outdated',
      where: 'confocal-microscopy.md#principle',
      dot: d('#B07C00'),
      status: 'Report, not confirmed',
      meta: '0 replies · 1 d',
      props: [
        { k: 'Opened by', v: 'Report from Light-sheet team' },
        { k: 'Kind', v: 'Report: outdated' },
      ],
      posts: [
        {
          ini: 'LT',
          bg: '#F1F2F5',
          who: 'l.tran',
          role: 'reader · Light-sheet',
          t: '1 d',
          ai: false,
          text: 'The pinhole size wording predates the hybrid detector we now use.',
        },
      ],
    },
    {
      f: 'closed',
      title: 'Should STED page cite vendor docs?',
      where: 'sted-microscopy.md#principle',
      dot: d('#8A909C'),
      status: 'Resolved',
      meta: '4 replies · 3 d',
      props: [
        { k: 'Closed by', v: 'h.pham · resolved' },
        { k: 'Rationale', v: 'Use the 2019 review article instead.' },
      ],
      posts: [
        {
          ini: 'AT',
          bg: '#E7ECFA',
          who: 'a.tran',
          role: 'contributor',
          t: '3 d',
          ai: false,
          text: 'Is the vendor application note a good enough source?',
        },
      ],
    },
  ];
  const fdefs = [
    { id: 'open', label: 'Open 3' },
    { id: 'mine', label: 'Mine 2' },
    { id: 'closed', label: 'Closed 41' },
    { id: 'all', label: 'All' },
  ];
  return { all, fdefs };
})();

const Credibility = (() => {
  const stats = [
    { t: TL.checked, n: '427', delta: '41% · +6 this week' },
    { t: TL.reviewed, n: '479', delta: '46% · 22 by the agent this week' },
    { t: TL.recheck, n: '31', delta: '3% · 2 assigned to you' },
    { t: TL.error, n: '1', delta: 'Readers see a warning' },
    { t: TL.none, n: '104', delta: '10% · mostly imported in 2023' },
  ];
  const Q = [
    {
      t: TL.recheck,
      kind: 'Source retracted',
      ai: false,
      where: 'Deconvolution › Richardson–Lucy',
      reach: 'Linked from 6 pages · used by 3 teams · copied once',
      why: 'Crossref marks Okafor et al. 2019 as retracted (21 Nov). The iteration count in this section comes from that paper.',
      props: [
        { k: 'Found by', v: 'retraction_check job, 21 Nov 02:10' },
        { k: 'Readers see', v: 'Under re-check, since 21 Nov' },
        { k: 'Source checks', v: '2 on this version, now not counting' },
        { k: 'Assigned to', v: 'm.nguyen, h.pham' },
      ],
      down: [
        'Protocols › Deconvolution steps (copy of this section)',
        'Image processing › Restoration overview (links here)',
      ],
      decideTitle: 'Decide what readers should see',
      outcomes: [
        {
          label: 'Still correct with another source',
          hint: 'Record a source check against a replacement; back to its earlier label',
        },
        {
          label: 'Wrong: mark as confirmed error',
          hint: 'Readers see a red warning until someone fixes it',
        },
        { label: 'Keep under re-check', hint: 'Needs more work; stays on this list' },
      ],
    },
    {
      t: TL.recheck,
      kind: 'New report: wrong',
      ai: false,
      where: 'Sample mounting › Refractive index',
      reach: 'Linked from 9 pages · used by 4 teams',
      why: 'A reader in Cell biology says the glycerol 80% value should be 1.44, not 1.47. Marked “blocking my work”.',
      props: [
        { k: 'Reported by', v: 's.vo · Cell biology · 40 min ago' },
        { k: 'Readers see', v: 'Reviewed (unchanged until you confirm)' },
        { k: 'Quote', v: '“80% glycerol: n = 1.47”' },
      ],
      down: ['Confocal microscopy › Resolution uses this table'],
      decideTitle: 'Confirm or dismiss the report',
      outcomes: [
        {
          label: 'Confirm',
          hint: 'Section goes under re-check for everyone; the reporter is told',
        },
        { label: 'Confirm and fix now', hint: 'Opens the editor with the quote selected' },
        { label: 'Dismiss with a reason', hint: 'The reporter sees your reason and can reply' },
      ],
    },
    {
      t: TL.reviewed,
      kind: 'Possible copy',
      ai: true,
      where: 'Light-sheet microscopy › Overview',
      reach: 'Matches Confocal microscopy › Overview at 82%',
      why: 'The first two sentences match closely. If it is a copy, it should follow changes to the original and not count as independent support.',
      props: [
        { k: 'Found by', v: 'copy_candidates job · claude-sonnet-5-5' },
        { k: 'Effect if confirmed', v: 'Corroboration between the two stops counting' },
      ],
      down: ['No reader-visible change'],
      decideTitle: 'Is this a copy?',
      outcomes: [
        { label: 'Yes, it is copied from the original', hint: 'Records a copy link' },
        { label: 'No, written independently', hint: 'The pair is not suggested again' },
        { label: 'Not sure, ask the authors', hint: 'Opens a discussion' },
      ],
    },
    {
      t: TL.reviewed,
      kind: 'Possible contradiction',
      ai: true,
      where: 'Point spread function › FWHM',
      reach: 'Disagrees with Deconvolution › PSF model',
      why: 'One says FWHM = 0.51 λ/NA, the other 0.61 λ/NA. A discussion is already open.',
      props: [
        { k: 'Found by', v: 'relation_candidates job' },
        { k: 'Discussion', v: 'Lateral FWHM differs between two pages (3 replies)' },
      ],
      down: ['psf-fwhm-table is held until this is settled'],
      decideTitle: 'Do they really disagree?',
      outcomes: [
        { label: 'Yes, one of them is wrong', hint: 'The wrong one goes under re-check' },
        { label: 'No, they say different things', hint: 'Suggest clearer wording instead' },
        { label: 'Leave to the discussion', hint: 'Decide when it closes' },
      ],
    },
    {
      t: TL.recheck,
      kind: 'Report confirmed, fix in review',
      ai: false,
      where: 'Confocal microscopy › Principle',
      reach: 'Linked from 14 pages · used by 4 teams',
      why: 'Outdated pinhole wording. The fix fix-pinhole-units is escalated to you.',
      props: [
        { k: 'Confirmed by', v: 'm.nguyen, 22 Nov' },
        { k: 'Fix', v: 'fix-pinhole-units · escalated' },
      ],
      down: ['Pinhole alignment › Choosing the size links here'],
      decideTitle: 'Close when the fix is published',
      outcomes: [
        { label: 'Wait for the fix', hint: 'Closes itself when the fix is published' },
        { label: 'Close: the text is fine after all', hint: 'Back to Reviewed' },
        { label: 'Mark as confirmed error', hint: 'If the fix will take long' },
      ],
    },
  ];
  const cov = [
    {
      page: 'Confocal microscopy',
      k: 'recheck',
      a: 1,
      b: 2,
      c: 1,
      d: 1,
      oldest: 'History (2023)',
      readers: '212 · 4 teams',
    },
    {
      page: 'Deconvolution',
      k: 'recheck',
      a: 0,
      b: 3,
      c: 1,
      d: 0,
      oldest: 'Wiener filter (Mar)',
      readers: '140 · 3 teams',
    },
    {
      page: 'Sample mounting',
      k: 'reviewed',
      a: 1,
      b: 4,
      c: 0,
      d: 0,
      oldest: 'Clearing (Jun)',
      readers: '188 · 5 teams',
    },
    {
      page: 'Point spread function',
      k: 'reviewed',
      a: 2,
      b: 3,
      c: 0,
      d: 0,
      oldest: 'Measuring (Aug)',
      readers: '96 · 2 teams',
    },
    {
      page: 'STED microscopy',
      k: 'none',
      a: 0,
      b: 1,
      c: 0,
      d: 3,
      oldest: '3 sections (new page)',
      readers: '18 · 1 team',
    },
    {
      page: 'Booking and access',
      k: 'checked',
      a: 4,
      b: 0,
      c: 0,
      d: 0,
      oldest: '—',
      readers: '402 · 9 teams',
    },
  ];
  const dot = (col: string) => 'width: 8px; height: 8px; border-radius: 4px; background: ' + col;
  const sources = [
    {
      path: 'sources/okafor-2019-rl.md',
      tier: 'Peer-reviewed',
      status: 'Retracted 21 Nov',
      dot: dot('#C33027'),
      cited: '1 section · 1 copy',
      checked: 'Crossref, today 02:10',
    },
    {
      path: 'sources/pawley-handbook.md',
      tier: 'Handbook',
      status: 'OK · archived copy',
      dot: dot('#1E7F45'),
      cited: '23 sections',
      checked: 'Crossref, today 02:10',
    },
    {
      path: 'sources/zeiss-lsm980-manual.md',
      tier: 'Vendor manual',
      status: 'OK · archived copy',
      dot: dot('#1E7F45'),
      cited: '17 sections',
      checked: 'Link check, today',
    },
    {
      path: 'sources/vendor-detectors-web.md',
      tier: 'Vendor web page',
      status: 'Changed since cited',
      dot: dot('#B07C00'),
      cited: '2 sections',
      checked: 'Link check, today',
    },
    {
      path: 'sources/lab-notebook-2024-03.md',
      tier: 'Internal data',
      status: 'OK',
      dot: dot('#1E7F45'),
      cited: '4 sections',
      checked: 'Not checkable automatically',
    },
  ];
  const tdefs = [
    { id: 'queue', label: 'Needs a person', n: '5' },
    { id: 'coverage', label: 'Pages', n: '128' },
    { id: 'sources', label: 'Sources', n: '86' },
  ];
  return { stats, Q, cov, sources, tdefs };
})();

const Ops = (() => {
  const dot = (c: string) => 'width: 8px; height: 8px; border-radius: 4px; background: ' + c;
  const g = dot('#1E7F45'),
    a = dot('#B07C00'),
    r = dot('#C33027');
  const health = [
    { dot: g, label: 'API and storage', value: 'OK', note: 'Last write 3 min ago' },
    { dot: r, label: 'Blocked targets', value: '1', note: 'deconvolution.md' },
    { dot: g, label: 'Worker queue', value: '3 jobs', note: 'Oldest 40 s' },
    { dot: a, label: 'Model provider', value: 'Slow', note: 'p95 38 s · claude-sonnet-5-5' },
    { dot: g, label: 'Backups', value: 'OK', note: 'Nightly, 02:00' },
  ];
  const agent = [
    { k: 'Proposals decided', v: '86' },
    { k: 'Approved and auto-published', v: '61' },
    { k: 'Sent back for revision', v: '14' },
    { k: 'Escalated to page authors', v: '11' },
    { k: 'Approvals refused by triggers', v: '9' },
    { k: 'Spot checks passed', v: '6 of 6' },
    { k: 'Reverted after publishing', v: '0' },
  ];
  const jobs = [
    { name: 'quality_check', last: '10:07 · 1 min 40 s', result: 'OK', dot: g, queue: '1 waiting' },
    { name: 'agent_review', last: '10:09 · 52 s', result: 'OK', dot: g, queue: '0' },
    {
      name: 'retraction_check',
      last: '02:10 · 86 sources',
      result: '1 retraction found',
      dot: a,
      queue: 'Daily',
    },
    { name: 'copy_candidates', last: '03:00', result: '1 candidate', dot: g, queue: 'Daily' },
    { name: 'relation_candidates', last: '03:20', result: '1 candidate', dot: g, queue: 'Daily' },
    {
      name: 'credibility_score',
      last: '03:40 · shadow',
      result: 'OK, not shown to readers',
      dot: g,
      queue: 'Daily',
    },
  ];
  return { health, agent, jobs };
})();

const Settings = (() => {
  const on =
    'flex: 0 0 16px; height: 16px; margin-top: 1px; box-sizing: border-box; border-radius: 4px; display: inline-flex; align-items: center; justify-content: center; background: #2453D6';
  const off =
    'flex: 0 0 16px; height: 16px; margin-top: 1px; box-sizing: border-box; border-radius: 4px; border: 1.5px solid #8A909C; background: #FFFFFF';
  const lk = (label: string, help: string, value: string, note?: string) => ({
    label,
    help,
    value,
    note: note || '',
    isLocked: true,
    isText: false,
    isList: false,
    items: [],
  });
  const tx = (label: string, help: string, value: string, note?: string) => ({
    label,
    help,
    value,
    note: note || '',
    isLocked: false,
    isText: true,
    isList: false,
    items: [],
  });
  const ls = (
    label: string,
    help: string,
    items: { t: string; note: string; box: string }[],
    note?: string,
  ) => ({
    label,
    help,
    value: '',
    note: note || '',
    isLocked: false,
    isText: false,
    isList: true,
    items,
  });
  const T = {
    review: [
      tx(
        'Review model',
        'Who decides proposals by default.',
        'Self-managed: the reviewer agent decides, page authors take escalations',
      ),
      lk(
        'Auto-publish',
        'Set by the server environment.',
        'AUTO_PUBLISH=true',
        'Every approval is published at once through the normal conditional write.',
      ),
      ls(
        'Always escalate to page authors when',
        'The API refuses an agent approval if any of these apply.',
        [
          { t: 'An open dispute, hold or report', note: ' · built-in', box: on },
          { t: 'A high-severity quality finding', note: ' · built-in', box: on },
          {
            t: 'A number, unit or negation changes in a sentence with a source',
            note: ' · built-in',
            box: on,
          },
          { t: 'A claim is added to a sentence with a source', note: ' · built-in', box: on },
          { t: 'A retracted or low-tier source is cited', note: ' · built-in', box: on },
          { t: 'An agent edits a page written by people', note: '', box: on },
          { t: 'Any change under wiki-meta/', note: ' · built-in', box: on },
        ],
      ),
      tx(
        'Page authors',
        'Who gets escalations for a page.',
        'wiki-meta/owners.md, then people whose changes were published, then the owner',
      ),
      tx(
        'Spot checks',
        'Share of agent approvals sent to page authors after publishing.',
        '10%',
        'A failed spot check is recorded as a confirmed error.',
      ),
      tx('Reminders', 'Nothing is ever decided by timeout.', 'Every 3 days, then weekly'),
      tx('Quality check', 'Runs before the reviewer agent.', 'On every submission'),
    ],
    trust: [
      lk(
        'How labels are decided',
        'Fixed rules, worst section wins. Not changeable here.',
        'confirmed error > under re-check > not reviewed > checked > reviewed',
        'Shown to readers as words plus an icon, never a number.',
      ),
      ls('What readers can do', 'Buttons shown on every section.', [
        { t: 'Useful', note: '', box: on },
        { t: 'I checked a source', note: ' · needed for Checked against source', box: on },
        { t: 'I used it in practice', note: ' · recorded, not counted yet (E8b)', box: on },
        { t: 'Report a problem', note: '', box: on },
      ]),
      ls('What readers see of others', 'Keeps answers independent.', [
        { t: 'Hide counts until the reader has answered', note: '', box: on },
        { t: 'Show team counts only, never names', note: ' · always on', box: on },
        { t: 'Show the shadow score to page authors', note: ' · off until E8d', box: off },
      ]),
      tx(
        'Report urgency',
        'When page authors hear about a report.',
        'Daily summary; at once when the reader marks it blocking',
      ),
      tx(
        'Who can confirm a report',
        'Confirming puts a section under re-check for everyone.',
        'Page authors of that page, and the owner',
      ),
      tx('Retraction check', 'Looks up cited papers in Crossref.', 'Daily at 02:10'),
      tx(
        'Keep attestation history',
        'Raw events, for measuring whether they predict accuracy.',
        '90 days',
      ),
    ],
    people: [
      tx('Sign-in', 'Local accounts for now.', 'Email and password · SSO later'),
      tx(
        'Teams',
        'Used for team counts on attestations.',
        'Imaging core, Light-sheet, Cell biology, Image analysis, +5',
      ),
      tx(
        'Roles',
        'Everyone can read and suggest. Roles add the Workspace.',
        'reader · contributor · reviewer · owner',
      ),
    ],
    agents: [
      tx(
        'reviewer-agent',
        'Decides proposals.',
        'Token …9f2a · scopes review:decide, discuss:write',
      ),
      tx(
        'lab-agent',
        'Submits proposals through the API and MCP.',
        'Token …41c0 · scopes proposals:write',
      ),
      tx('Token lifetime', '', '90 days, rotate from here'),
    ],
    models: [
      tx('Reviewer agent', '', 'claude-opus-5-5 · prompt v3'),
      tx('Quality check and candidate jobs', '', 'claude-sonnet-5-5'),
      tx(
        'Local model',
        'OpenAI-compatible endpoint, for teams that can’t send text out.',
        'http://models.internal:8000 · qwen3.8',
      ),
    ],
    storage: [
      lk(
        'Wiki root',
        'Markdown files on local disk. NestJS is the only writer.',
        '/srv/md-wiki/wiki',
      ),
      tx('Backups', '', 'Nightly at 02:00, kept 30 days'),
    ],
  };
  const tdefs = [
    { id: 'review', label: 'Review and publishing' },
    { id: 'trust', label: 'Trust labels' },
    { id: 'people', label: 'People and teams' },
    { id: 'agents', label: 'Agents and tokens' },
    { id: 'models', label: 'Models' },
    { id: 'storage', label: 'Storage' },
  ];
  return { T, tdefs };
})();

const TopBar = (() => {
  const defs = [
    { id: 'home', label: 'Home', href: 'Main.dc.html' },
    { id: 'browse', label: 'Browse', href: 'Page.dc.html' },
    { id: 'recent', label: 'Recent changes', href: 'Main.dc.html#recent' },
  ];
  return { defs, initials: { reader: 'LT', 'page author': 'MN' } };
})();

const WorkNav = (() => {
  const c = (cx: number, cy: number, r: number) => {
    const left = String(cx - r);
    const radius = String(r);
    const diameter = String(2 * r);
    return `M${left} ${String(cy)}a${radius} ${radius} 0 1 0 ${diameter} 0a${radius} ${radius} 0 1 0 -${diameter} 0`;
  };
  const groups = [
    {
      title: 'Your work',
      items: [
        {
          id: 'inbox',
          label: 'Inbox',
          href: 'Inbox.dc.html',
          count: '4',
          strong: true,
          d1: 'M3 13h5l1.5 2h5l1.5-2h5',
          d2: 'M5.5 5h13L21 13v6H3v-6z',
        },
        {
          id: 'proposals',
          label: 'Proposals',
          href: 'Proposals.dc.html',
          count: '6',
          d1: c(6, 6, 2.5) + c(6, 18, 2.5) + c(18, 18, 2.5),
          d2: 'M6 8.5v7M18 15.5V9a3 3 0 0 0-3-3h-4',
        },
        {
          id: 'discussions',
          label: 'Discussions',
          href: 'Discussions.dc.html',
          count: '3',
          d1: 'M4 5h16v11H9l-5 4z',
          d2: 'M8 9.5h8M8 12.5h5',
        },
      ],
    },
    {
      title: 'Trust',
      items: [
        {
          id: 'recheck',
          label: 'Credibility',
          href: 'Credibility.dc.html',
          count: '2',
          strong: true,
          d1: 'M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z',
          d2: 'M9 12l2 2 4-4',
        },
      ],
    },
    {
      title: 'Owner',
      items: [
        {
          id: 'ops',
          label: 'Operations',
          href: 'Ops.dc.html',
          count: '1',
          strong: true,
          d1: 'M3 12h4l3-7 4 14 3-7h4',
          d2: '',
        },
        {
          id: 'settings',
          label: 'Settings',
          href: 'Settings.dc.html',
          count: '',
          d1: c(12, 12, 3),
          d2: 'M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1',
        },
      ],
    },
  ];
  return { groups };
})();

export const frameSamples = {
  Main,
  Search,
  Page,
  Trust,
  You,
  Editor,
  Conflict,
  Inbox,
  Proposals,
  Review,
  Discussions,
  Credibility,
  Ops,
  Settings,
  TopBar,
  WorkNav,
};
