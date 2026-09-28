// src/components/AuthScreen.jsx
// Sign in / Create account / Forgot password, plus the "set a new password"
// screen shown after someone clicks the link in a reset email.
//
// Replaces the old inline <LoginScreen> that lived in OwnerDashboard.jsx.
// Google and Facebook sign-in behave exactly as before.
//
// SUPABASE DASHBOARD SETTINGS THIS RELIES ON (Authentication → URL Configuration):
//   • Site URL and Redirect URLs must include your deployed site URL
//     (e.g. https://<user>.github.io/<repo>/) — password-reset and
//     confirmation emails send people back there.
//   • Authentication → Providers → Email: "Confirm email" can be on or off;
//     both cases are handled below.

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Store, LogIn, UserPlus, Mail, KeyRound, ArrowLeft, CheckCircle2, Languages, Sun, Moon } from "lucide-react";
import { supabase } from "../config/supabaseClient";
import { useLanguage } from "../i18n/LanguageContext";
import { useTheme } from "../theme/ThemeContext";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MIN_PASSWORD = 8;
const siteUrl = () => window.location.origin + window.location.pathname;

function Spinner({ size = 18, color }) {
  return (
    <span
      className="map-loading-spinner"
      style={{ width: size, height: size, borderWidth: 2, ...(color ? { borderTopColor: color } : {}) }}
    />
  );
}

function TopToggles() {
  const { t, language, setLanguage } = useLanguage();
  const { theme, toggleTheme } = useTheme();
  const btn = {
    display: "flex", alignItems: "center", justifyContent: "center", gap: 6, height: 36,
    background: "rgba(255,255,255,0.1)", color: "#fff", border: "none",
    fontSize: 12, fontWeight: 700, cursor: "pointer",
  };
  return (
    <>
      <button type="button" onClick={() => setLanguage(language === "en" ? "tl" : "en")}
        aria-label={t("common.language")} title={t("common.language")}
        style={{ ...btn, position: "absolute", top: "calc(16px + env(safe-area-inset-top, 0px))", right: 16, zIndex: 10, padding: "0 12px", borderRadius: 999 }}>
        <Languages size={14} strokeWidth={2.2} />{language === "en" ? "TL" : "EN"}
      </button>
      <button type="button" onClick={toggleTheme}
        aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        style={{ ...btn, position: "absolute", top: "calc(60px + env(safe-area-inset-top, 0px))", right: 16, zIndex: 10, width: 36, borderRadius: "50%" }}>
        {theme === "dark" ? <Sun size={15} strokeWidth={2.2} /> : <Moon size={15} strokeWidth={2.2} />}
      </button>
    </>
  );
}

function SocialButtons({ disabled, setError }) {
  const { t } = useLanguage();
  const [gLoading, setGLoading] = useState(false);
  const [fbLoading, setFbLoading] = useState(false);

  const oauth = async (provider, setBusy, failKey) => {
    setError(""); setBusy(true);
    const { error } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo: siteUrl() } });
    if (error) { setError(t(failKey)); setBusy(false); }
  };

  return (
    <>
      {/* Google + Facebook brand colors are their official ones — keep as-is. */}
      <button type="button" className="google-signin-btn" disabled={disabled || gLoading || fbLoading}
        onClick={() => oauth("google", setGLoading, "owner.login.googleFailed")}>
        {gLoading ? <Spinner size={20} color="#4285F4" /> : (
          <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
          </svg>
        )}
        {gLoading ? t("owner.login.signingIn") : t("owner.login.continueGoogle")}
      </button>

      <button type="button" disabled={disabled || gLoading || fbLoading}
        onClick={() => oauth("facebook", setFbLoading, "owner.login.facebookFailed")}
        style={{
          display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
          width: "100%", height: 46, marginTop: 10, borderRadius: 10,
          background: "#1877F2", color: "#fff", border: "none", fontSize: 14, fontWeight: 700, cursor: "pointer",
        }}>
        {fbLoading ? <Spinner size={20} color="#fff" /> : (
          <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="#fff">
            <path d="M22 12.06C22 6.5 17.52 2 12 2S2 6.5 2 12.06c0 5.02 3.66 9.18 8.44 9.94v-7.03H7.9v-2.91h2.54V9.85c0-2.51 1.49-3.9 3.77-3.9 1.09 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.77-1.63 1.56v1.88h2.78l-.44 2.91h-2.34V22c4.78-.76 8.44-4.92 8.44-9.94z"/>
          </svg>
        )}
        {fbLoading ? t("owner.login.signingIn") : t("owner.login.continueFacebook")}
      </button>
    </>
  );
}

function Field({ id, label, type = "text", value, onChange, autoComplete, placeholder, hint }) {
  return (
    <div className="login-form__field">
      <label htmlFor={id}>{label}</label>
      <input id={id} type={type} value={value} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete} required />
      {hint && <span className="auth-hint">{hint}</span>}
    </div>
  );
}

export default function AuthScreen() {
  const { t } = useLanguage();
  const [mode, setMode] = useState("signin"); // signin | signup | forgot
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState(null); // { title, body }
  const [busy, setBusy] = useState(false);

  const switchMode = (next) => { setMode(next); setError(""); setNotice(null); setPassword(""); setConfirm(""); };

  const handleSignIn = async (e) => {
    e.preventDefault(); setError("");
    if (!EMAIL_RE.test(email.trim())) { setError(t("auth.invalidEmail")); return; }
    setBusy(true);
    const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (err) {
      const m = err.message.toLowerCase();
      if (m.includes("invalid login credentials")) setError(t("owner.login.incorrectCreds"));
      else if (m.includes("email not confirmed")) setError(t("auth.emailNotConfirmed"));
      else if (m.includes("rate limit")) setError(t("owner.login.rateLimited"));
      else setError(t("owner.login.signInFailed"));
    }
    setBusy(false);
  };

  const handleSignUp = async (e) => {
    e.preventDefault(); setError("");
    if (!EMAIL_RE.test(email.trim())) { setError(t("auth.invalidEmail")); return; }
    if (password.length < MIN_PASSWORD) { setError(t("auth.passwordTooShort", MIN_PASSWORD)); return; }
    if (password !== confirm) { setError(t("auth.passwordsMismatch")); return; }
    setBusy(true);
    const { data, error: err } = await supabase.auth.signUp({
      email: email.trim(), password, options: { emailRedirectTo: siteUrl() },
    });
    setBusy(false);
    if (err) {
      const m = err.message.toLowerCase();
      if (m.includes("already registered")) setError(t("auth.emailInUse"));
      else if (m.includes("rate limit")) setError(t("owner.login.rateLimited"));
      else if (m.includes("password")) setError(t("auth.passwordTooShort", MIN_PASSWORD));
      else setError(t("auth.signUpFailed"));
      return;
    }
    // Supabase returns a user with no identities (instead of an error) when
    // the email is already registered and email-confirmation is enabled.
    if (data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      setError(t("auth.emailInUse"));
      return;
    }
    // With "Confirm email" ON there's no session yet; with it OFF the
    // onAuthStateChange listener in App.jsx signs them straight in.
    if (!data?.session) {
      setNotice({ title: t("auth.checkEmailTitle"), body: t("auth.checkEmailBody", email.trim()) });
    }
  };

  const handleForgot = async (e) => {
    e.preventDefault(); setError("");
    if (!EMAIL_RE.test(email.trim())) { setError(t("auth.invalidEmail")); return; }
    setBusy(true);
    const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: siteUrl() });
    setBusy(false);
    if (err) {
      setError(err.message.toLowerCase().includes("rate limit") ? t("owner.login.rateLimited") : t("auth.resetFailed"));
      return;
    }
    // Same message whether or not the account exists (don't leak which emails are registered).
    setNotice({ title: t("auth.resetSentTitle"), body: t("auth.resetSentBody", email.trim()) });
  };

  return (
    <div className="login-screen" style={{ position: "relative" }}>
      <TopToggles />
      <div className="login-card">
        <div className="login-card__logo"><Store size={36} /></div>

        {notice ? (
          <div className="auth-notice">
            <CheckCircle2 size={40} color="var(--color-available)" />
            <h1 className="login-card__title" style={{ fontSize: 20 }}>{notice.title}</h1>
            <p className="login-card__subtitle">{notice.body}</p>
            <button type="button" className="login-form__submit" onClick={() => switchMode("signin")}>
              <ArrowLeft size={18} /> {t("auth.backToSignIn")}
            </button>
          </div>
        ) : (
          <>
            <h1 className="login-card__title">
              {mode === "forgot" ? t("auth.forgotTitle") : mode === "signup" ? t("auth.createTitle") : t("owner.login.title")}
            </h1>
            <p className="login-card__subtitle">
              {mode === "forgot" ? t("auth.forgotSubtitle") : mode === "signup" ? t("auth.createSubtitle") : t("owner.login.subtitle")}
            </p>

            {mode !== "forgot" && (
              <div className="auth-tabs" role="tablist">
                <button type="button" role="tab" aria-selected={mode === "signin"}
                  className={`auth-tabs__tab ${mode === "signin" ? "auth-tabs__tab--active" : ""}`}
                  onClick={() => switchMode("signin")}>{t("auth.tabSignIn")}</button>
                <button type="button" role="tab" aria-selected={mode === "signup"}
                  className={`auth-tabs__tab ${mode === "signup" ? "auth-tabs__tab--active" : ""}`}
                  onClick={() => switchMode("signup")}>{t("auth.tabSignUp")}</button>
              </div>
            )}

            {mode !== "forgot" && (
              <>
                <SocialButtons disabled={busy} setError={setError} />
                <div className="login-divider"><span>{t("owner.login.or")}</span></div>
              </>
            )}

            <AnimatePresence mode="wait" initial={false}>
              <motion.form key={mode} className="login-form" noValidate
                onSubmit={mode === "signin" ? handleSignIn : mode === "signup" ? handleSignUp : handleForgot}
                initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
                <Field id="auth-email" type="email" label={t("owner.login.emailLabel")} value={email}
                  onChange={setEmail} autoComplete="email" placeholder="owner@example.com" />

                {mode !== "forgot" && (
                  <Field id="auth-password" type="password" label={t("owner.login.passwordLabel")} value={password}
                    onChange={setPassword} autoComplete={mode === "signup" ? "new-password" : "current-password"}
                    placeholder="••••••••" hint={mode === "signup" ? t("auth.passwordHint", MIN_PASSWORD) : undefined} />
                )}

                {mode === "signup" && (
                  <Field id="auth-confirm" type="password" label={t("auth.confirmPasswordLabel")} value={confirm}
                    onChange={setConfirm} autoComplete="new-password" placeholder="••••••••" />
                )}

                {mode === "signin" && (
                  <button type="button" className="auth-link" onClick={() => switchMode("forgot")}>
                    {t("auth.forgotLink")}
                  </button>
                )}

                <button type="submit" className="login-form__submit" disabled={busy}>
                  {busy ? <Spinner /> : mode === "signin" ? <LogIn size={18} /> : mode === "signup" ? <UserPlus size={18} /> : <Mail size={18} />}
                  {busy
                    ? (mode === "forgot" ? t("auth.sending") : mode === "signup" ? t("auth.creating") : t("owner.login.signingIn"))
                    : (mode === "forgot" ? t("auth.sendReset") : mode === "signup" ? t("auth.createAccount") : t("owner.login.signIn"))}
                </button>

                {mode === "forgot" && (
                  <button type="button" className="auth-link auth-link--center" onClick={() => switchMode("signin")}>
                    <ArrowLeft size={14} /> {t("auth.backToSignIn")}
                  </button>
                )}
              </motion.form>
            </AnimatePresence>

            {error && (
              <motion.p className="login-form__error" initial={{ opacity: 0 }} animate={{ opacity: 1 }} role="alert">
                {error}
              </motion.p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * ResetPasswordScreen — shown when the app is opened from a password-reset
 * email link (Supabase fires PASSWORD_RECOVERY; App.jsx swaps this in).
 */
export function ResetPasswordScreen({ onDone }) {
  const { t } = useLanguage();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = async (e) => {
    e.preventDefault(); setError("");
    if (password.length < MIN_PASSWORD) { setError(t("auth.passwordTooShort", MIN_PASSWORD)); return; }
    if (password !== confirm) { setError(t("auth.passwordsMismatch")); return; }
    setBusy(true);
    const { error: err } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (err) { setError(t("auth.resetUpdateFailed")); return; }
    setSaved(true);
  };

  return (
    <div className="login-screen" style={{ position: "relative" }}>
      <TopToggles />
      <div className="login-card">
        <div className="login-card__logo"><KeyRound size={34} /></div>
        {saved ? (
          <div className="auth-notice">
            <CheckCircle2 size={40} color="var(--color-available)" />
            <h1 className="login-card__title" style={{ fontSize: 20 }}>{t("auth.resetDoneTitle")}</h1>
            <p className="login-card__subtitle">{t("auth.resetDoneBody")}</p>
            <button type="button" className="login-form__submit" onClick={onDone}>{t("auth.continue")}</button>
          </div>
        ) : (
          <>
            <h1 className="login-card__title">{t("auth.resetTitle")}</h1>
            <p className="login-card__subtitle">{t("auth.resetSubtitle")}</p>
            <form className="login-form" onSubmit={handleSave} noValidate>
              <Field id="rp-new" type="password" label={t("auth.newPasswordLabel")} value={password}
                onChange={setPassword} autoComplete="new-password" placeholder="••••••••" hint={t("auth.passwordHint", MIN_PASSWORD)} />
              <Field id="rp-confirm" type="password" label={t("auth.confirmPasswordLabel")} value={confirm}
                onChange={setConfirm} autoComplete="new-password" placeholder="••••••••" />
              <button type="submit" className="login-form__submit" disabled={busy}>
                {busy ? <Spinner /> : <KeyRound size={18} />} {busy ? t("auth.saving") : t("auth.saveNewPassword")}
              </button>
            </form>
            {error && <p className="login-form__error" role="alert">{error}</p>}
          </>
        )}
      </div>
    </div>
  );
}
