import { observeResize } from './observe-resize';
import type { PlaybackState } from '../../types/playback';
import { deckSteps, type DeckPose } from '../../domain/deck-sequence';
import { SPIN_DOWN_MS, SPIN_UP_MS, strobeSharpness } from '../../domain/turntable';
import {
  angleDelta, ARM_END, ARM_REST, ARM_START, armPointerAngle, coastDegrees, PLAY_OMEGA, pointerAngle, unprojectDeck,
  ratioFromArmAngle, scrubSeconds, stepSpin, type Spin,
} from '../../domain/vinyl-physics';
import type { PlaylistTrack, TurntableStyle } from '../../types/view';
import { VolumeKnob, type KnobPort } from './turntable-knob';
import { buildMinimalParts, type MinimalParts } from './turntable-minimal';
import { buildTurntableParts } from './turntable-parts';
import type { TurntableSound } from './turntable-sound';

const SETTLE_MS = 260;
const COAST_MS = 1400;
const REDUCED_SLOWDOWN = 4;
const MAX_FRAME_MS = 50;
const MAX_OMEGA = 2;
const TAP_DEGREES = 4;
const WARP_DEGREES = 0.5;
const VISIBILITY_CHECK_MS = 500;
const TILT_WIDE = 60;
const TILT_NARROW = 52;
const YAW_WIDE = -22;
const YAW_NARROW = -14;
const WIDE_PX = 480;
const NARROW_PX = 200;
const PARALLAX_DEGREES = 3;

export interface TurntableHost {
  position(): { time: number; duration: number } | null;
  seekTo(ratio: number): void;
  dropNeedle(): void;
  liftNeedle(): void;
}

interface Drag {
  kind: 'platter' | 'arm';
  pointerId: number;
  /** Platter: last pointer angle. Arm: unused. */
  last: number;
  /** Platter: net degrees dragged. */
  travelled: number;
  /** Arm: latest tonearm angle. */
  armDeg: number;
  at: number;
}

/**
 * Persistent record player. The view detaches and re-attaches `el` on every render,
 * so spin state lives here and a single rAF loop paints it onto custom properties.
 */
export class Turntable {
  readonly el: HTMLElement;
  private parts!: MinimalParts;
  private style: TurntableStyle = 'realistic';
  private pose: DeckPose = { open: false, armed: false };
  private port: KnobPort | null = null;
  private spin: Spin = { omega: 0, alpha: 0 };
  private angle = 0;
  private target = 0;
  private settleMs = SPIN_UP_MS;
  private state: PlaybackState = 'idle';
  private live = false;
  private labelUrl = '';
  private frame = 0;
  private lastNow = 0;
  private lastVisibleCheck = 0;
  private timers: number[] = [];
  private timerWin: Window | null = null;
  private drag: Drag | null = null;
  private frameWin: Window | null = null;
  private tilt = TILT_WIDE;
  private yaw = YAW_WIDE;
  private readonly stopResize: () => void;
  private knob: VolumeKnob | null = null;

  constructor(private readonly sound: TurntableSound, private readonly host: TurntableHost) {
    this.el = createDiv({ cls: 'onp-turntable is-idle' });
    this.el.setAttribute('aria-hidden', 'true');
    this.stopResize = observeResize(this.el, (rect) => this.setTilt(rect.width));
    this.el.addEventListener('pointermove', (e) => this.parallax(e));
    this.el.addEventListener('pointerleave', () => this.el.setCssProps({ '--onp-px': '0', '--onp-py': '0' }));
    this.mount();
  }

  /** Builds the parts for the current style; the root, spin and pose outlive a style switch. */
  private mount(): void {
    this.knob?.destroy();
    this.knob = null;
    this.el.empty();
    const minimal = this.style === 'minimal';
    this.el.toggleClass('is-minimal', minimal);
    this.el.toggleClass('is-realistic', !minimal);
    this.parts = minimal ? buildMinimalParts(this.el) : buildTurntableParts(this.el);
    this.parts.platter.addEventListener('pointerdown', (e) => this.grabPlatter(e));
    this.parts.grab.addEventListener('pointerdown', (e) => this.grabArm(e));
    this.parts.platter.addEventListener('pointermove', (e) => this.moveDrag(e));
    this.parts.grab.addEventListener('pointermove', (e) => this.moveDrag(e));
    for (const target of [this.parts.platter, this.parts.grab]) {
      for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
        target.addEventListener(type, () => this.release());
      }
    }
    if (!minimal) {
      this.setTilt(this.el.clientWidth);
      if (this.port) this.knob = new VolumeKnob(this.parts.scene, this.port);
    }
    this.paint();
  }

  private setStyle(style: TurntableStyle): void {
    if (style === this.style) return;
    this.style = style;
    this.mount();
  }

  /** Fires the instant the needle touches down, in step with the thock. */
  onLanded: (() => void) | null = null;

  update(track: PlaylistTrack | null, state: PlaybackState, soundsOn: boolean, style: TurntableStyle = 'realistic'): void {
    // Loading is play intent: the needle must land before audio can report playing.
    if (state === 'loading') state = 'playing';
    this.setStyle(style);
    this.sound.setEnabled(soundsOn);
    // Flush styles so the arm transition starts from the pre-render state after re-attach.
    void this.el.offsetWidth;
    this.setLabel(track?.thumbnailUrl ?? '');
    this.live = track !== null;
    this.el.toggleClass('is-live', this.live);
    if (state === this.state) return;
    const wasPlaying = this.state === 'playing';
    this.state = state;
    this.el.removeClasses(['is-idle', 'is-paused', 'is-playing']);
    this.el.addClass(`is-${state}`);
    this.runSequence(state === 'playing', soundsOn, wasPlaying);
  }

  /** Steps come from the pure plan; each one moves the pose, and the CSS transitions do the rest. */
  private runSequence(playing: boolean, soundsOn: boolean, wasPlaying: boolean): void {
    this.cancelTimers();
    const win = this.el.win;
    this.timerWin = win;
    if (!playing && wasPlaying && soundsOn) this.sound.lift();
    for (const step of deckSteps(playing, this.pose, this.style === 'realistic', this.slowdown > 1, this.state === 'paused')) {
      const run = () => this.applyStep(step.pose, step.land === true, soundsOn);
      if (step.atMs <= 0) run();
      else this.timers.push(win.setTimeout(run, step.atMs));
    }
  }

  private applyStep(pose: Partial<DeckPose>, land: boolean, soundsOn: boolean): void {
    const armed = pose.armed;
    this.pose = { ...this.pose, ...pose };
    this.el.toggleClass('is-open', this.pose.open);
    this.el.toggleClass('is-armed', this.pose.armed);
    if (armed !== undefined) {
      if (armed && soundsOn) this.sound.drop();
      this.retarget();
    }
    if (!land) return;
    this.el.addClass('is-landing');
    this.onLanded?.();
    this.timers.push(this.el.win.setTimeout(() => this.el.removeClass('is-landing'), SETTLE_MS));
  }

  setProgress(ratio: number): void {
    this.kick();
    if (this.drag) return;
    this.setCreep(ratio);
  }

  /** Wires the volume knob to the plugin's volume model; replaces any earlier knob. */
  attachVolume(port: KnobPort): void {
    this.knob?.destroy();
    this.port = port;
    this.knob = this.style === 'realistic' ? new VolumeKnob(this.parts.scene, port) : null;
  }

  destroy(): void {
    this.knob?.destroy();
    this.stopResize();
    this.cancelTimers();
    this.frameWin?.cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.drag = null;
    this.el.remove();
  }

  /** Camera eases from a low 3/4 angle toward a flatter one as the card narrows, with no breakpoint. */
  private setTilt(width: number): void {
    if (width <= 0 || this.style === 'minimal') return;
    const t = Math.min(Math.max((width - NARROW_PX) / (WIDE_PX - NARROW_PX), 0), 1);
    this.tilt = TILT_NARROW + (TILT_WIDE - TILT_NARROW) * t;
    this.yaw = YAW_NARROW + (YAW_WIDE - YAW_NARROW) * t;
    this.el.setCssProps({ '--onp-tilt': `${this.tilt.toFixed(1)}deg`, '--onp-yaw': `${this.yaw.toFixed(1)}deg` });
  }

  private parallax(e: PointerEvent): void {
    if (this.drag || this.slowdown > 1 || this.style === 'minimal') return;
    const rect = this.el.getBoundingClientRect();
    if (rect.width === 0) return;
    const nx = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
    const ny = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
    this.el.setCssProps({ '--onp-px': (nx * PARALLAX_DEGREES).toFixed(2), '--onp-py': (ny * PARALLAX_DEGREES).toFixed(2) });
  }

  /** Pointer angle around a screen-space centre, undoing the deck's tilt so the circle reads round. */
  private deckAngle(cx: number, cy: number, e: PointerEvent): number {
    const { x, y } = unprojectDeck(e.clientX - cx, e.clientY - cy, this.camTilt, this.camYaw);
    return pointerAngle(0, 0, x, y);
  }

  private get camTilt(): number {
    return this.style === 'minimal' ? 0 : this.tilt;
  }

  private get camYaw(): number {
    return this.style === 'minimal' ? 0 : this.yaw;
  }

  private setCreep(ratio: number): void {
    this.el.setCssProps({ '--onp-arm-creep': ratio.toFixed(3) });
  }

  private setLabel(thumbnailUrl: string): void {
    if (thumbnailUrl === this.labelUrl) return;
    this.labelUrl = thumbnailUrl;
    this.el.setCssProps({ '--onp-label-image': thumbnailUrl ? `url("${thumbnailUrl}")` : 'none' });
  }

  private cancelTimers(): void {
    for (const id of this.timers) this.timerWin?.clearTimeout(id);
    this.timers = [];
    this.el.removeClass('is-landing');
  }

  private get slowdown(): number {
    return this.el.win.matchMedia('(prefers-reduced-motion: reduce)').matches ? REDUCED_SLOWDOWN : 1;
  }

  private retarget(): void {
    const playing = this.pose.armed;
    this.target = playing ? PLAY_OMEGA / this.slowdown : 0;
    this.settleMs = (playing ? SPIN_UP_MS : Math.max(SPIN_DOWN_MS, COAST_MS)) * (this.slowdown > 1 ? 1.5 : 1);
    this.kick();
  }

  private kick(): void {
    const win = this.el.win;
    if (this.frame && this.frameWin === win) return;
    // A frame requested before the deck moved into a popout may never fire in a hidden window.
    this.frameWin?.cancelAnimationFrame(this.frame);
    this.frame = 0;
    if (this.target === 0 && Math.abs(this.spin.omega) < 1e-5 && !this.drag) return;
    this.frameWin = win;
    this.lastNow = win.performance.now();
    this.lastVisibleCheck = this.lastNow;
    this.frame = win.requestAnimationFrame((now) => this.tick(now));
  }

  /** Pauses itself when the view is hidden; `setProgress` (1 Hz) wakes it again. */
  private tick(now: number): void {
    this.frame = 0;
    const dt = Math.min(now - this.lastNow, MAX_FRAME_MS);
    this.lastNow = now;
    if (!this.drag) {
      this.spin = stepSpin(this.spin, this.target, dt, this.settleMs);
      this.angle = (this.angle + this.spin.omega * dt) % 360;
    }
    this.paint();
    if (this.drag || this.target > 0 || Math.abs(this.spin.omega) > 1e-4) {
      if (now - this.lastVisibleCheck > VISIBILITY_CHECK_MS) {
        this.lastVisibleCheck = now;
        if (!this.el.isShown()) return;
      }
      this.frameWin = this.el.win;
      this.frame = this.frameWin.requestAnimationFrame((next) => this.tick(next));
    } else {
      this.spin = { omega: 0, alpha: 0 };
    }
  }

  private paint(): void {
    const speed = this.spin.omega / PLAY_OMEGA;
    const radians = (this.angle * Math.PI) / 180;
    const tilt = WARP_DEGREES * Math.min(Math.abs(speed), 1.5);
    this.parts.platter.setCssProps({ '--onp-angle': `${this.angle.toFixed(2)}deg` });
    this.parts.warp.setCssProps({
      '--onp-speed': speed.toFixed(3),
      '--onp-strobe': strobeSharpness(speed).toFixed(2),
      '--onp-tilt-x': `${(tilt * Math.sin(radians)).toFixed(3)}deg`,
      '--onp-tilt-y': `${(tilt * Math.cos(radians)).toFixed(3)}deg`,
    });
  }

  private grabPlatter(e: PointerEvent): void {
    if (!this.live || this.drag || e.button !== 0) return;
    const rect = this.parts.platter.getBoundingClientRect();
    this.begin(e, this.parts.platter, {
      kind: 'platter',
      pointerId: e.pointerId,
      last: this.deckAngle(rect.left + rect.width / 2, rect.top + rect.height / 2, e),
      travelled: 0,
      armDeg: 0,
      at: e.timeStamp,
    });
    this.spin = { omega: 0, alpha: 0 };
  }

  private grabArm(e: PointerEvent): void {
    if (!this.live || this.drag || e.button !== 0) return;
    const armDeg = this.armDegrees(e);
    this.begin(e, this.parts.grab, {
      kind: 'arm', pointerId: e.pointerId, last: 0, travelled: 0, armDeg, at: e.timeStamp,
    });
    this.applyArm(armDeg);
  }

  private begin(e: PointerEvent, target: Element, drag: Drag): void {
    e.preventDefault();
    target.setPointerCapture(e.pointerId);
    this.drag = drag;
    this.el.addClass(drag.kind === 'arm' ? 'is-grabbing-arm' : 'is-scrubbing');
    this.kick();
  }

  private armDegrees(e: PointerEvent): number {
    const rect = this.parts.hub.getBoundingClientRect();
    const cy = rect.top + rect.height / 2;
    const { x, y } = unprojectDeck(e.clientX - (rect.left + rect.width / 2), e.clientY - cy, this.camTilt, this.camYaw);
    return Math.min(Math.max(armPointerAngle(0, 0, x, y), ARM_REST), ARM_END + 2);
  }

  private moveDrag(e: PointerEvent): void {
    const drag = this.drag;
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (drag.kind === 'arm') {
      drag.armDeg = this.armDegrees(e);
      this.applyArm(drag.armDeg);
      return;
    }
    const rect = this.parts.platter.getBoundingClientRect();
    const now = this.deckAngle(rect.left + rect.width / 2, rect.top + rect.height / 2, e);
    const delta = angleDelta(drag.last, now);
    const elapsed = Math.max(e.timeStamp - drag.at, 1);
    drag.last = now;
    drag.at = e.timeStamp;
    drag.travelled += delta;
    this.angle = (this.angle + delta) % 360;
    const instant = Math.min(Math.max(delta / elapsed, -MAX_OMEGA), MAX_OMEGA);
    this.spin = { omega: this.spin.omega * 0.6 + instant * 0.4, alpha: 0 };
    this.previewScrub(drag.travelled);
  }

  /** The arm shows where the record would seek to while the platter is being dragged. */
  private previewScrub(degrees: number): void {
    const pos = this.host.position();
    if (!pos || pos.duration <= 0) return;
    this.setCreep(Math.min(Math.max((pos.time + scrubSeconds(degrees)) / pos.duration, 0), 1));
  }

  private applyArm(deg: number): void {
    this.el.setCssProps({ '--onp-arm-drag': `${deg.toFixed(2)}deg` });
    if (deg >= ARM_START) this.setCreep(ratioFromArmAngle(deg));
  }

  private release(): void {
    const drag = this.drag;
    if (!drag) return;
    this.drag = null;
    this.el.removeClasses(['is-grabbing-arm', 'is-scrubbing']);
    if (drag.kind === 'arm') this.releaseArm(drag.armDeg);
    else this.releasePlatter(drag.travelled);
    this.kick();
  }

  private releaseArm(deg: number): void {
    if (deg < ARM_START - 2) {
      if (this.state === 'playing') this.host.liftNeedle();
      return;
    }
    const ratio = ratioFromArmAngle(deg);
    this.host.seekTo(ratio);
    this.setCreep(ratio);
    if (this.state !== 'playing') this.host.dropNeedle();
  }

  private releasePlatter(travelled: number): void {
    if (Math.abs(travelled) < TAP_DEGREES) {
      if (this.state === 'playing') this.host.liftNeedle();
      else this.host.dropNeedle();
      return;
    }
    const pos = this.host.position();
    const coast = coastDegrees(this.spin.omega, this.target, this.settleMs);
    if (!pos || pos.duration <= 0) return;
    const ratio = Math.min(Math.max((pos.time + scrubSeconds(travelled + coast)) / pos.duration, 0), 1);
    this.host.seekTo(ratio);
    this.setCreep(ratio);
  }
}
