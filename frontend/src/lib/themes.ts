export interface Theme {
  name: string;
  label: string;
  cssVars: {
    light: Record<string, string>;
    dark: Record<string, string>;
  };
}

// Base colors yang sama untuk semua tema (kecuali primary dan primary-foreground)
const baseLightColors: Record<string, string> = {
  background: "oklch(1 0 0)",
  foreground: "oklch(0.145 0 0)",
  card: "oklch(1 0 0)",
  "card-foreground": "oklch(0.145 0 0)",
  popover: "oklch(1 0 0)",
  "popover-foreground": "oklch(0.145 0 0)",
  secondary: "oklch(0.967 0.001 286.375)",
  "secondary-foreground": "oklch(0.21 0.006 285.885)",
  muted: "oklch(0.97 0 0)",
  "muted-foreground": "oklch(0.556 0 0)",
  accent: "oklch(0.97 0 0)",
  "accent-foreground": "oklch(0.205 0 0)",
  destructive: "oklch(0.58 0.22 27)",
  border: "oklch(0.922 0 0)",
  input: "oklch(0.922 0 0)",
  ring: "oklch(0.708 0 0)",
};

const baseDarkColors: Record<string, string> = {
  background: "oklch(0.145 0 0)",
  foreground: "oklch(0.985 0 0)",
  card: "oklch(0.205 0 0)",
  "card-foreground": "oklch(0.985 0 0)",
  popover: "oklch(0.205 0 0)",
  "popover-foreground": "oklch(0.985 0 0)",
  secondary: "oklch(0.274 0.006 286.033)",
  "secondary-foreground": "oklch(0.985 0 0)",
  muted: "oklch(0.269 0 0)",
  "muted-foreground": "oklch(0.708 0 0)",
  accent: "oklch(0.371 0 0)",
  "accent-foreground": "oklch(0.985 0 0)",
  destructive: "oklch(0.704 0.191 22.216)",
  border: "oklch(1 0 0 / 10%)",
  input: "oklch(1 0 0 / 15%)",
  ring: "oklch(0.556 0 0)",
};

// Primary colors yang berbeda untuk setiap tema
interface PrimaryColors {
  light: {
    primary: string;
    "primary-foreground": string;
  };
  dark: {
    primary: string;
    "primary-foreground": string;
  };
}

const primaryColors: Record<string, PrimaryColors> = {
  amber: {
    light: {
      primary: "oklch(0.67 0.16 58)",
      "primary-foreground": "oklch(0.99 0.02 95)",
    },
    dark: {
      primary: "oklch(0.77 0.16 70)",
      "primary-foreground": "oklch(0.28 0.07 46)",
    },
  },
  blue: {
    light: {
      primary: "oklch(0.488 0.243 264.376)",
      "primary-foreground": "oklch(0.97 0.014 254.604)",
    },
    dark: {
      primary: "oklch(0.42 0.18 266)",
      "primary-foreground": "oklch(0.97 0.014 254.604)",
    },
  },
  cyan: {
    light: {
      primary: "oklch(0.61 0.11 222)",
      "primary-foreground": "oklch(0.98 0.02 201)",
    },
    dark: {
      primary: "oklch(0.71 0.13 215)",
      "primary-foreground": "oklch(0.30 0.05 230)",
    },
  },
  emerald: {
    light: {
      primary: "oklch(0.60 0.13 163)",
      "primary-foreground": "oklch(0.98 0.02 166)",
    },
    dark: {
      primary: "oklch(0.70 0.15 162)",
      "primary-foreground": "oklch(0.26 0.05 173)",
    },
  },
  fuchsia: {
    light: {
      primary: "oklch(0.59 0.26 323)",
      "primary-foreground": "oklch(0.98 0.02 320)",
    },
    dark: {
      primary: "oklch(0.67 0.26 322)",
      "primary-foreground": "oklch(0.98 0.02 320)",
    },
  },
  green: {
    light: {
      primary: "oklch(0.648 0.2 131.684)",
      "primary-foreground": "oklch(0.986 0.031 120.757)",
    },
    dark: {
      primary: "oklch(0.648 0.2 131.684)",
      "primary-foreground": "oklch(0.986 0.031 120.757)",
    },
  },
  indigo: {
    light: {
      primary: "oklch(0.51 0.23 277)",
      "primary-foreground": "oklch(0.96 0.02 272)",
    },
    dark: {
      primary: "oklch(0.59 0.20 277)",
      "primary-foreground": "oklch(0.96 0.02 272)",
    },
  },
  lime: {
    light: {
      primary: "oklch(0.65 0.18 132)",
      "primary-foreground": "oklch(0.99 0.03 121)",
    },
    dark: {
      primary: "oklch(0.77 0.20 131)",
      "primary-foreground": "oklch(0.27 0.07 132)",
    },
  },
  neutral: {
    light: {
      primary: "oklch(0.205 0 0)",
      "primary-foreground": "oklch(0.985 0 0)",
    },
    dark: {
      primary: "oklch(0.922 0 0)",
      "primary-foreground": "oklch(0.205 0 0)",
    },
  },
  orange: {
    light: {
      primary: "oklch(0.646 0.222 41.116)",
      "primary-foreground": "oklch(0.98 0.016 73.684)",
    },
    dark: {
      primary: "oklch(0.705 0.213 47.604)",
      "primary-foreground": "oklch(0.98 0.016 73.684)",
    },
  },
  pink: {
    light: {
      primary: "oklch(0.59 0.22 1)",
      "primary-foreground": "oklch(0.97 0.01 343)",
    },
    dark: {
      primary: "oklch(0.66 0.21 354)",
      "primary-foreground": "oklch(0.97 0.01 343)",
    },
  },
  purple: {
    light: {
      primary: "oklch(0.56 0.25 302)",
      "primary-foreground": "oklch(0.98 0.01 308)",
    },
    dark: {
      primary: "oklch(0.63 0.23 304)",
      "primary-foreground": "oklch(0.98 0.01 308)",
    },
  },
  red: {
    light: {
      primary: "oklch(0.577 0.245 27.325)",
      "primary-foreground": "oklch(0.971 0.013 17.38)",
    },
    dark: {
      primary: "oklch(0.637 0.237 25.331)",
      "primary-foreground": "oklch(0.971 0.013 17.38)",
    },
  },
  rose: {
    light: {
      primary: "oklch(0.586 0.253 17.585)",
      "primary-foreground": "oklch(0.969 0.015 12.422)",
    },
    dark: {
      primary: "oklch(0.645 0.246 16.439)",
      "primary-foreground": "oklch(0.969 0.015 12.422)",
    },
  },
  sky: {
    light: {
      primary: "oklch(0.59 0.14 242)",
      "primary-foreground": "oklch(0.98 0.01 237)",
    },
    dark: {
      primary: "oklch(0.68 0.15 237)",
      "primary-foreground": "oklch(0.29 0.06 243)",
    },
  },
  teal: {
    light: {
      primary: "oklch(0.60 0.10 185)",
      "primary-foreground": "oklch(0.98 0.01 181)",
    },
    dark: {
      primary: "oklch(0.70 0.12 183)",
      "primary-foreground": "oklch(0.28 0.04 193)",
    },
  },
  violet: {
    light: {
      primary: "oklch(0.541 0.281 293.009)",
      "primary-foreground": "oklch(0.969 0.016 293.756)",
    },
    dark: {
      primary: "oklch(0.606 0.25 292.717)",
      "primary-foreground": "oklch(0.969 0.016 293.756)",
    },
  },
  yellow: {
    light: {
      primary: "oklch(0.852 0.199 91.936)",
      "primary-foreground": "oklch(0.421 0.095 57.708)",
    },
    dark: {
      primary: "oklch(0.795 0.184 86.047)",
      "primary-foreground": "oklch(0.421 0.095 57.708)",
    },
  },
};

// Helper function untuk menggabungkan base colors dengan primary colors
function createTheme(
  name: string,
  label: string,
  primary: PrimaryColors
): Theme {
  return {
    name,
    label,
    cssVars: {
      light: { ...baseLightColors, ...primary.light },
      dark: { ...baseDarkColors, ...primary.dark },
    },
  };
}

export const themes: Theme[] = [
  createTheme("amber", "Amber", primaryColors.amber),
  createTheme("blue", "Blue", primaryColors.blue),
  createTheme("cyan", "Cyan", primaryColors.cyan),
  createTheme("emerald", "Emerald", primaryColors.emerald),
  createTheme("fuchsia", "Fuchsia", primaryColors.fuchsia),
  createTheme("green", "Green", primaryColors.green),
  createTheme("indigo", "Indigo", primaryColors.indigo),
  createTheme("lime", "Lime", primaryColors.lime),
  createTheme("neutral", "Neutral", primaryColors.neutral),
  createTheme("orange", "Orange", primaryColors.orange),
  createTheme("pink", "Pink", primaryColors.pink),
  createTheme("purple", "Purple", primaryColors.purple),
  createTheme("red", "Red", primaryColors.red),
  createTheme("rose", "Rose", primaryColors.rose),
  createTheme("sky", "Sky", primaryColors.sky),
  createTheme("teal", "Teal", primaryColors.teal),
  createTheme("violet", "Violet", primaryColors.violet),
  createTheme("yellow", "Yellow", primaryColors.yellow),
].sort((a, b) => a.name.localeCompare(b.name));

export function applyTheme(themeName: string) {
  const theme = themes.find((t) => t.name === themeName) || themes[0];
  const root = document.documentElement;
  const isDark = root.classList.contains("dark");
  const vars = isDark ? theme.cssVars.dark : theme.cssVars.light;

  Object.entries(vars).forEach(([key, value]) => {
    root.style.setProperty(`--${key}`, value);
  });
}
