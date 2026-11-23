import { QueryClient, QueryClientProvider, useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { getPing, pollInterval, startPing } from './model';

const client = new QueryClient();

function PingPage() {
  const [message, setMessage] = useState('');
  const start = useMutation({ mutationFn: startPing });
  const id = start.data?.id;
  const job = useQuery({
    queryKey: ['dev-ping', id],
    enabled: id !== undefined,
    queryFn: ({ signal }) => getPing(id ?? '', signal),
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
        <button disabled={start.isPending}>Ping</button>
      </form>
      {error && <p role="alert">{error.message}</p>}
      {(job.data ?? start.data) && <pre>{JSON.stringify(job.data ?? start.data, null, 2)}</pre>}
    </main>
  );
}

export default function PingRoute() {
  return (
    <QueryClientProvider client={client}>
      <PingPage />
    </QueryClientProvider>
  );
}
