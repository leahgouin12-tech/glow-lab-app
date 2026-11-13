import { useRef, useState } from 'react';
import { importPinLinks, importPinterestFiles, PINTEREST_IMPORT_NOTES, type ImportSummary } from '../providers/pinterestImport';
import { Button, Chip, TextArea } from './primitives';
import '../styles/departments/discover.css';

/**
 * The whole Pinterest story in one panel: what is possible for free, what the
 * app will never do, and three ways to get your own saves into the feed.
 */
export function PinterestImport({ onImported }: { onImported: (summary: ImportSummary) => void }) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [picked, setPicked] = useState<File[]>([]);
  const [links, setLinks] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<ImportSummary | null>(null);

  const run = async (label: string, fn: () => Promise<ImportSummary>) => {
    setBusy(label);
    setError('');
    try {
      const summary = await fn();
      setResult(summary);
      if (summary.imported || summary.linkOnly) onImported(summary);
    } catch (e) {
      setError((e as Error).message || 'That file could not be read.');
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="pi">
      <p className="pi__lead">
        A live Pinterest feed is not something this app can honestly offer: Pinterest's API answers without browser access
        headers, so a local-first app cannot call it, and a real sync would need a server holding your token. What does work —
        free, and without scraping anything — is <b>your own copy of your data</b>. Hand that to the app and your saves join the
        feed.
      </p>

      <ol className="pi__steps">
        <li>
          In Pinterest: <b>Settings → Privacy and data → Request your data → Start request.</b>
        </li>
        <li>
          Pinterest emails a download link, usually within about 48 hours. Save the archive to this device.
        </li>
        <li>Drop it below. Pictures inside become feed cards; rows that carry only a link become reference links.</li>
      </ol>

      <div className="pi__drop">
        <input
          ref={fileRef}
          type="file"
          accept=".zip,.csv,image/*"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => setPicked(Array.from(e.target.files ?? []))}
        />
        <Button variant="gold" onClick={() => fileRef.current?.click()}>
          Choose your Pinterest archive
        </Button>
        <span className="pi__files">
          {picked.length ? `${picked.length} file(s): ${picked.map((f) => f.name).join(', ').slice(0, 90)}` : 'a .zip from Pinterest, a .csv, or the image files themselves'}
        </span>
        <Button
          variant="primary"
          disabled={!picked.length || Boolean(busy)}
          onClick={() => run('Reading your file on this device…', () => importPinterestFiles(picked))}
        >
          Import {picked.length || ''} file(s)
        </Button>
      </div>

      <div className="pi__links">
        <div className="gl-serif">Or paste links you copied yourself</div>
        <TextArea
          value={links}
          onChange={setLinks}
          rows={3}
          placeholder={'https://www.pinterest.com/pin/…\nhttps://pin.it/…'}
        />
        <div className="pi__linkrow">
          <Button disabled={!links.trim() || Boolean(busy)} onClick={() => run('Storing your links…', () => importPinLinks(links))}>
            Store these links
          </Button>
          <span className="gl-small gl-faint">
            Links only. The app never downloads someone else's image for you — it stores the address and your note, locally.
          </span>
        </div>
      </div>

      {busy ? <div className="pi__busy">{busy}</div> : null}
      {error ? (
        <div className="pi__error">{error}</div>
      ) : result ? (
        <div className="pi__result">
          <div className="pi__chips">
            <Chip tone="gold">{result.imported} new feed card(s)</Chip>
            <Chip>{result.linkOnly} stored as links</Chip>
            <Chip>{result.duplicates} already in your library</Chip>
            <Chip tone="info">{result.pinsFound} pin row(s) read</Chip>
            <Chip tone="info">{result.imagesFound} image(s) found</Chip>
          </div>
          <p>{result.detail}</p>
        </div>
      ) : null}

      <ul className="pi__notes">
        {PINTEREST_IMPORT_NOTES.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    </div>
  );
}
