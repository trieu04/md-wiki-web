import { expect, it } from 'vitest';
import { topicId, topicName, topicNames } from '../src/topics.js';

it('derives stable ids from paths, with general for root pages', () => {
  for (const [path, id] of [
    ['intro.md', 'general'],
    ['lab-notes/deep/intro.md', 'lab-notes'],
  ] as const)
    expect(topicId({ path, isMeta: false })).toBe(id);
});
it('uses the folder/name table, not unrelated tables or examples inside fences', () => {
  const md =
    '```\n|folder|name|\n|-|-|\n|demo|Ignore|\n```\n\n|folder|other|\n|-|-|\n|demo|Ignore|\n\nName | Folder\n---|---\n**Slides** and Optics | microscopy\nEmpty row |\n';
  const names = topicNames(md);
  expect([...names]).toEqual([['microscopy', 'Slides and Optics']]);
  expect(topicName('microscopy', names)).toBe('Slides and Optics');
  expect(topicName('lab-notes_archive', names)).toBe('Lab Notes Archive');
  expect(topicName('general', topicNames(''))).toBe('General');
});
