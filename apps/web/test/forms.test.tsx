import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { Checkbox } from '../src/ui/Checkbox';
import { FormExamples, UndrawnFormExamples } from '../src/ui/GalleryForms';
import { RadioCards } from '../src/ui/RadioCards';
import { SearchInput } from '../src/ui/SearchInput';
import { Switch } from '../src/ui/Switch';
import { TextInput } from '../src/ui/TextInput';

function gallery(id: string) {
  const sample = document.querySelector<HTMLElement>(`[data-gallery="${id}"]`);
  if (!sample) throw new Error(`Missing gallery example: ${id}`);
  return within(sample);
}
afterEach(cleanup);

it('associates field labels with native controls and supports typing and selecting', async () => {
  const user = userEvent.setup();
  render(<FormExamples />);
  const home = screen.getByRole('searchbox', { name: 'Search the wiki from home' });
  expect(screen.getByLabelText('Search the wiki from home')).toBe(home);
  expect(screen.getByRole('searchbox', { name: 'Search the wiki in the top bar' })).toBeEnabled();
  expect(gallery('SearchInput/topbar').getByText('⌘K')).toHaveAttribute('aria-hidden', 'true');
  const text = screen.getByLabelText('Where in the source');
  expect(text).toHaveValue('Table 2.1, p. 34');
  await user.type(home, 'pinhole');
  expect(home).toHaveValue('pinhole');
  const note = screen.getByRole('textbox', { name: 'Note (optional)' });
  await user.type(note, 'A note');
  expect(note).toHaveValue('A note');
  expect(screen.getByRole('textbox', { name: 'Which part?' })).toHaveAccessibleDescription(
    'Filled from your selection on the page.',
  );
  const select = screen.getByRole('combobox', { name: 'How' });
  expect(select).toBe(screen.getByLabelText('How'));
  await user.selectOptions(select, 'In the wiki only');
  expect(select).toHaveValue('In the wiki only');
});

it('lets the containing form handle SearchInput submission', async () => {
  const user = userEvent.setup();
  const submit = vi.fn((event: React.SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
  });
  render(
    <form onSubmit={submit}>
      <SearchInput size="topbar" label="Search" name="q" />
    </form>,
  );
  await user.type(screen.getByRole('searchbox'), 'methods{Enter}');
  expect(submit).toHaveBeenCalledOnce();
});

it('toggles checked and unchecked checkboxes and switches with Space', async () => {
  const user = userEvent.setup();
  render(<FormExamples />);
  for (const [id, role, initiallyChecked] of [
    ['Checkbox/checked', 'checkbox', true],
    ['Checkbox/unchecked', 'checkbox', false],
    ['Switch/on', 'switch', true],
    ['Switch/off', 'switch', false],
  ] as const) {
    const control = gallery(id).getByRole(role);
    expect(control.matches(':checked') || control.getAttribute('aria-checked') === 'true').toBe(
      initiallyChecked,
    );
    control.focus();
    await user.keyboard(' ');
    expect(control.matches(':checked') || control.getAttribute('aria-checked') === 'true').toBe(
      !initiallyChecked,
    );
    await user.keyboard(' ');
    expect(control.matches(':checked') || control.getAttribute('aria-checked') === 'true').toBe(
      initiallyChecked,
    );
  }
  await user.click(gallery('Checkbox/checked').getByText('Checked against source'));
  expect(gallery('Checkbox/checked').getByRole('checkbox')).not.toBeChecked();
});

it('uses native radio keyboard behavior in each group and skips disabled options', async () => {
  const user = userEvent.setup();
  render(
    <>
      <FormExamples />
      <RadioCards
        label="Sample outcomes"
        options={[
          { value: 'first', label: 'First' },
          { value: 'disabled', label: 'Disabled', disabled: true },
          { value: 'last', label: 'Last', description: 'Description' },
        ]}
        defaultValue="first"
      />
    </>,
  );
  const initial = screen.getByRole('radio', { name: 'Any time' });
  initial.focus();
  await user.keyboard('{ArrowDown}');
  const month = screen.getByRole('radio', { name: 'Last 30 days' });
  expect(month).toHaveFocus();
  expect(month).toBeChecked();
  expect(initial).not.toBeChecked();
  await user.keyboard('{ArrowUp}{ArrowLeft}');
  expect(screen.getByRole('radio', { name: 'Last year' })).toBeChecked();
  const group = within(screen.getByRole('radiogroup', { name: 'Sample outcomes' }));
  group.getByRole('radio', { name: 'First' }).focus();
  await user.keyboard('{ArrowRight}');
  const last = group.getByRole('radio', { name: 'Last' });
  expect(last).toBeChecked();
  expect(last).toHaveFocus();
  expect(last).toHaveAccessibleDescription('Description');
  expect(screen.getByRole('radio', { name: 'It supports the text' })).toBeChecked();
});

it('exposes §6.1 disabled and invalid states without losing accessible descriptions', async () => {
  const user = userEvent.setup();
  render(
    <>
      <UndrawnFormExamples />
      <TextInput
        id="test-input"
        label="With descriptions"
        hint="Hint"
        error="Error"
        aria-describedby="extra"
      />
      <p id="extra">Extra</p>
    </>,
  );
  const controls = [
    screen.getByRole('textbox', { name: 'Unavailable source location' }),
    screen.getByRole('textbox', { name: 'Unavailable note' }),
    screen.getByRole('searchbox', { name: 'Search unavailable' }),
    screen.getByRole('combobox', { name: 'Unavailable delivery method' }),
    screen.getByRole('checkbox', { name: 'Unavailable trust filter' }),
    screen.getByRole('radio', { name: 'Unavailable date filter' }),
    screen.getByRole('radio', { name: 'Combine both' }),
    screen.getByRole('switch', { name: 'Unavailable notification preference' }),
  ];
  for (const control of controls) expect(control).toBeDisabled();
  const invalid = screen.getByRole('textbox', { name: 'Source location' });
  expect(invalid).toBeInvalid();
  expect(invalid).toHaveAccessibleDescription('Use a page or table number. Enter a location.');
  expect(screen.getByRole('textbox', { name: 'With descriptions' })).toHaveAccessibleDescription(
    'Extra Hint Error',
  );
  await user.tab();
  expect(invalid).toHaveFocus();
  await user.tab();
  expect(screen.getByRole('textbox', { name: 'Focus this field with Tab' })).toHaveFocus();
});

it('does not send disabled toggle events', async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(
    <>
      <Switch label="Off" disabled onChange={onChange} />
      <Checkbox label="Unavailable" disabled onChange={onChange} />
    </>,
  );
  await user.click(screen.getByRole('switch'));
  await user.click(screen.getByText('Unavailable'));
  expect(onChange).not.toHaveBeenCalled();
});
