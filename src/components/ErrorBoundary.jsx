// src/components/ErrorBoundary.jsx
// Catches unhandled render/lifecycle errors anywhere below it in the
// tree and shows a readable, bilingual fallback instead of a blank
// white page. This app has hit "blank page, no clue why" more than
// once already (a missing CSS token, a stale cached build) — none of
// those were React render errors, so an error boundary wouldn't have
// caught them, but a FUTURE bug that DOES throw during render (a null
// reference in a new component, a bad prop shape after a schema
// change, etc.) would previously take down the entire app silently.
// This gives that failure mode a floor.
//
// NOTE: error boundaries are a React class-component-only feature —
// there is no hook equivalent (as of React 18). This must stay a class.
//
// Also note: this only catches errors during render, in lifecycle
// methods, and in constructors of the tree below it. It does NOT catch
// errors in event handlers (a button's onClick throwing), in async code
// (a .then() rejecting), or in the error boundary itself. Those need
// their own try/catch — this is a backstop for render crashes
// specifically, not a universal safety net.

import React from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

const COPY = {
  en: {
    title: "Something went wrong",
    body: "This page hit an unexpected error and couldn't continue. Reloading usually fixes it.",
    reload: "Reload Page",
    details: "Technical details",
  },
  tl: {
    title: "May Naganap na Error",
    body: "May hindi inaasahang error na nangyari sa pahinang ito. Karaniwang naaayos ito sa pag-reload.",
    reload: "I-reload ang Pahina",
    details: "Teknikal na detalye",
  },
};

/**
 * detectLanguage
 * The error boundary sits ABOVE LanguageProvider in some usages (it has
 * to be able to catch errors thrown BY the provider tree itself), so it
 * can't rely on useLanguage()'s context. Instead it reads the same
 * localStorage key LanguageContext persists to, falling back to English
 * if that's ever missing/invalid — matching LanguageContext's own
 * default.
 */
function detectLanguage() {
  try {
    const saved = localStorage.getItem("shelvd_language");
    return saved === "tl" ? "tl" : "en";
  } catch {
    return "en";
  }
}

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    // Logged for now — if/when this app adds a remote error-reporting
    // service, this is the one place that would need to change to also
    // report there.
    console.error("[ErrorBoundary] caught an error:", error, errorInfo);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const lang = detectLanguage();
    const copy = COPY[lang];

    return (
      <div
        style={{
          minHeight: "100dvh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 16,
          padding: 24,
          textAlign: "center",
          background: "#1c1917",
          color: "#f5f5f4",
          fontFamily: "'Plus Jakarta Sans', 'Inter', system-ui, sans-serif",
        }}
      >
        <div
          style={{
            width: 64,
            height: 64,
            borderRadius: "50%",
            background: "rgba(248, 113, 113, 0.15)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#f87171",
          }}
        >
          <AlertTriangle size={30} strokeWidth={2} />
        </div>

        <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>{copy.title}</h1>
        <p style={{ fontSize: 14, color: "#d6d3d1", maxWidth: 360, margin: 0, lineHeight: 1.6 }}>
          {copy.body}
        </p>

        <button
          type="button"
          onClick={this.handleReload}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            background: "#c85a27",
            color: "#fff",
            border: "none",
            borderRadius: 999,
            padding: "12px 24px",
            fontSize: 14,
            fontWeight: 700,
            cursor: "pointer",
            marginTop: 8,
          }}
        >
          <RotateCcw size={16} />
          {copy.reload}
        </button>

        {this.state.error && (
          <details style={{ marginTop: 24, maxWidth: 480, width: "100%", textAlign: "left" }}>
            <summary style={{ fontSize: 12, color: "#a8a29e", cursor: "pointer" }}>
              {copy.details}
            </summary>
            <pre
              style={{
                fontSize: 11,
                color: "#a8a29e",
                background: "rgba(255,255,255,0.05)",
                padding: 12,
                borderRadius: 8,
                overflowX: "auto",
                marginTop: 8,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {String(this.state.error?.message ?? this.state.error)}
            </pre>
          </details>
        )}
      </div>
    );
  }
}
