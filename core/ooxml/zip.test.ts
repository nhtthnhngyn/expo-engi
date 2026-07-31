import { describe, expect, it } from 'vitest';
import { zipRead, zipWrite } from './zip.js';

describe('zip', () => {
  it('round-trips entries through write then read', () => {
    const entries = [
      { name: '[Content_Types].xml', data: Buffer.from('<Types/>', 'utf8') },
      { name: 'word/document.xml', data: Buffer.from('<w:document/>'.repeat(50), 'utf8') },
    ];
    const bytes = zipWrite(entries);
    const { files, names } = zipRead(bytes);
    expect(names).toEqual(['[Content_Types].xml', 'word/document.xml']);
    expect(files.get('word/document.xml')?.toString('utf8')).toBe('<w:document/>'.repeat(50));
  });

  it('produces byte-identical output for identical input across repeated calls', () => {
    const entries = [{ name: 'a.xml', data: Buffer.from('hello world') }];
    expect(zipWrite(entries).equals(zipWrite(entries))).toBe(true);
  });

  it('round-trips a binary (non-UTF8) entry unchanged', () => {
    const data = Buffer.from([0, 1, 2, 255, 254, 253, 10, 13]);
    const bytes = zipWrite([{ name: 'image1.png', data }]);
    const { files } = zipRead(bytes);
    expect(files.get('image1.png')?.equals(data)).toBe(true);
  });
});
