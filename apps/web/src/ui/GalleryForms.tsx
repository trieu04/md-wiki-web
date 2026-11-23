import { useId } from 'react';
import { Checkbox } from './Checkbox';
import { GalleryExample as Example } from './GalleryExample';
import { Radio } from './Radio';
import { RadioCards } from './RadioCards';
import type { RadioCardOption } from './RadioCards';
import { SearchInput } from './SearchInput';
import { Select } from './Select';
import { Switch } from './Switch';
import { Textarea } from './Textarea';
import { TextInput } from './TextInput';
import { TrustIcon } from './TrustIcon';

const results: RadioCardOption[] = [
  {
    value: 'supports',
    label: 'It supports the text',
    description: 'The section says what the source says',
  },
  { value: 'partly', label: 'Partly', description: 'Some of it matches, some doesn’t' },
  {
    value: 'contradicts',
    label: 'It contradicts the text',
    description: 'This also sends a report to the page authors',
  },
  {
    value: 'cant',
    label: 'I couldn’t check',
    description: 'Paywall, missing page, can’t find the passage',
  },
];
const conflicts: RadioCardOption[] = [
  { value: 'merge', label: 'Combine both', description: 'Keep the new wording and add your table' },
  {
    value: 'mine',
    label: 'Replace with mine',
    description: 'Your table replaces the new wording; reviewers see both diffs',
  },
  { value: 'drop', label: 'Drop my change', description: 'The current page already says enough' },
];
const decisions: RadioCardOption[] = [
  { value: 'approve', label: 'Approve and publish', description: 'published at once' },
  {
    value: 'changes',
    label: 'Request changes',
    description: 'back to the author with your reason',
  },
  { value: 'hold', label: 'Hold for discussion', description: 'opens a dispute on the section' },
];

export function SourceRadios() {
  const name = useId();
  return (
    <fieldset className="flex min-w-0 flex-col gap-6px">
      <legend className="pb-6px font-semibold">Which source did you check?</legend>
      <Radio
        variant="form"
        name={name}
        value="pawley"
        defaultChecked
        label={
          <>
            Pawley, Table 2.1 <span className="text-muted">· handbook · archived copy</span>
          </>
        }
      />
      <Radio
        variant="form"
        name={name}
        value="another"
        label={
          <>
            Another source <span className="text-muted">· add a link or file</span>
          </>
        }
      />
    </fieldset>
  );
}

export function SourceResults() {
  return <RadioCards label="What did you find?" options={results} defaultValue="supports" />;
}

export function DecisionOptions() {
  return (
    <RadioCards label="Outcome" variant="decision" options={decisions} defaultValue="approve" />
  );
}

export function DecisionReason() {
  return (
    <Textarea
      label="Reason (required)"
      variant="compact"
      rows={3}
      required
      placeholder="Claims and sources you checked, and why the decision follows"
    />
  );
}

export function FormExamples() {
  return (
    <section aria-labelledby="gallery-forms" className="flex min-w-0 flex-col gap-12px">
      <h2 id="gallery-forms" className="text-20 font-semibold">
        Form primitives
      </h2>
      <Example id="SearchInput/topbar">
        <div className="flex">
          <SearchInput
            size="topbar"
            label="Search the wiki in the top bar"
            placeholder="Search pages, methods, instruments"
          />
        </div>
      </Example>
      <Example id="SearchInput/home" canvas>
        <div className="flex max-w-home-search-max">
          <SearchInput
            size="home"
            label="Search the wiki from home"
            placeholder="What do you need to know? e.g. pinhole size for a 63x objective"
          />
        </div>
      </Example>
      <Example id="TextInput/default">
        <TextInput label="Where in the source" defaultValue="Table 2.1, p. 34" />
      </Example>
      <Example id="Textarea/default">
        <Textarea
          label={
            <>
              Note <span className="font-normal text-muted">(optional)</span>
            </>
          }
        />
      </Example>
      <Example id="Textarea/excerpt">
        <Textarea
          label="Which part?"
          variant="excerpt"
          hint="Filled from your selection on the page."
          defaultValue="Axial resolution is two to three times worse."
        />
      </Example>
      <Example id="Select/default">
        <Select label="How">
          <option>In the wiki and a daily email</option>
          <option>In the wiki only</option>
          <option>Slack or Teams message</option>
        </Select>
      </Example>
      <Example id="Checkbox/checked">
        <Checkbox
          label="Checked against source"
          icon={<TrustIcon label="checked" />}
          count={12}
          defaultChecked
        />
      </Example>
      <Example id="Checkbox/unchecked">
        <Checkbox label="Checked against source" icon={<TrustIcon label="checked" />} count={12} />
      </Example>
      <Example id="Radio/filter">
        <fieldset className="flex flex-col gap-8px">
          <legend className="sr-only">Updated</legend>
          <Radio name="gallery-updated" label="Any time" value="any" defaultChecked />
          <Radio name="gallery-updated" label="Last 30 days" value="month" />
          <Radio name="gallery-updated" label="Last year" value="year" />
        </fieldset>
      </Example>
      <Example id="Radio/form">
        <SourceRadios />
      </Example>
      <Example id="RadioCards/trust">
        <SourceResults />
      </Example>
      <Example id="RadioCards/conflict">
        <RadioCards
          label="Conflict outcome"
          options={conflicts}
          variant="conflict"
          defaultValue="merge"
        />
      </Example>
      <Example id="RadioCards/decision">
        <DecisionOptions />
      </Example>
      <Example id="Textarea/compact">
        <DecisionReason />
      </Example>
      <Example id="Switch/on">
        <Switch label="A section I used goes under re-check" defaultChecked />
      </Example>
      <Example id="Switch/off">
        <Switch label="Weekly summary of followed pages" />
      </Example>
      <p className="text-muted">
        D-42: The top-bar search placeholder uses text.muted for AA contrast on canvas and
        intentionally differs from the C-TopBar crop. The home search keeps the frame’s native
        placeholder colour on white.
      </p>
    </section>
  );
}

export function UndrawnFormExamples() {
  return (
    <>
      <Example id="TextInput/disabled">
        <TextInput label="Unavailable source location" disabled defaultValue="Table 2.1, p. 34" />
      </Example>
      <Example id="Textarea/disabled">
        <Textarea label="Unavailable note" disabled />
      </Example>
      <Example id="SearchInput/disabled">
        <div className="flex">
          <SearchInput size="home" disabled label="Search unavailable" />
        </div>
      </Example>
      <Example id="Select/disabled">
        <Select label="Unavailable delivery method" disabled>
          <option>In the wiki only</option>
        </Select>
      </Example>
      <Example id="Checkbox/disabled">
        <Checkbox label="Unavailable trust filter" defaultChecked disabled />
      </Example>
      <Example id="Radio/disabled">
        <Radio name="disabled-radio" label="Unavailable date filter" disabled />
      </Example>
      <Example id="RadioCards/disabled">
        <RadioCards
          label="Unavailable conflict outcome"
          options={conflicts.slice(0, 1)}
          defaultValue="merge"
          disabled
        />
      </Example>
      <Example id="Switch/disabled">
        <Switch label="Unavailable notification preference" disabled />
      </Example>
      <Example id="TextInput/invalid">
        <TextInput
          label="Source location"
          hint="Use a page or table number."
          error="Enter a location."
          required
        />
      </Example>
      <Example id="TextInput/focus">
        <TextInput label="Focus this field with Tab" />
      </Example>
    </>
  );
}
