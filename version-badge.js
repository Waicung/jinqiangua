// @ts-check
/* ======================================================
   共享：右下角版本徽标
   ------------------------------------------------------
   Reads version.json (generated at deploy time) and shows the
   build version. Hidden when version.json is absent (local dev).
   ====================================================== */

/**
 * @param {HTMLElement | null} [el]
 * @param {string} [appName]
 */
export async function initVersionBadge(
  el = document.getElementById('version-badge'),
  appName = '周易起卦'
) {
  if (!el) return;
  try {
    const res = await fetch('version.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const v = await res.json();
    el.textContent = `v${v.version} · ${v.commit}`;
    el.title = [
      `${appName} v${v.version}`,
      `Git: ${v.describe}`,
      v.branch ? `分支: ${v.branch}` : null,
      `构建时间: ${v.buildTime}`,
    ]
      .filter(Boolean)
      .join('\n');
  } catch {
    el.style.display = 'none';
  }
}
