/**
 * Reusable spinner widget for long operations.
 *
 * SHIP-V1-GAPS.md #93. A spinner is a tiny `Text` widget whose label cycles
 * through 10 braille glyphs every 80ms. Callers request a slot via
 * `createSpinner(label)`; the slot returns an opaque numeric id that they can
 * later `startSpinner(id)` / `stopSpinner(id)` / `setSpinnerLabel(id, text)`
 * / `disposeSpinner(id)`.
 *
 * Perry constraints (closures capture by value, no Map iteration in widget
 * callbacks) force a fixed-slot model — 8 slots are enough for v1 (git
 * push/pull, search, AI stream, tasks, etc. — none of them overlap heavily).
 *
 * The single shared `setInterval` is lazily started on the first
 * `startSpinner` call and runs forever — no need to stop it; the cost of a
 * 12.5 Hz tick with 8 no-op branches is negligible.
 */
import { Text, textSetString } from 'perry/ui';

const FRAMES = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏';
const FRAME_COUNT = 10;

let spinner0: unknown = null;
let spinner1: unknown = null;
let spinner2: unknown = null;
let spinner3: unknown = null;
let spinner4: unknown = null;
let spinner5: unknown = null;
let spinner6: unknown = null;
let spinner7: unknown = null;

let used0: number = 0;
let used1: number = 0;
let used2: number = 0;
let used3: number = 0;
let used4: number = 0;
let used5: number = 0;
let used6: number = 0;
let used7: number = 0;

let active0: number = 0;
let active1: number = 0;
let active2: number = 0;
let active3: number = 0;
let active4: number = 0;
let active5: number = 0;
let active6: number = 0;
let active7: number = 0;

let label0: string = '';
let label1: string = '';
let label2: string = '';
let label3: string = '';
let label4: string = '';
let label5: string = '';
let label6: string = '';
let label7: string = '';

let frame: number = 0;
let timerStarted: number = 0;

function getWidget(id: number): unknown {
  if (id === 0) return spinner0;
  if (id === 1) return spinner1;
  if (id === 2) return spinner2;
  if (id === 3) return spinner3;
  if (id === 4) return spinner4;
  if (id === 5) return spinner5;
  if (id === 6) return spinner6;
  if (id === 7) return spinner7;
  return null;
}

function getUsed(id: number): number {
  if (id === 0) return used0;
  if (id === 1) return used1;
  if (id === 2) return used2;
  if (id === 3) return used3;
  if (id === 4) return used4;
  if (id === 5) return used5;
  if (id === 6) return used6;
  if (id === 7) return used7;
  return 0;
}

function setUsed(id: number, v: number): void {
  if (id === 0) used0 = v;
  if (id === 1) used1 = v;
  if (id === 2) used2 = v;
  if (id === 3) used3 = v;
  if (id === 4) used4 = v;
  if (id === 5) used5 = v;
  if (id === 6) used6 = v;
  if (id === 7) used7 = v;
}

function getActive(id: number): number {
  if (id === 0) return active0;
  if (id === 1) return active1;
  if (id === 2) return active2;
  if (id === 3) return active3;
  if (id === 4) return active4;
  if (id === 5) return active5;
  if (id === 6) return active6;
  if (id === 7) return active7;
  return 0;
}

function setActive(id: number, v: number): void {
  if (id === 0) active0 = v;
  if (id === 1) active1 = v;
  if (id === 2) active2 = v;
  if (id === 3) active3 = v;
  if (id === 4) active4 = v;
  if (id === 5) active5 = v;
  if (id === 6) active6 = v;
  if (id === 7) active7 = v;
}

function getLabel(id: number): string {
  if (id === 0) return label0;
  if (id === 1) return label1;
  if (id === 2) return label2;
  if (id === 3) return label3;
  if (id === 4) return label4;
  if (id === 5) return label5;
  if (id === 6) return label6;
  if (id === 7) return label7;
  return '';
}

function setLabel(id: number, s: string): void {
  if (id === 0) label0 = s;
  if (id === 1) label1 = s;
  if (id === 2) label2 = s;
  if (id === 3) label3 = s;
  if (id === 4) label4 = s;
  if (id === 5) label5 = s;
  if (id === 6) label6 = s;
  if (id === 7) label7 = s;
}

function paintSlot(id: number): void {
  const w = getWidget(id);
  if (!w) return;
  let s = '';
  if (getActive(id) > 0) {
    s += FRAMES.charAt(frame);
    const lbl = getLabel(id);
    if (lbl.length > 0) {
      s += ' ';
      s += lbl;
    }
  }
  textSetString(w, s);
}

function tickAll(): void {
  frame = frame + 1;
  if (frame >= FRAME_COUNT) frame = 0;
  // Only paint slots that are both allocated AND running.
  if (used0 > 0 && active0 > 0) paintSlot(0);
  if (used1 > 0 && active1 > 0) paintSlot(1);
  if (used2 > 0 && active2 > 0) paintSlot(2);
  if (used3 > 0 && active3 > 0) paintSlot(3);
  if (used4 > 0 && active4 > 0) paintSlot(4);
  if (used5 > 0 && active5 > 0) paintSlot(5);
  if (used6 > 0 && active6 > 0) paintSlot(6);
  if (used7 > 0 && active7 > 0) paintSlot(7);
}

function ensureTimer(): void {
  if (timerStarted > 0) return;
  timerStarted = 1;
  setInterval(() => { tickAll(); }, 80);
}

/**
 * Allocate a spinner. Returns an opaque slot id (0–7) and the underlying Text
 * widget the caller embeds in its layout. Returns id `-1` when no slot is free.
 */
export function createSpinner(initialLabel: string): { id: number; widget: unknown } {
  for (let i = 0; i < 8; i++) {
    if (getUsed(i) < 1) {
      const w = Text('');
      if (i === 0) spinner0 = w;
      if (i === 1) spinner1 = w;
      if (i === 2) spinner2 = w;
      if (i === 3) spinner3 = w;
      if (i === 4) spinner4 = w;
      if (i === 5) spinner5 = w;
      if (i === 6) spinner6 = w;
      if (i === 7) spinner7 = w;
      setUsed(i, 1);
      setActive(i, 0);
      setLabel(i, initialLabel);
      paintSlot(i);
      return { id: i, widget: w };
    }
  }
  return { id: -1, widget: null };
}

export function startSpinner(id: number): void {
  if (getUsed(id) < 1) return;
  setActive(id, 1);
  ensureTimer();
  paintSlot(id);
}

export function stopSpinner(id: number): void {
  if (getUsed(id) < 1) return;
  setActive(id, 0);
  paintSlot(id);
}

export function setSpinnerLabel(id: number, label: string): void {
  if (getUsed(id) < 1) return;
  setLabel(id, label);
  paintSlot(id);
}

export function disposeSpinner(id: number): void {
  if (getUsed(id) < 1) return;
  setActive(id, 0);
  setLabel(id, '');
  setUsed(id, 0);
  const w = getWidget(id);
  if (w) textSetString(w, '');
}
