import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState, type ReactNode, type RefObject } from 'react';
import { useApi } from '../../lib/api';
import { messageForError } from '../../lib/error-copy';
import { Button } from '../../ui/Button';
import { Callout } from '../../ui/Callout';
import { Checkbox } from '../../ui/Checkbox';
import { Drawer } from '../../ui/Drawer';
import { PillToggle } from '../../ui/PillToggle';
import { QueryFailure } from '../../ui/QueryFailure';
import { RadioCards } from '../../ui/RadioCards';
import { Select } from '../../ui/Select';
import { Tabs } from '../../ui/Tabs';
import { TextInput } from '../../ui/TextInput';
import { Textarea } from '../../ui/Textarea';
import { TrustIcon } from '../../ui/TrustIcon';
import {
  CHECK_RESULTS,
  REPORT_KINDS,
  TRUST_MODES,
  USE_KINDS,
  WORKED,
  canUndo,
  checkInput,
  checkSubmitLabel,
  doneModel,
  emptyCheckForm,
  emptyReportForm,
  emptyUseForm,
  reportInput,
  usedInput,
  whyModel,
  type AttestationResultDto,
  type CheckForm,
  type FormErrors,
  type ReportForm,
  type SectionTarget,
  type TrustMode,
  type UseForm,
  type WhyDto,
} from './model';
import { useTrustMutations, whyQueryOptions } from './queries';

const overline = 'text-12 font-semibold tracking-overline text-secondary uppercase';
const panelClass = 'flex flex-col gap-16px px-22px pt-16px pb-24px';

function GroupLabel({ children }: { children: ReactNode }) {
  return <span className="text-13 font-semibold">{children}</span>;
}

function Pills<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex flex-col gap-8px">
      <GroupLabel>{label}</GroupLabel>
      <div role="group" aria-label={label} className="flex flex-wrap gap-6px">
        {options.map((option) => (
          <PillToggle
            key={option.value}
            size="sort"
            pressed={value === option.value}
            onClick={() => {
              onChange(option.value);
            }}
          >
            {option.label}
          </PillToggle>
        ))}
      </div>
    </div>
  );
}

function WhyPanel({ why }: { why: WhyDto }) {
  const model = whyModel(why);
  return (
    <div className={panelClass}>
      <div className="flex flex-col gap-6px">
        <span className="inline-flex items-center gap-8px font-semibold">
          <TrustIcon label={model.label} size={14} />
          {model.labelText}
        </span>
        <p className="text-13 text-secondary">{model.meaning}</p>
      </div>
      <section aria-label="Evidence" className="flex flex-col gap-8px">
        <h3 className={overline}>Evidence, newest first</h3>
        {model.evidence.length ? (
          <ol className="flex flex-col">
            {model.evidence.map((row) => (
              <li key={row.key} className="flex gap-12px border-t border-row py-9px text-13">
                <time dateTime={row.at} className="w-trust-date shrink-0 text-muted">
                  {row.when}
                </time>
                <span className="flex min-w-0 flex-col">
                  <span>{row.what}</span>
                  {row.meta && <span className="text-12 text-muted">{row.meta}</span>}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-13 text-muted">No evidence recorded for this section yet.</p>
        )}
      </section>
      {!!model.changeIt.length && (
        <section aria-label="What would change it" className="flex flex-col gap-8px">
          <h3 className={overline}>What would change it</h3>
          <ul className="flex list-disc flex-col gap-4px pl-18px text-13">
            {model.changeIt.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
      )}
      <p className="border-t border-row pt-10px text-12 text-muted">{model.note}</p>
    </div>
  );
}

function errorsFor(errors: FormErrors, key: string) {
  return errors[key];
}

function CheckPanel({
  section,
  cited,
  busy,
  error,
  onSubmit,
}: {
  section: SectionTarget;
  cited: readonly { value: string; label: string }[];
  busy: boolean;
  error: Error | null;
  onSubmit: (form: CheckForm) => FormErrors | undefined;
}) {
  const [form, setForm] = useState(() => emptyCheckForm(cited.map(({ value }) => value)));
  const [errors, setErrors] = useState<FormErrors>({});
  const set = (patch: Partial<CheckForm>) => {
    setForm((current) => ({ ...current, ...patch }));
  };
  return (
    <form
      className={panelClass}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        setErrors(onSubmit(form) ?? {});
      }}
    >
      <RadioCards
        label="Which source did you check?"
        value={form.source}
        onChange={(source) => {
          set({ source });
        }}
        options={[
          ...cited.map(({ value, label }) => ({
            value,
            label,
            description: 'cited in this page',
          })),
          { value: '', label: 'Another source', description: 'add a link, DOI or title' },
        ]}
      />
      {form.source === '' && (
        <TextInput
          label="Source"
          hint="A DOI, a link or a title"
          value={form.otherSource}
          maxLength={500}
          error={errorsFor(errors, 'source')}
          onChange={(event) => {
            set({ otherSource: event.target.value });
          }}
        />
      )}
      {form.source !== '' && errors.source && (
        <p className="text-12 text-trust-error-fg">{errors.source}</p>
      )}
      <TextInput
        label="Where in the source"
        hint="Page, table, figure or section"
        value={form.location}
        maxLength={200}
        error={errorsFor(errors, 'location')}
        onChange={(event) => {
          set({ location: event.target.value });
        }}
      />
      <RadioCards
        label="What did you find?"
        value={form.result}
        onChange={(value) => {
          set({ result: value as CheckForm['result'] });
        }}
        options={CHECK_RESULTS.map(({ value, label, hint }) => ({
          value,
          label,
          description: hint,
        }))}
      />
      <Checkbox
        label="I compared the numbers, not only the wording"
        checked={form.comparedNumbers}
        onChange={(event) => {
          set({ comparedNumbers: event.target.checked });
        }}
      />
      <Textarea
        label="Note (optional)"
        value={form.note}
        rows={2}
        maxLength={2000}
        error={errorsFor(errors, 'note')}
        onChange={(event) => {
          set({ note: event.target.value });
        }}
      />
      <p className="text-12 text-muted">
        Saved against this version of {section.title}. If the section changes, your check stops
        counting and you’ll be asked to look again.
      </p>
      {error && (
        <Callout tone="error" title="Not saved.">
          {messageForError(error)}
        </Callout>
      )}
      <Button type="submit" className="self-start" loading={busy}>
        {checkSubmitLabel(form.result)}
      </Button>
    </form>
  );
}

function UsePanel({
  busy,
  error,
  onSubmit,
}: {
  busy: boolean;
  error: Error | null;
  onSubmit: (form: UseForm) => FormErrors | undefined;
}) {
  const [form, setForm] = useState<UseForm>(emptyUseForm);
  const [errors, setErrors] = useState<FormErrors>({});
  const set = (patch: Partial<UseForm>) => {
    setForm((current) => ({ ...current, ...patch }));
  };
  return (
    <form
      className={panelClass}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        setErrors(onSubmit(form) ?? {});
      }}
    >
      <Select
        label="What did you use it for?"
        value={form.use}
        onChange={(event) => {
          set({ use: event.target.value as UseForm['use'] });
        }}
      >
        {USE_KINDS.map(({ value, label }) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </Select>
      <Pills
        label="Did it work as written?"
        options={WORKED}
        value={form.worked}
        onChange={(worked) => {
          set({ worked });
        }}
      />
      {form.worked !== 'yes' && (
        <>
          <Textarea
            label="What did you have to change?"
            value={form.change}
            rows={3}
            maxLength={2000}
            error={errorsFor(errors, 'change')}
            onChange={(event) => {
              set({ change: event.target.value });
            }}
          />
          <p className="text-12 text-muted">
            If the page is wrong, also report it so the page authors see it.
          </p>
        </>
      )}
      <p className="text-12 text-muted">
        Saved for your team. It is shown to readers but doesn’t change the label yet: we first need
        to learn whether it predicts accuracy.
      </p>
      {error && (
        <Callout tone="error" title="Not saved.">
          {messageForError(error)}
        </Callout>
      )}
      <Button type="submit" className="self-start" loading={busy}>
        Save
      </Button>
    </form>
  );
}

function ReportPanel({
  quote,
  busy,
  error,
  onSubmit,
}: {
  quote: string;
  busy: boolean;
  error: Error | null;
  onSubmit: (form: ReportForm) => FormErrors | undefined;
}) {
  const [form, setForm] = useState(() => emptyReportForm(quote));
  const [errors, setErrors] = useState<FormErrors>({});
  const set = (patch: Partial<ReportForm>) => {
    setForm((current) => ({ ...current, ...patch }));
  };
  return (
    <form
      className={panelClass}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        setErrors(onSubmit(form) ?? {});
      }}
    >
      <Pills
        label="What’s the problem?"
        options={REPORT_KINDS}
        value={form.kind}
        onChange={(kind) => {
          set({ kind });
        }}
      />
      <Textarea
        label="Which part?"
        variant="excerpt"
        hint={quote ? 'Filled from your selection on the page.' : 'Quote the words, if you can.'}
        value={form.quote}
        rows={2}
        maxLength={2000}
        error={errorsFor(errors, 'quote')}
        onChange={(event) => {
          set({ quote: event.target.value });
        }}
      />
      <Textarea
        label="What should it say, and how do you know?"
        value={form.suggestion}
        rows={3}
        maxLength={4000}
        error={errorsFor(errors, 'suggestion')}
        onChange={(event) => {
          set({ suggestion: event.target.value });
        }}
      />
      <div className="flex flex-col gap-2px">
        <Checkbox
          label="This is blocking my work now"
          checked={form.blocking}
          onChange={(event) => {
            set({ blocking: event.target.checked });
          }}
        />
        <span className="pl-30px text-12 text-muted">
          The page authors are told at once instead of in their daily summary.
        </span>
      </div>
      <p className="text-12 text-muted">
        The page authors see your name so they can ask you. Other readers see “a reader in your
        team”.
      </p>
      {error && (
        <Callout tone="error" title="Not sent.">
          {messageForError(error)}
        </Callout>
      )}
      <Button type="submit" className="self-start" loading={busy}>
        Send report
      </Button>
    </form>
  );
}

function DonePanel({
  mode,
  result,
  sectionTitle,
  maintainers,
  undoBusy,
  undoError,
  onUndo,
  onClose,
}: {
  mode: Exclude<TrustMode, 'why'>;
  result: AttestationResultDto;
  sectionTitle: string;
  maintainers: readonly string[];
  undoBusy: boolean;
  undoError: Error | null;
  onUndo: () => void;
  onClose: () => void;
}) {
  const done = doneModel(mode, result, sectionTitle, maintainers);
  return (
    <div className={panelClass}>
      <Callout tone="success" title={done.title}>
        {done.text}
      </Callout>
      <section aria-label="What happens next" className="flex flex-col gap-8px">
        <h3 className={overline}>What happens next</h3>
        <ol className="flex flex-col gap-6px text-13">
          {done.next.map((line, index) => (
            <li key={line} className="flex gap-10px">
              <span className="inline-flex size-count shrink-0 items-center justify-center rounded-full bg-row text-12 font-semibold">
                {index + 1}
              </span>
              <span>{line}</span>
            </li>
          ))}
        </ol>
      </section>
      <section aria-label="On this version" className="flex flex-col gap-6px">
        <h3 className={overline}>On this version</h3>
        <p className="text-13 text-secondary">{done.counts}</p>
      </section>
      {undoError && (
        <Callout tone="error" title="Could not undo.">
          {messageForError(undoError)}
        </Callout>
      )}
      <div className="flex flex-wrap items-center gap-12px">
        {canUndo(result.attestation, new Date()) && (
          <Button variant="secondary" loading={undoBusy} onClick={onUndo}>
            Undo (10 min)
          </Button>
        )}
        <Link to="/me" search={{ tab: 'trust' }} className="text-13 font-medium">
          See it in your activity
        </Link>
        <Button variant="link" onClick={onClose}>
          Back to the page
        </Button>
      </div>
    </div>
  );
}

function NotAllowed({ children }: { children: ReactNode }) {
  return (
    <div className={panelClass}>
      <Callout tone="info" title="You can’t do this here.">
        {children}
      </Callout>
    </div>
  );
}

export type TrustDrawerProps = {
  open: boolean;
  onClose: () => void;
  triggerRef: RefObject<HTMLElement | null>;
  mode: TrustMode;
  onMode: (mode: TrustMode) => void;
  section: SectionTarget;
  pageTitle: string;
  maintainers: readonly string[];
  cited: readonly { value: string; label: string }[];
  quote: string;
  /** The viewer saw the counts before answering (sent as `sawCounts`). */
  sawCounts: boolean;
  signedIn: boolean;
};

export function TrustDrawer(props: TrustDrawerProps) {
  const { open, onClose, triggerRef, mode, onMode, section, pageTitle, signedIn } = props;
  const why = useQuery({
    ...whyQueryOptions(useApi(), section.path, section.anchor),
    enabled: open,
  });
  const mutations = useTrustMutations(section.path);
  const [done, setDone] = useState<{
    mode: Exclude<TrustMode, 'why'>;
    result: AttestationResultDto;
  } | null>(null);
  const pick = (next: TrustMode) => {
    setDone(null);
    mutations.attest.reset();
    mutations.report.reset();
    mutations.withdraw.reset();
    onMode(next);
  };
  const submitted =
    (submittedMode: Exclude<TrustMode, 'why'>) => (result: AttestationResultDto) => {
      setDone({ mode: submittedMode, result });
    };
  const can = why.data?.can;

  let body: ReactNode;
  if (why.isPending) body = <p className="px-22px py-16px text-13 text-muted">Loading…</p>;
  else if (why.isError)
    body = (
      <div className={panelClass}>
        <QueryFailure error={why.error} retry={() => void why.refetch()} busy={why.isFetching} />
      </div>
    );
  else if (mode === 'why') body = <WhyPanel why={why.data} />;
  else if (done && done.mode === mode)
    body = (
      <DonePanel
        mode={done.mode}
        result={done.result}
        sectionTitle={section.title}
        maintainers={props.maintainers}
        undoBusy={mutations.withdraw.isPending}
        undoError={mutations.withdraw.error}
        onUndo={() => {
          mutations.withdraw.mutate(done.result.attestation.id, {
            onSuccess: () => {
              setDone(null);
            },
          });
        }}
        onClose={onClose}
      />
    );
  else if (!signedIn)
    body = (
      <NotAllowed>
        <Link to="/login" search={{ next: globalThis.location.pathname }}>
          Sign in
        </Link>{' '}
        to record what you checked, used or found wrong.
      </NotAllowed>
    );
  else if (mode === 'report' && can && !can.report)
    body = <NotAllowed>You wrote this version of the section, so you can’t report it.</NotAllowed>;
  else if (mode !== 'report' && can && !can.attest)
    body = (
      <NotAllowed>
        You wrote or reviewed this version of the section, so your check would count twice. Ask
        someone else to check it.
      </NotAllowed>
    );
  else if (mode === 'check')
    body = (
      <CheckPanel
        key={section.sectionHash}
        section={section}
        cited={props.cited}
        busy={mutations.attest.isPending}
        error={mutations.attest.error}
        onSubmit={(form) => {
          const built = checkInput(form, section, props.sawCounts);
          if (!built.ok) return built.errors;
          mutations.attest.mutate(built.input, { onSuccess: submitted('check') });
          return undefined;
        }}
      />
    );
  else if (mode === 'use')
    body = (
      <UsePanel
        key={section.sectionHash}
        busy={mutations.attest.isPending}
        error={mutations.attest.error}
        onSubmit={(form) => {
          const built = usedInput(form, section, props.sawCounts);
          if (!built.ok) return built.errors;
          mutations.attest.mutate(built.input, { onSuccess: submitted('use') });
          return undefined;
        }}
      />
    );
  else
    body = (
      <ReportPanel
        key={`${section.sectionHash}:${props.quote}`}
        quote={props.quote}
        busy={mutations.report.isPending}
        error={mutations.report.error}
        onSubmit={(form) => {
          const built = reportInput(form, section, props.sawCounts);
          if (!built.ok) return built.errors;
          mutations.report.mutate(built.input, { onSuccess: submitted('report') });
          return undefined;
        }}
      />
    );

  return (
    <Drawer
      open={open}
      onClose={onClose}
      triggerRef={triggerRef}
      context={`${pageTitle} ›`}
      title={section.title}
      summary={
        why.data && (
          <span className="inline-flex items-center gap-8px text-13">
            <TrustIcon label={why.data.label.label} size={13} />
            <span className="font-semibold">{whyModel(why.data).labelText}</span>
            <span className="text-muted">· {whyModel(why.data).version}</span>
          </span>
        )
      }
    >
      <Tabs
        label="Section trust"
        variant="drawer"
        selected={mode}
        onChange={(id) => {
          pick(id as TrustMode);
        }}
        tabs={TRUST_MODES.map(({ id, label }) => ({
          id,
          label,
          panel: id === mode ? body : null,
        }))}
      />
    </Drawer>
  );
}
