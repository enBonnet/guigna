export const ANIMATIONS = [
    ['fade', 'Fade'],
    ['left-right', 'Slide left to right'],
    ['right-left', 'Slide right to left'],
    ['top-bottom', 'Slide top to bottom'],
    ['bottom-top', 'Slide bottom to top'],
];

export const DEFAULT_ANIMATION = 'fade';

// Sentinel for the `position` GSettings key meaning "append at the end of the
// panel box". Any negative value is treated as POSITION_APPEND for robustness.
export const POSITION_APPEND = -1;

export function normalizeAnimation(id) {
    return ANIMATIONS.some(([choice]) => choice === id) ? id : DEFAULT_ANIMATION;
}

export function isAppendPosition(position) {
    return position < 0;
}
