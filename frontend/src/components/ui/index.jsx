import { useEffect } from 'react';
import { colors, font, space, radius, shadow, transition } from '../../tokens.js';

// ─── Keyframe injection (Spinner) ────────────────────────────────────────────

function ensureKeyframes() {
  if (document.getElementById('ui-keyframes')) return;
  const s = document.createElement('style');
  s.id = 'ui-keyframes';
  s.textContent = '@keyframes ui-spin { to { transform: rotate(360deg) } }';
  document.head.appendChild(s);
}

// ─── Card ─────────────────────────────────────────────────────────────────────

export function Card({ padding = 20, style, children }) {
  return (
    <div style={{
      background: colors.bgCard,
      border: `1px solid ${colors.border}`,
      borderRadius: radius.lg,
      boxShadow: shadow.card,
      padding,
      ...style,
    }}>
      {children}
    </div>
  );
}

// ─── PageHeader ───────────────────────────────────────────────────────────────

export function PageHeader({ title, subtitle, back }) {
  return (
    <div style={{ marginBottom: space.lg }}>
      {back && (
        <button
          onClick={back.onClick}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: space.xs,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: colors.textSecondary,
            fontSize: font.sm,
            padding: `${space.xs}px 0`,
            marginBottom: space.sm,
            transition: transition.fast,
          }}
        >
          ← {back.label}
        </button>
      )}
      <h1 style={{
        fontSize: font.lg,
        fontWeight: 700,
        color: colors.textPrimary,
        lineHeight: 1.2,
      }}>
        {title}
      </h1>
      {subtitle && (
        <p style={{
          fontSize: font.sm,
          color: colors.textSecondary,
          marginTop: space.xs,
        }}>
          {subtitle}
        </p>
      )}
    </div>
  );
}

// ─── Avatar ───────────────────────────────────────────────────────────────────

function toInitials(name) {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function Avatar({ name, size = 36 }) {
  return (
    <div style={{
      width: size,
      height: size,
      borderRadius: radius.pill,
      background: colors.greenMid,
      color: '#fff',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: Math.round(size * 0.38),
      fontWeight: 600,
      flexShrink: 0,
      userSelect: 'none',
    }}>
      {toInitials(name)}
    </div>
  );
}

// ─── Badge ────────────────────────────────────────────────────────────────────

const BADGE_MAP = {
  green: { background: 'var(--green-glow)',  color: 'var(--green-bright)' },
  tan:   { background: 'rgba(124,79,42,0.12)', color: 'var(--tan)' },
  red:   { background: 'var(--error-bg)',    color: 'var(--error)' },
  muted: { background: 'rgba(0,0,0,0.06)',   color: 'var(--text-muted)' },
};

export function Badge({ color = 'muted', children }) {
  const palette = BADGE_MAP[color] ?? BADGE_MAP.muted;
  return (
    <span style={{
      ...palette,
      display: 'inline-flex',
      alignItems: 'center',
      borderRadius: radius.pill,
      padding: `2px ${space.sm}px`,
      fontSize: font.xs,
      fontWeight: 600,
      letterSpacing: '0.02em',
      whiteSpace: 'nowrap',
    }}>
      {children}
    </span>
  );
}

// ─── StatCard ─────────────────────────────────────────────────────────────────

export function StatCard({ label, value, color }) {
  return (
    <Card style={{ minWidth: 0 }}>
      <p style={{
        fontSize: font.xs,
        fontWeight: 600,
        color: colors.textMuted,
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        marginBottom: space.xs,
      }}>
        {label}
      </p>
      <p style={{
        fontSize: font.xl,
        fontWeight: 700,
        color: color ?? colors.textPrimary,
        lineHeight: 1,
      }}>
        {value}
      </p>
    </Card>
  );
}

// ─── EmptyState ───────────────────────────────────────────────────────────────

export function EmptyState({ icon, title, sub, action, onAction }) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      textAlign: 'center',
      padding: `${space.xl}px ${space.lg}px`,
      color: colors.textMuted,
    }}>
      {icon && (
        <div style={{ marginBottom: space.md, opacity: 0.45 }}>
          {icon}
        </div>
      )}
      <p style={{
        fontSize: font.md,
        fontWeight: 600,
        color: colors.textPrimary,
        marginBottom: sub ? space.xs : 0,
      }}>
        {title}
      </p>
      {sub && (
        <p style={{
          fontSize: font.sm,
          color: colors.textSecondary,
          maxWidth: 280,
          marginBottom: action ? space.lg : 0,
        }}>
          {sub}
        </p>
      )}
      {action && (
        <button
          onClick={onAction}
          style={{
            background: colors.green,
            color: '#fff',
            border: 'none',
            borderRadius: radius.md,
            padding: `${space.sm}px ${space.md}px`,
            fontSize: font.sm,
            fontWeight: 600,
            cursor: 'pointer',
            transition: transition.fast,
          }}
        >
          {action}
        </button>
      )}
    </div>
  );
}

// ─── TabBar ───────────────────────────────────────────────────────────────────

export function TabBar({ tabs, active, onChange }) {
  return (
    <div style={{
      display: 'flex',
      background: 'rgba(0,0,0,0.05)',
      borderRadius: radius.md,
      padding: 3,
      gap: 2,
    }}>
      {tabs.map(tab => {
        const isActive = tab.key === active;
        return (
          <button
            key={tab.key}
            onClick={() => onChange(tab.key)}
            style={{
              flex: 1,
              padding: `${space.xs}px ${space.sm}px`,
              borderRadius: radius.sm,
              border: 'none',
              cursor: 'pointer',
              fontSize: font.sm,
              fontWeight: isActive ? 600 : 400,
              background: isActive ? colors.bgCard : 'transparent',
              color: isActive ? colors.textPrimary : colors.textMuted,
              boxShadow: isActive ? shadow.card : 'none',
              transition: transition.fast,
              whiteSpace: 'nowrap',
            }}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

// ─── Spinner ──────────────────────────────────────────────────────────────────

export function Spinner({ size = 24 }) {
  useEffect(() => { ensureKeyframes(); }, []);
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      padding: space.lg,
    }}>
      <div style={{
        width: size,
        height: size,
        borderRadius: '50%',
        border: `2.5px solid ${colors.border}`,
        borderTopColor: colors.green,
        animation: 'ui-spin 0.7s linear infinite',
      }} />
    </div>
  );
}
