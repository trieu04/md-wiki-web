import { describe, expect, it } from 'vitest';
import { headlineMarkers, splitHeadline } from '../src/wiki/search-snippet.js';

const markers = headlineMarkers();
const { start, stop, separator } = markers;
const mark = (text: string) => `${start}${text}${stop}`;

describe('splitHeadline', () => {
  it('separates plain-text highlights and removes surplus markers and source tags', () => {
    const headline = `An <em data-name="a > b">${mark('image')}</em>, another ${mark('image')}.${separator}${mark('images')} under the lens.${separator}${mark('image')}`;
    expect(splitHeadline(headline, markers)).toEqual([
      { before: 'An ', hit: 'image', after: ', another image.' },
      { before: '', hit: 'images', after: ' under the lens.' },
    ]);
  });

  it('does not return fragments without a complete match', () => {
    expect(splitHeadline(`plain${separator}${start}incomplete`, markers)).toEqual([]);
  });
});
