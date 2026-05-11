export const DEFAULT_PRIMARY_THEME_COLOR = '#0f766e';
export const DEFAULT_SECONDARY_THEME_COLOR = '#dc2626';

export function isThemeHexColor(value: unknown): value is string {
    return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value.trim());
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
    const nr = r / 255;
    const ng = g / 255;
    const nb = b / 255;
    const max = Math.max(nr, ng, nb);
    const min = Math.min(nr, ng, nb);
    const lightness = (max + min) / 2;

    if (max === min) {
        return [0, 0, lightness * 100];
    }

    const delta = max - min;
    const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
    let hue = 0;

    if (max === nr) {
        hue = ((ng - nb) / delta + (ng < nb ? 6 : 0)) / 6;
    } else if (max === ng) {
        hue = ((nb - nr) / delta + 2) / 6;
    } else {
        hue = ((nr - ng) / delta + 4) / 6;
    }

    return [hue * 360, saturation * 100, lightness * 100];
}

function hslToHex(h: number, s: number, l: number): string {
    const saturation = s / 100;
    const lightness = l / 100;
    const a = saturation * Math.min(lightness, 1 - lightness);
    const f = (n: number) => {
        const k = (n + h / 30) % 12;
        return lightness - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    };
    const toHex = (x: number) => Math.round(x * 255).toString(16).padStart(2, '0');
    return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
}

export function buildThemeColorVars(
    family: 'primary' | 'secondary',
    color: string,
): Record<string, string> {
    if (!isThemeHexColor(color)) {
        return {};
    }

    const hex = color.trim();
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const [h, s, l] = rgbToHsl(r, g, b);
    const hover = hslToHex(h, s, Math.max(0, l - 8));
    const light = hslToHex(h, Math.min(100, s + 20), 96);
    const tone50 = hslToHex(h, Math.min(100, s + 10), 93);
    const tone100 = hslToHex(h, Math.min(100, s + 5), 88);
    const tone200 = hslToHex(h, s, 80);
    const tone700 = hslToHex(h, s, Math.max(0, l - 8));
    const tone800 = hslToHex(h, s, Math.max(0, l - 16));

    const vars: Record<string, string> = {
        [`--color-${family}`]: hex,
        [`--color-${family}-hover`]: hover,
        [`--color-${family}-light`]: light,
        [`--color-${family}-50`]: tone50,
        [`--color-${family}-100`]: tone100,
        [`--color-${family}-200`]: tone200,
        [`--color-${family}-600`]: hex,
        [`--color-${family}-700`]: tone700,
        [`--color-${family}-800`]: tone800,
    };

    if (family === 'primary') {
        vars['--color-primary-soft'] = tone100;
        vars['--color-primary-surface'] = light;
        vars['--sidebar-active-bg'] = `${hex}33`;
        vars['--sidebar-active-text'] = hslToHex(h, Math.min(100, s + 15), Math.min(85, l + 30));
    }

    return vars;
}

export function applyThemeVars(root: HTMLElement, vars: Record<string, string>) {
    for (const [name, value] of Object.entries(vars)) {
        root.style.setProperty(name, value);
    }
}

export function applyCompanyThemeColors(
    root: HTMLElement,
    primaryColor?: string,
    secondaryColor?: string,
) {
    const primary = isThemeHexColor(primaryColor) ? primaryColor.trim() : DEFAULT_PRIMARY_THEME_COLOR;
    const secondary = isThemeHexColor(secondaryColor) ? secondaryColor.trim() : DEFAULT_SECONDARY_THEME_COLOR;

    applyThemeVars(root, buildThemeColorVars('primary', primary));
    applyThemeVars(root, buildThemeColorVars('secondary', secondary));
}
