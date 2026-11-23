import { messageForError } from '../lib/error-copy';
import { Button } from './Button';
import { Callout } from './Callout';

export function QueryFailure({
  error,
  retry,
  busy,
}: {
  error: unknown;
  retry: () => void;
  busy: boolean;
}) {
  return (
    <Callout
      tone="error"
      queryError
      title={messageForError(error)}
      action={
        <Button variant="secondary" loading={busy} onClick={retry}>
          Try again
        </Button>
      }
    >
      {null}
    </Callout>
  );
}
