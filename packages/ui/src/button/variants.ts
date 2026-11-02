/** Visual variants. A runtime list so specs, docs and tests can check against it (and it loads without JSX). */
export const BUTTON_VARIANTS = ['outline', 'primary'] as const;
export type ButtonVariant = (typeof BUTTON_VARIANTS)[number];
