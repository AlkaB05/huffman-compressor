import { Dna, FileArchive, FileText, FileUp, PenLine, ScrollText, Sparkles } from 'lucide-react';
import { SAMPLES } from '../samples.js';

const ICONS = { prose: FileText, abra: Sparkles, dna: Dna, logs: ScrollText };

export default function Sidebar({ source, restored, onSample, onCustom, onPickFile }) {
  return (
    <nav className="sidebar" aria-label="Sources">
      <div className="workspace">
        <span className="ws-logo" aria-hidden="true">
          <svg viewBox="0 0 20 20">
            <path d="M10 3 5 10m5-7 5 7M5 10l-2 6m2-6 3 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none" />
            <circle cx="10" cy="3" r="2" fill="currentColor" />
          </svg>
        </span>
        <span className="ws-name">Huffman</span>
        <span className="ws-tag mono">v1.0</span>
      </div>

      <div className="nav-group">
        <h3 className="nav-heading">Samples</h3>
        <ul className="nav-list">
          {SAMPLES.map((s) => {
            const Icon = ICONS[s.key];
            return (
              <li key={s.key}>
                <button type="button" className={source === s.key ? 'nav-item active' : 'nav-item'} onClick={() => onSample(s)} aria-current={source === s.key}>
                  <Icon size={15} aria-hidden="true" />
                  <span>{s.label}</span>
                  <span className="nav-count mono">{s.text.length}</span>
                </button>
              </li>
            );
          })}
          <li>
            <button type="button" className={source === 'custom' ? 'nav-item active' : 'nav-item'} onClick={onCustom} aria-current={source === 'custom'}>
              <PenLine size={15} aria-hidden="true" />
              <span>Custom text</span>
            </button>
          </li>
        </ul>
      </div>

      <div className="nav-group">
        <h3 className="nav-heading">Files</h3>
        <ul className="nav-list">
          <li>
            <button type="button" className={source === 'file' && !restored ? 'nav-item active' : 'nav-item'} onClick={onPickFile}>
              <FileUp size={15} aria-hidden="true" />
              <span>Compress a file…</span>
            </button>
          </li>
          <li>
            <button type="button" className={source === 'file' && restored ? 'nav-item active' : 'nav-item'} onClick={onPickFile}>
              <FileArchive size={15} aria-hidden="true" />
              <span>Open a .huf file…</span>
            </button>
          </li>
        </ul>
        <p className="nav-hint">Or drop any file onto the page.</p>
      </div>

      <div className="sidebar-foot">
        <span className="dot-live" aria-hidden="true" />
        <span>
          Output is byte-identical to the <span className="mono">C++</span> CLI
        </span>
      </div>
    </nav>
  );
}
