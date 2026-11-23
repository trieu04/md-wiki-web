export type PublishStep = { label: string; state: 'done' | 'current' | 'todo' };

/** F-10 *Publish progress* (scenarios publishing and blocked): ✓ done, current…, later muted. */
export function PublishProgress({ steps }: { steps: readonly PublishStep[] }) {
  return (
    <ol
      aria-label="Publish progress"
      className="m-0 flex list-none flex-wrap gap-x-14px gap-y-6px p-0 text-13"
    >
      {steps.map(({ label, state }) => (
        <li
          key={label}
          aria-current={state === 'current' ? 'step' : undefined}
          className={
            state === 'current' ? 'font-semibold' : state === 'todo' ? 'text-trust-none' : ''
          }
        >
          {state === 'done' ? `✓ ${label}` : state === 'current' ? `${label}…` : label}
        </li>
      ))}
    </ol>
  );
}
