import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { App } from '../src/App';

describe('App', () => {
  it('renders the md-wiki heading', () => {
    expect(renderToStaticMarkup(<App />)).toBe('<h1>md-wiki</h1>');
  });
});
