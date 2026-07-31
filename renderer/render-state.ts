/**
 * Mutable state accumulated while building `document.xml`: relationships, media parts, footnotes
 * and citation numbering.
 *
 * Every id issued here is sequential in document order, so two renders of the same IR allocate the
 * same ids in the same sequence — a precondition for byte-identical output.
 */

export interface Relationship {
  id: string;
  type: string;
  target: string;
  external?: boolean;
}

export interface FootnoteEntry {
  /** Word footnote id. Ids 0 and 1 are reserved for the separator marks, so entries start at 2. */
  id: number;
  text: string;
}

export const REL_TYPES = {
  styles: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles',
  numbering: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering',
  settings: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings',
  fontTable: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable',
  theme: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme',
  footnotes: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes',
  header: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/header',
  footer: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer',
  image: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image',
  hyperlink: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink',
} as const;

export class RenderState {
  readonly relationships: Relationship[] = [];
  readonly media = new Map<string, Buffer>();
  readonly footnotes: FootnoteEntry[] = [];
  /** citation key -> its 1-based first-appearance number, for numeric citation styles. */
  readonly citations = new Map<string, number>();
  /** Figures/images that could not be loaded, surfaced as render warnings. */
  readonly warnings: string[] = [];

  private relCounter = 0;
  private docPrCounter = 0;
  private footnoteCounter = 1; // 0 = separator, 1 = continuation separator
  private readonly hyperlinkRels = new Map<string, string>();
  private readonly bookmarkIds = new Map<string, number>();

  /** A stable numeric bookmark id for a block id, allocated in first-use order. */
  bookmarkId(blockId: string): number {
    const existing = this.bookmarkIds.get(blockId);
    if (existing !== undefined) return existing;
    const id = this.bookmarkIds.size + 1;
    this.bookmarkIds.set(blockId, id);
    return id;
  }

  addRelationship(type: string, target: string, external = false): string {
    this.relCounter += 1;
    const id = `rId${this.relCounter}`;
    this.relationships.push(external ? { id, type, target, external } : { id, type, target });
    return id;
  }

  /** Hyperlinks to the same target share one relationship — deterministic and smaller output. */
  addHyperlink(url: string): string {
    const existing = this.hyperlinkRels.get(url);
    if (existing) return existing;
    const id = this.addRelationship(REL_TYPES.hyperlink, url, true);
    this.hyperlinkRels.set(url, id);
    return id;
  }

  addImage(bytes: Buffer, extension: string): { relId: string; docPrId: number } {
    const name = `image${this.media.size + 1}.${extension}`;
    this.media.set(name, bytes);
    const relId = this.addRelationship(REL_TYPES.image, `media/${name}`);
    this.docPrCounter += 1;
    return { relId, docPrId: this.docPrCounter };
  }

  addFootnote(text: string): number {
    this.footnoteCounter += 1;
    this.footnotes.push({ id: this.footnoteCounter, text });
    return this.footnoteCounter;
  }

  citationNumber(key: string): number {
    const existing = this.citations.get(key);
    if (existing !== undefined) return existing;
    const next = this.citations.size + 1;
    this.citations.set(key, next);
    return next;
  }

  nextDocPrId(): number {
    this.docPrCounter += 1;
    return this.docPrCounter;
  }
}
