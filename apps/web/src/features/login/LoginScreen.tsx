import { useState } from 'react';
import type { SubmitEvent } from 'react';
import { useLogin, useSession } from '../../lib/session';
import { Button } from '../../ui/Button';
import { Callout } from '../../ui/Callout';
import { Card } from '../../ui/Card';
import { ReadingLayout } from '../../ui/ReadingLayout';
import { TextInput } from '../../ui/TextInput';
import { loginErrorModel } from './model';

export function LoginScreen({ onSignedIn }: { onSignedIn: () => void }) {
  const session = useSession();
  const login = useLogin();
  const [error, setError] = useState<ReturnType<typeof loginErrorModel>>();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  async function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (login.isPending || session.isPending) return;
    setError(undefined);
    try {
      await login.mutateAsync({ email: email.trim(), password });
    } catch (failure) {
      setError(loginErrorModel(failure));
      return;
    } finally {
      login.reset();
    }
    setPassword('');
    onSignedIn();
  }

  return (
    <ReadingLayout hideTopBar>
      <Card title="Sign in" heading="h1" className="w-full max-w-rail-max self-center" header>
        <form
          className="flex flex-col items-start gap-14px px-18px py-16px"
          onSubmit={(event) => void onSubmit(event)}
        >
          <div className="flex w-full flex-col gap-12px">
            <TextInput
              label="Email"
              name="email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
              }}
              error={error?.fields.email}
              required
            />
            <TextInput
              label="Password"
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
              }}
              error={error?.fields.password}
              required
            />
          </div>
          {error && (
            <Callout tone="error" title="Could not sign in.">
              {error.retry ?? error.message}
            </Callout>
          )}
          <Button type="submit" loading={login.isPending || session.isPending}>
            Sign in
          </Button>
        </form>
      </Card>
    </ReadingLayout>
  );
}
