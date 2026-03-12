/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{vue,js,ts}'],
  theme: {
    extend: {
      colors: {
        background:  'hsl(var(--background))',
        foreground:  'hsl(var(--foreground))',
        card: {
          DEFAULT:    'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        muted: {
          DEFAULT:    'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT:    'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        primary: {
          DEFAULT:    'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        destructive: {
          DEFAULT:    'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        border:  'hsl(var(--border))',
        input:   'hsl(var(--input))',
        ring:    'hsl(var(--ring))',
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'monospace'],
        sans: ['Inter', 'sans-serif'],
      },
      keyframes: {
        statusPulse: {
          '0%, 100%': { opacity: '1' },
          '50%':       { opacity: '0.35' },
        },
        urgentGlow: {
          '0%, 100%': { boxShadow: '0 0 18px rgba(239,68,68,0.15)' },
          '50%':       { boxShadow: '0 0 32px rgba(239,68,68,0.35)' },
        },
        slideDown: {
          from: { opacity: '0', transform: 'translateY(-6px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
        spinSlow: { to: { transform: 'rotate(360deg)' } },
      },
      animation: {
        'status-pulse': 'statusPulse 2s ease-in-out infinite',
        'urgent-glow':  'urgentGlow 2s ease-in-out infinite',
        'slide-down':   'slideDown 0.25s ease',
        'spin-slow':    'spinSlow 2.5s linear infinite',
      },
    },
  },
  plugins: [],
}
