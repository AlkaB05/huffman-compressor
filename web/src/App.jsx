import { ArrowDownToLine, ChevronRight, TriangleAlert, Upload } from 'lucide-react';
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import BitStream from './components/BitStream.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import CodeTable from './components/CodeTable.jsx';
import Metrics from './components/Metrics.jsx';
import Sidebar from './components/Sidebar.jsx';
import TreeView from './components/TreeView.jsx';
import { formatBytes } from './huffman/display.js';
import { analyze, decompress, isHuf } from './huffman/huffman.js';
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
  const a = useMemo(() => analyze(bytes), [bytes]);
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
        const restored = decompress(raw);
        setFile({ name: f.name.replace(/\.huf$/i, '') || 'restored', bytes: restored, restoredFrom: { name: f.name, size: raw.length } });
      } catch (e) {
        setError(`${f.name}: ${e.message}`);
        return;
      }
    } else {
      setFile({ name: f.name, bytes: raw });
    }
    setSource('file');
  };

  const pick = (s) => {
    setSelected(s);
    if (s != null) setStep(fullStep);
  };

  const restored = source === 'file' && file?.restoredFrom;
  const isText = bytes.length > 0 && bytes.slice(0, 4096).every((b) => b === 9 || b === 10 || b === 13 || b >= 32);
  const title = source === 'file' ? file?.name : source === 'custom' ? 'Custom text' : SAMPLES.find((s) => s.key === source)?.label;
  const outName = `${source === 'file' && file ? file.name : (title || 'input').toLowerCase().replace(/\s+/g, '-') + '.txt'}`;

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
            <button
              type="button"
              className="btn btn-primary"
              disabled={!a.originalBytes}
              onClick={() => (restored ? download(bytes, file.name) : download(a.packed, `${outName}.huf`))}
            >
              <ArrowDownToLine size={14} aria-hidden="true" />
              {restored ? 'Download original' : 'Download .huf'}
            </button>
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
                <Metrics a={a} />
                <TreeView tree={a.tree} step={step} setStep={setStep} selected={selected} setSelected={pick} />
                <BitStream bytes={bytes} codes={a.codes} packed={a.packed} selected={selected} />
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
