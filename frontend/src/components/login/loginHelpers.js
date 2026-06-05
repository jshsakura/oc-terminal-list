export const OTP_CODE_PATTERN = /^\d{6}$/;
export const REMEMBER_USERNAME_KEY = 'iterm:login:remember-username';

export const readAuthResponse = async (response, fallbackMessage) => {
  let data = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }
  if (!response.ok) throw new Error(data.detail || fallbackMessage);
  return data;
};

export const themeValue = (ui, key, fallback) => ui?.[key] || fallback;
export const alpha = (value, suffix, fallback) => (/^#[0-9a-f]{6}$/i.test(value || '') ? `${value}${suffix}` : fallback);

export const ANIMATION_CSS = `@keyframes login-card-in {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes login-shake {
  0%, 100% { transform: translateX(0); }
  20%, 60% { transform: translateX(-4px); }
  40%, 80% { transform: translateX(4px); }
}
@keyframes login-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
.login-scroll::-webkit-scrollbar { display: none; }
.login-scroll { -ms-overflow-style: none; scrollbar-width: none; }`;

let loginStyleInjected = false;
export const ensureLoginStyle = () => {
  if (typeof document === 'undefined' || loginStyleInjected) return;
  if (!document.getElementById('login-anim-style')) {
    const el = document.createElement('style');
    el.id = 'login-anim-style';
    el.textContent = ANIMATION_CSS;
    document.head.appendChild(el);
    loginStyleInjected = true;
  }
};
