import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useApi } from '../../lib/api';
import { messageForError } from '../../lib/error-copy';
import { useSession } from '../../lib/session';
import { getPing, pollInterval, startPing } from './model';

export default function PingRoute() {
  const api = useApi();
  const session = useSession();
  const [message, setMessage] = useState('');
  const start = useMutation({ mutationFn: (input: string) => startPing(api, input) });
  const id = start.data?.id;
  const job = useQuery({
    queryKey: ['dev-ping', { id }],
    enabled: id !== undefined,
    queryFn: ({ signal }) => getPing(api, id ?? '', signal),
    refetchInterval: ({ state }) => (state.error ? false : pollInterval(state.data)),
  });
  const error = start.error ?? job.error;

  return (
    <main>
      <h1>Worker ping</h1>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          start.mutate(message);
        }}
      >
        <label>
          Message{' '}
          <input
            required
            value={message}
            onChange={(event) => {
              setMessage(event.target.value);
            }}
          />
        </label>
        <button disabled={start.isPending || session.isPending}>Ping</button>
      </form>
      {error && <p role="alert">{messageForError(error)}</p>}
      {(job.data ?? start.data) && <pre>{JSON.stringify(job.data ?? start.data, null, 2)}</pre>}
    </main>
  );
}
