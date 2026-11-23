import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useApi } from '../../lib/api';
import { messageForError } from '../../lib/error-copy';
import { Button } from '../../ui/Button';
import { Callout } from '../../ui/Callout';
import { Card } from '../../ui/Card';
import { MarkdownArticle } from './MarkdownArticle';
import { pageQueryOptions } from './page-query';

export function MarkdownPageContent({ path, anchor }: { path: string; anchor: string }) {
  const page = useQuery(pageQueryOptions(useApi(), path));
  useEffect(() => {
    if (page.data && anchor) document.getElementById(anchor)?.scrollIntoView();
  }, [page.data, anchor]);

  if (page.isPending) return <Card title="Wiki page" state={{ type: 'loading' }} />;
  if (page.isError) {
    return (
      <Callout
        tone="error"
        queryError
        title="Could not load the page."
        action={
          <Button variant="secondary" onClick={() => void page.refetch()}>
            Try again
          </Button>
        }
      >
        {messageForError(page.error)}
      </Callout>
    );
  }
  if (!page.data.markdown.trim()) {
    return (
      <Card
        title={page.data.title}
        header
        state={{ type: 'empty', message: 'This page is empty.' }}
      />
    );
  }
  return (
    <article
      aria-label={page.data.title}
      className="min-w-0 max-w-article rounded-12 border border-edge bg-surface px-40px pt-28px pb-36px"
    >
      <MarkdownArticle {...page.data} />
    </article>
  );
}
