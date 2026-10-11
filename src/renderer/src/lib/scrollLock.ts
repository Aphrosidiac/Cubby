/**
 * Page scroll lock shared by every overlay (modal, drawer, palette). Counted,
 * so a modal closing on top of an open drawer doesn't unlock the page under
 * the drawer.
 */
let n = 0;
export function lockScroll() { if (n++ === 0) document.documentElement.style.overflow = 'hidden'; }
export function unlockScroll() { if (n > 0 && --n === 0) document.documentElement.style.overflow = ''; }
