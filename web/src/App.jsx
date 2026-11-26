import { ArrowDownToLine, ChevronRight, TriangleAlert, Upload } from 'lucide-react';
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import BitStream from './components/BitStream.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import CodeTable from './components/CodeTable.jsx';
import SameFormat from './components/SameFormat.jsx';
import Metrics from './components/Metrics.jsx';
import Sidebar from './components/Sidebar.jsx';
import TreeView from './components/TreeView.jsx';
import { formatBytes } from './huffman/display.js';
import { analyze, decode, isHuf } from './huffman/huffman.js';
import { extensionOf, formatOf } from './optimize/optimize.js';
import { SAMPLES } from './samples.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function download(bytes, name) {
  const url = URL.createObjectURL(new Blob([bytes]));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function App() {
  const [source, setSource] = useState('abra'); // sample key | 'custom' | 'file'
  const [text, setText] = useState(SAMPLES[1].text);
  const [file, setFile] = useState(null); // { name, bytes, restoredFrom? }
  const [error, setError] = useState('');
  const [rawStep, setStep] = useState(0);
  const [selected, setSelected] = useState(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef(null);
  const editorRef = useRef(null);

  const deferredText = useDeferredValue(text);
  const bytes = useMemo(() => (source === 'file' && file ? file.bytes : encoder.encode(deferredText)), [source, file, deferredText]);
  const title = source === 'file' ? file?.name : source === 'custom' ? 'Custom text' : SAMPLES.find((s) => s.key === source)?.label;
  // Files keep their name inside the .huf so they decompress back to the same type.
  // Typed text stores no name (it would cost more bytes than short text saves);
  // opening "custom-text.txt.huf" falls back to "custom-text.txt".
  const fileName = source === 'file' && file ? file.name : `${(title || 'input').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.txt`;
  const storedName = source === 'file' ? fileName : '';
  const a = useMemo(() => analyze(bytes, storedName), [bytes, storedName]);
  const fullStep = a.tree.merges.length;
  // Clamp during render: when the input changes, the old step can be larger than
  // the new tree's merge count until the effect below resets it.
  const step = Math.min(rawStep, fullStep);

  // New input: small trees start at step 0 to invite stepping; big ones show the finished tree.
  useEffect(() => {
    setStep(fullStep <= 12 ? 0 : fullStep);
    setSelected(null);
  }, [a, fullStep]);

  const loadFile = async (f) => {
    setError('');
    const raw = new Uint8Array(await f.arrayBuffer());
    if (isHuf(raw)) {
      try {
        const { bytes: restored, fileName: storedName } = decode(raw);
        // Prefer the name stored in the header; old files without one fall back to dropping ".huf".
        const name = storedName || f.name.replace(/\.huf$/i, '') || 'restored';
        setFile({ name, bytes: restored, restoredFrom: { name: f.name, size: raw.length } });
      } catch (e) {
        setError(`${f.name}: ${e.message}`);
        return;
      }
    } else {
      setFile({ name: f.name, bytes: raw });
    }
    setSource('file');
  };

  // Same-format compression (report.pdf -> smaller report.pdf) for uploaded PDF / Office / ZIP / PNG
  // files. Runs in a worker; a new file terminates the previous job.
  const sameFormat = source === 'file' && file && !file.restoredFrom ? formatOf(file.bytes, file.name) : null;
  const [same, setSame] = useState({ status: 'idle' });
  useEffect(() => {
    if (!sameFormat) {
      setSame({ status: 'idle' });
      return undefined;
    }
    setSame({ status: 'working' });
    const worker = new Worker(new URL('./optimize/worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => setSame(data.ok ? { status: 'done', result: data.result } : { status: 'error', error: data.error });
    worker.onerror = (e) => setSame({ status: 'error', error: e.message || 'worker failed' });
    worker.postMessage({ id: 1, bytes: file.bytes, name: file.name });
    return () => worker.terminate();
  }, [file, sameFormat]);
  const ext = extensionOf(file?.name) || sameFormat || '';
  const compressedName = file ? `${file.name.replace(/\.[^.]+$/, '') || 'file'}-compressed.${ext}` : '';
  const sameReady = same.status === 'done' && same.result.smaller;

  const pick = (s) => {
    setSelected(s);
    if (s != null) setStep(fullStep);
  };

  const restored = source === 'file' && file?.restoredFrom;
  const isText = bytes.length > 0 && bytes.slice(0, 4096).every((b) => b === 9 || b === 10 || b === 13 || b >= 32);

  return (
    <div
      className="app"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const f = e.dataTransfer.files?.[0];
        if (f) loadFile(f);
      }}
    >
      <Sidebar
        source={source}
        restored={Boolean(file?.restoredFrom)}
        onSample={(s) => {
          setText(s.text);
          setSource(s.key);
        }}
        onCustom={() => {
          setSource('custom');
          requestAnimationFrame(() => editorRef.current?.focus());
        }}
        onPickFile={() => fileInput.current.click()}
      />
      <input
        ref={fileInput}
        type="file"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) loadFile(f);
          e.target.value = '';
        }}
      />

      <div className="main">
        <header className="header">
          <div className="crumbs">
            <span className="crumb">Compressor</span>
            <ChevronRight size={14} aria-hidden="true" className="crumb-sep" />
            <h1 className="crumb current">{title}</h1>
            <span className="badge mono">{formatBytes(bytes.length)}</span>
          </div>
          <div className="actions">
            <button type="button" className="btn btn-ghost" onClick={() => fileInput.current.click()}>
              <Upload size={14} aria-hidden="true" /> Open file
            </button>
            {restored ? (
              <button type="button" className="btn btn-primary" onClick={() => download(bytes, file.name)} title={`Save as ${file.name}`}>
                <ArrowDownToLine size={14} aria-hidden="true" />
                Download decompressed {file.name}
              </button>
            ) : (
              <>
                {sameFormat && (
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={!sameReady}
                    onClick={() => download(same.result.bytes, compressedName)}
                    title={sameReady ? `Save as ${compressedName}` : undefined}
                  >
                    <ArrowDownToLine size={14} aria-hidden="true" />
                    {same.status === 'working'
                      ? `Compressing ${ext.toUpperCase()}…`
                      : sameReady
                        ? <>Download compressed {ext.toUpperCase()} <span className="mono">({formatBytes(same.result.optimizedBytes)})</span></>
                        : `${ext.toUpperCase()} already optimal`}
                  </button>
                )}
                <button
                  type="button"
                  className={sameFormat ? 'btn btn-ghost' : 'btn btn-primary'}
                  disabled={!a.originalBytes}
                  onClick={() => download(a.packed, `${fileName}.huf`)}
                  title={`Save the Huffman-compressed file as ${fileName}.huf`}
                >
                  <ArrowDownToLine size={14} aria-hidden="true" />
                  {sameFormat ? '.huf' : 'Download compressed .huf'} <span className="mono">({formatBytes(a.compressedBytes)})</span>
                </button>
              </>
            )}
          </div>
        </header>

        <div className="content">
          <div className="column">
            {error && (
              <p className="alert" role="alert">
                <TriangleAlert size={15} aria-hidden="true" /> {error}
              </p>
            )}

            {source !== 'file' ? (
              <section className="section editor">
                <label className="section-label" htmlFor="editor">
                  Source text
                </label>
                <textarea
                  id="editor"
                  ref={editorRef}
                  className="textarea"
                  value={text}
                  spellCheck="false"
                  placeholder="Type or paste anything…"
                  onChange={(e) => {
                    setText(e.target.value);
                    if (source !== 'custom' && !SAMPLES.some((s) => s.text === e.target.value)) setSource('custom');
                  }}
                />
              </section>
            ) : (
              <section className={restored ? 'section file-info restored' : 'section file-info'}>
                <span className="section-label">{restored ? 'Decompressed' : 'File'}</span>
                <p>
                  {restored ? (
                    <>
                      <span className="mono">{file.restoredFrom.name}</span> ({formatBytes(file.restoredFrom.size)}) decoded to{' '}
                      <strong>{formatBytes(bytes.length)}</strong>. The analysis below is of the restored data.
                    </>
                  ) : (
                    <>
                      <span className="mono">{file?.name}</span> · {formatBytes(bytes.length)}
                    </>
                  )}
                </p>
                {isText && <pre className="preview">{decoder.decode(bytes.slice(0, 700))}{bytes.length > 700 ? '…' : ''}</pre>}
              </section>
            )}

            {a.originalBytes === 0 ? (
              <p className="empty">Type something, pick a sample, or drop a file to see its Huffman tree.</p>
            ) : (
              <ErrorBoundary resetKey={a}>
                {sameFormat && <SameFormat state={same} ext={ext} />}
                <Metrics a={a} title={sameFormat ? 'Huffman coding on the raw bytes (.huf)' : undefined} />
                <TreeView tree={a.tree} step={step} setStep={setStep} selected={selected} setSelected={pick} />
                <BitStream bytes={bytes} codes={a.codes} packed={a.packed} headerBytes={a.headerBytes} storedName={a.storedName} selected={selected} />
              </ErrorBoundary>
            )}
          </div>

          {a.originalBytes > 0 && (
            <aside className="panel-right" aria-label="Code table">
              <ErrorBoundary resetKey={a}>
                <CodeTable rows={a.rows} total={a.originalBytes} selected={selected} setSelected={pick} />
              </ErrorBoundary>
            </aside>
          )}
        </div>
      </div>

      {dragging && (
        <div className="drop-overlay" aria-hidden="true">
          <div className="drop-card">
            <Upload size={20} />
            <p>Drop to compress, or drop a .huf to decompress</p>
          </div>
        </div>
      )}
    </div>
  );
}
