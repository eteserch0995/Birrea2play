// Iconos SVG propios para la tab bar (reemplazo de emojis).
// Paths dibujados a mano, viewBox 24x24, stroke consistente.
import React from 'react';
import Svg, { Path, Rect, Circle, Line } from 'react-native-svg';

const BASE_PROPS = {
  strokeWidth: 1.7,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  fill: 'none',
};

export function IconHome({ color = '#fff', size = 22 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M4 11L12 4L20 11" {...BASE_PROPS} stroke={color} />
      <Path d="M6 10V20H18V10" {...BASE_PROPS} stroke={color} />
      <Path d="M10 20V14H14V20" {...BASE_PROPS} stroke={color} />
    </Svg>
  );
}

export function IconCalendar({ color = '#fff', size = 22 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Rect x="4" y="5" width="16" height="15" rx="2" {...BASE_PROPS} stroke={color} />
      <Path d="M4 9H20" {...BASE_PROPS} stroke={color} />
      <Path d="M8 3V6" {...BASE_PROPS} stroke={color} />
      <Path d="M16 3V6" {...BASE_PROPS} stroke={color} />
      <Line x1="8" y1="13" x2="8" y2="13" {...BASE_PROPS} stroke={color} />
      <Line x1="12" y1="13" x2="12" y2="13" {...BASE_PROPS} stroke={color} />
      <Line x1="16" y1="13" x2="16" y2="13" {...BASE_PROPS} stroke={color} />
    </Svg>
  );
}

export function IconWallet({ color = '#fff', size = 22 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Rect x="3" y="6" width="18" height="13" rx="2" {...BASE_PROPS} stroke={color} />
      <Path d="M3 10H21" {...BASE_PROPS} stroke={color} />
      <Path d="M16 14H18" {...BASE_PROPS} stroke={color} />
    </Svg>
  );
}

export function IconBag({ color = '#fff', size = 22 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M7 8H17L18 20H6L7 8Z" {...BASE_PROPS} stroke={color} />
      <Path d="M9 8V6C9 4.3 10.3 3 12 3C13.7 3 15 4.3 15 6V8" {...BASE_PROPS} stroke={color} />
    </Svg>
  );
}

export function IconNews({ color = '#fff', size = 22 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Rect x="4" y="5" width="16" height="14" rx="1.5" {...BASE_PROPS} stroke={color} />
      <Path d="M7 9H12" {...BASE_PROPS} stroke={color} />
      <Path d="M7 12H17" {...BASE_PROPS} stroke={color} />
      <Path d="M7 15H17" {...BASE_PROPS} stroke={color} />
      <Rect x="14" y="8" width="3" height="3" {...BASE_PROPS} stroke={color} />
    </Svg>
  );
}

export function IconGift({ color = '#fff', size = 22 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Rect x="4" y="9" width="16" height="4" {...BASE_PROPS} stroke={color} />
      <Rect x="5" y="13" width="14" height="7" {...BASE_PROPS} stroke={color} />
      <Path d="M12 9V20" {...BASE_PROPS} stroke={color} />
      <Path d="M12 9C12 9 9 9 9 6.5C9 5.1 10.1 4 11.3 4C12.5 4 12 7 12 9Z" {...BASE_PROPS} stroke={color} />
      <Path d="M12 9C12 9 15 9 15 6.5C15 5.1 13.9 4 12.7 4C11.5 4 12 7 12 9Z" {...BASE_PROPS} stroke={color} />
    </Svg>
  );
}

export function IconGear({ color = '#fff', size = 22 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M4 7H14" {...BASE_PROPS} stroke={color} />
      <Path d="M16 7H20" {...BASE_PROPS} stroke={color} />
      <Circle cx="15" cy="7" r="2" {...BASE_PROPS} stroke={color} />
      <Path d="M4 12H8" {...BASE_PROPS} stroke={color} />
      <Path d="M10 12H20" {...BASE_PROPS} stroke={color} />
      <Circle cx="9" cy="12" r="2" {...BASE_PROPS} stroke={color} />
      <Path d="M4 17H12" {...BASE_PROPS} stroke={color} />
      <Path d="M14 17H20" {...BASE_PROPS} stroke={color} />
      <Circle cx="13" cy="17" r="2" {...BASE_PROPS} stroke={color} />
    </Svg>
  );
}

export function IconField({ color = '#fff', size = 22 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Rect x="3" y="5" width="18" height="14" rx="1.5" {...BASE_PROPS} stroke={color} />
      <Path d="M12 5V19" {...BASE_PROPS} stroke={color} />
      <Circle cx="12" cy="12" r="3" {...BASE_PROPS} stroke={color} />
    </Svg>
  );
}

export function IconTrophy({ color = '#fff', size = 22 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M7 4H17V9C17 12 15 14 12 14C9 14 7 12 7 9V4Z" {...BASE_PROPS} stroke={color} />
      <Path d="M7 5H4V7C4 9 5.5 10 7 10" {...BASE_PROPS} stroke={color} />
      <Path d="M17 5H20V7C20 9 18.5 10 17 10" {...BASE_PROPS} stroke={color} />
      <Path d="M12 14V17" {...BASE_PROPS} stroke={color} />
      <Path d="M9 20H15" {...BASE_PROPS} stroke={color} />
      <Path d="M9 20C9 18.3 10.3 17 12 17C13.7 17 15 18.3 15 20" {...BASE_PROPS} stroke={color} />
    </Svg>
  );
}
