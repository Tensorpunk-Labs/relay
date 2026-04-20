'use client';

interface MetaControlsProps {
  windowDays: number;
  onWindowChange: (days: number) => void;
}

const PRESETS = [7, 14, 30] as const;
const PRESET_LABELS: Record<number, string> = { 7: '7d', 14: '14d', 30: '30d' };

export default function MetaControls({ windowDays, onWindowChange }: MetaControlsProps) {
  return (
    <div className="rs-liquid-glass" style={{ padding: '12px 18px' }}>
      <div className="flex items-center justify-between mb-2">
        <span className="rs-zone-label" style={{ marginBottom: 0 }}>
          <span className="rs-zone-icon">◇</span>
          META CONTROLS
        </span>
      </div>
      <div className="flex items-center gap-4">
        <span
          className="rs-text-mono uppercase tracking-[1.2px]"
          style={{ fontSize: '7px', color: 'var(--rs-accent-cyan)', whiteSpace: 'nowrap' }}
        >
          ORIENT WINDOW
        </span>

        {/* Slider */}
        <div className="flex-1 flex items-center gap-3">
          <input
            type="range"
            min={3}
            max={60}
            step={1}
            value={windowDays}
            onChange={(e) => onWindowChange(parseInt(e.target.value, 10))}
            className="meta-slider flex-1"
          />
          <span
            className="rs-text-mono font-bold"
            style={{ fontSize: '16px', color: 'var(--rs-accent-lime)', minWidth: '36px', textAlign: 'right' }}
          >
            {windowDays}d
          </span>
        </div>

        {/* Divider */}
        <div style={{ width: 1, height: 24, background: 'var(--rs-separator)' }} />

        {/* Preset pills */}
        <div className="flex gap-1">
          {PRESETS.map((preset) => (
            <button
              key={preset}
              onClick={() => onWindowChange(preset)}
              className={`rs-pill ${windowDays === preset ? 'rs-pill-lime' : ''}`}
              style={{ cursor: 'pointer', border: '1px solid', borderColor: windowDays === preset ? 'rgba(212,245,0,0.3)' : 'var(--rs-separator)' }}
            >
              {PRESET_LABELS[preset]}
            </button>
          ))}
        </div>
      </div>

      {/* Slider custom styles */}
      <style jsx>{`
        .meta-slider {
          -webkit-appearance: none;
          appearance: none;
          height: 4px;
          background: var(--rs-bg-recessed);
          border-radius: 2px;
          outline: none;
          vertical-align: middle;
        }
        .meta-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: var(--rs-accent-cyan);
          cursor: pointer;
          box-shadow: 0 0 10px rgba(0, 221, 255, 0.6);
          margin-top: -5px;
        }
        .meta-slider::-moz-range-thumb {
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: var(--rs-accent-cyan);
          cursor: pointer;
          border: none;
          box-shadow: 0 0 10px rgba(0, 221, 255, 0.6);
        }
        .meta-slider::-webkit-slider-runnable-track {
          background: linear-gradient(90deg, var(--rs-accent-lime) 0%, var(--rs-accent-cyan) 60%, rgba(0,221,255,0.2) 100%);
          height: 4px;
          border-radius: 2px;
        }
      `}</style>
    </div>
  );
}
