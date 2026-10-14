function luminanceOf(css: string): number | null {
  const m = /rgba?\(([\d.]+), ([\d.]+), ([\d.]+)/.exec(css);
  if (m === null) return null;
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(+m[1]!) + 0.7152 * channel(+m[2]!) + 0.0722 * channel(+m[3]!);
}

export function applyThemeAdaptation(): void {
  const bg = getComputedStyle(document.body).backgroundColor;
  const lum = luminanceOf(bg) ?? 1;
  document.body.dataset.srBg = lum < 0.25 ? "dark" : "light";
}
export function watchThemeAdaptation(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = undefined;
      applyThemeAdaptation();
    }, 200);
  };
  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { attributes: true, attributeFilter: ["class", "style"] });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style"] });
  applyThemeAdaptation();
  return () => observer.disconnect();
}
