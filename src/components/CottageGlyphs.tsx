interface CottageGlyphProps {
  className?: string;
}

interface MemoryArchiveGlyphProps extends CottageGlyphProps {
  size?: number | string;
}

export function CottageStar({ className = "" }: CottageGlyphProps) {
  return (
    <svg className={className} viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <line x1="2.5" y1="7" x2="11.5" y2="7" stroke="currentColor" strokeWidth="0.65" opacity="0.6" />
      <line x1="7" y1="0.5" x2="7" y2="13.5" stroke="currentColor" strokeWidth="0.65" opacity="0.6" />
      <path
        d="M7 0.8C7 4.2 9 6.5 10.8 7C9 7.5 7 9.8 7 13.2C7 9.8 5 7.5 3.2 7C5 6.5 7 4.2 7 0.8Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function CottageOctagram({ className = "" }: CottageGlyphProps) {
  return (
    <svg className={className} viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <line x1="2.5" y1="7" x2="11.5" y2="7" stroke="currentColor" strokeWidth="0.65" opacity="0.6" />
      <line x1="7" y1="0.5" x2="7" y2="13.5" stroke="currentColor" strokeWidth="0.65" opacity="0.6" />
      <line x1="3.8" y1="3.8" x2="10.2" y2="10.2" stroke="currentColor" strokeWidth="0.5" opacity="0.5" />
      <line x1="10.2" y1="3.8" x2="3.8" y2="10.2" stroke="currentColor" strokeWidth="0.5" opacity="0.5" />
      <path
        d="M7 0.8C7 4.2 9 6.5 10.8 7C9 7.5 7 9.8 7 13.2C7 9.8 5 7.5 3.2 7C5 6.5 7 4.2 7 0.8Z"
        fill="currentColor"
      />
      <path
        d="M7 3.2C7 5 8 6.5 10.5 7C8 7.5 7 9 7 10.5C7 9 6 7.5 3.5 7C6 6.5 7 5 7 3.2Z"
        fill="currentColor"
        transform="rotate(45 7 7)"
        opacity="0.75"
      />
    </svg>
  );
}

export function CottageLogoMark({ className = "" }: CottageGlyphProps) {
  return (
    <svg className={className} viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <ellipse cx="7" cy="7" rx="6.2" ry="2" stroke="currentColor" strokeWidth="0.6" fill="none" transform="rotate(-30 7 7)" opacity="0.8" />
      <circle cx="9.8" cy="4.2" r="0.6" fill="#fff" />
      <line x1="2.5" y1="7" x2="11.5" y2="7" stroke="currentColor" strokeWidth="0.5" opacity="0.4" />
      <line x1="7" y1="1.5" x2="7" y2="12.5" stroke="currentColor" strokeWidth="0.5" opacity="0.4" />
      <path
        d="M7 1.2C7 4.2 8.8 6 10.8 7C8.8 8 7 9.8 7 12.8C7 9.8 5.2 8 3.2 7C5.2 6 7 4.2 7 1.2Z"
        fill="currentColor"
      />
      <circle cx="7" cy="7" r="0.8" fill="#fff" />
    </svg>
  );
}

export function CottageBondGlyph({ className = "" }: CottageGlyphProps) {
  return (
    <svg className={className} viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <circle className="cottage-bond-ring-primary" cx="5.8" cy="7" r="3.2" strokeWidth="0.75" />
      <circle className="cottage-bond-ring-secondary" cx="8.2" cy="7" r="3.2" strokeWidth="0.75" />
      <path d="M7 4.5L7.5 5.2L8.2 5.5L7.5 5.8L7 6.5L6.5 5.8L5.8 5.5L6.5 5.2Z" fill="#fff" />
    </svg>
  );
}

export function MemoryArchiveGlyph({ className = "", size = 28 }: MemoryArchiveGlyphProps) {
  return (
    <svg className={`memory-archive-glyph ${className}`.trim()} width={size} height={size} viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <rect className="memory-glyph-frame" x="2.5" y="1" width="9" height="12" rx="1.5" fill="none" strokeWidth="0.9" />
      <rect className="memory-glyph-page" x="3.8" y="2.2" width="6.4" height="9.6" rx="0.8" fill="none" strokeWidth="0.55" opacity="0.7" />
      <path className="memory-glyph-spark" d="M7 4.2C7 5 7.6 5.5 8.3 5.5C7.8 5.7 7.5 6.3 7 7C7 6.3 6.7 5.7 6.2 5.5C6.9 5.5 7 5 7 4.2Z" fill="#fff" />
      <path className="memory-glyph-page-fill" d="M7 9C5.5 9 4.8 8 4.8 7C4.8 6.2 5.2 5.5 5.8 5.2C5.4 5.6 5.3 6.1 5.3 6.6C5.3 7.8 6.1 8.3 7 8.3C7.3 8.3 7.6 8.2 7.8 8C7.5 8.6 7 9 7 9Z" />
    </svg>
  );
}

export function MemoryOrganizeGlyph({ className = "", size = 28 }: MemoryArchiveGlyphProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <polygon className="memory-glyph-frame" points="7,1 9.5,4.5 13,7 9.5,9.5 7,13 4.5,9.5 1,7 4.5,4.5" fill="none" strokeWidth="0.85" />
      <polygon className="memory-glyph-page-fill" points="7,4 9,7 7,10 5,7" opacity="0.8" />
      <circle cx="7" cy="7" r="1.1" fill="#fff" />
      <line x1="2.5" y1="7" x2="11.5" y2="7" stroke="#fff" strokeWidth="0.45" opacity="0.7" />
      <line x1="7" y1="2.5" x2="7" y2="11.5" stroke="#fff" strokeWidth="0.45" opacity="0.7" />
    </svg>
  );
}

export function ChronicleBookGlyph({ className = "", size = 28 }: MemoryArchiveGlyphProps) {
  return (
    <svg className={`chronicle-book-glyph ${className}`.trim()} width={size} height={size} viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path className="chronicle-glyph-book" d="M7 11.5C5.5 9.5 2.5 9.5 2.5 9.5V3S5.5 3 7 5.5" fill="none" strokeWidth="0.85" />
      <path className="chronicle-glyph-book" d="M7 11.5C8.5 9.5 11.5 9.5 11.5 9.5V3S8.5 3 7 5.5" fill="none" strokeWidth="0.85" />
      <ellipse className="chronicle-glyph-orbit" cx="7" cy="5" rx="4.5" ry="1.8" fill="none" strokeWidth="0.5" opacity="0.6" transform="rotate(-15 7 5)" />
      <line className="chronicle-glyph-book" x1="7" y1="3" x2="7" y2="11.5" strokeWidth="0.6" />
    </svg>
  );
}

export function CottageDivider({ className = "" }: CottageGlyphProps) {
  return (
    <div className={`cottage-divider ${className}`} aria-hidden="true">
      <span />
      <CottageOctagram />
      <span />
    </div>
  );
}
