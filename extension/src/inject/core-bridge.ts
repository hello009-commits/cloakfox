/**
 * Core Bridge — calls C++ engine window.setXxx() methods when available.
 *
 * These are self-destructing WebIDL methods exposed by Cloakfox's C++ patches.
 * Each method stores its value in RoverfoxStorageManager (per-container IPC),
 * then deletes itself from the window object.
 *
 * Returns true if C++ handled the signal, false if JS fallback is needed.
 */

import type { PRNG } from '@/lib/crypto';
import type { AssignedProfileData } from '@/types';

const win = window as Record<string, unknown>;

/** Try calling a C++ method. Returns true if it existed and was called. */
function callCore(method: string, ...args: unknown[]): boolean {
  const fn = win[method];
  if (typeof fn === 'function') {
    try {
      (fn as Function)(...args);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Apply all available C++ Core protections.
 * Returns a set of signal keys that were handled by Core (skip JS for these).
 */
export function applyCoreProtections(
  prng: PRNG,
  profile: AssignedProfileData | undefined,
  settings: Record<string, Record<string, string>>
): Set<string> {
  const handled = new Set<string>();

  // Canvas — setCanvasSeed(seed: number)
  if (settings.graphics?.canvas !== 'off') {
    const seed = prng.nextInt(1, 2147483647);
    if (callCore('setCanvasSeed', seed)) {
      handled.add('graphics.canvas');
    }
  }

  // Audio — setAudioFingerprintSeed(seed: number)
  if (settings.audio?.audioContext !== 'off') {
    const seed = prng.nextInt(1, 2147483647);
    if (callCore('setAudioFingerprintSeed', seed)) {
      handled.add('audio.audioContext');
      handled.add('audio.offlineAudio'); // Same C++ manager handles both
    }
  }

  // Navigator — setNavigatorUserAgent, setNavigatorPlatform, setNavigatorOscpu, setNavigatorHardwareConcurrency
  if (settings.navigator?.userAgent !== 'off' && profile?.userAgent) {
    const ua = profile.userAgent;
    let navHandled = true;
    navHandled = callCore('setNavigatorUserAgent', ua.userAgent || '') && navHandled;
    navHandled = callCore('setNavigatorPlatform', ua.platform || '') && navHandled;
    navHandled = callCore('setNavigatorOscpu', ua.oscpu || '') && navHandled;
    if (navHandled) handled.add('navigator.userAgent');
  }

  if (settings.hardware?.hardwareConcurrency !== 'off' && profile) {
    const cores = profile.hardwareConcurrency || 8;
    if (callCore('setNavigatorHardwareConcurrency', cores)) {
      handled.add('hardware.hardwareConcurrency');
    }
  }

  // Screen — setScreenDimensions(width, height), setScreenColorDepth(depth)
  if (settings.hardware?.screen !== 'off' && profile?.screen) {
    const s = profile.screen;
    let screenHandled = callCore('setScreenDimensions', s.width, s.height);
    callCore('setScreenColorDepth', s.colorDepth || 24);
    if (screenHandled) handled.add('hardware.screen');
  }

  // Fonts — setFontList(fonts: string), setFontSpacingSeed(seed: number)
  if (settings.fonts?.enumeration !== 'off') {
    const seed = prng.nextInt(1, 2147483647);
    if (callCore('setFontSpacingSeed', seed)) {
      handled.add('fonts.cssDetection'); // Font metrics handled by C++
    }
    // setFontList needs a comma-separated list — JS spoofer handles the list generation
    // so we don't mark fonts.enumeration as handled (JS still filters the list)
  }

  // WebGL — setWebGLVendor(vendor: string), setWebGLRenderer(renderer: string)
  if (settings.graphics?.webgl !== 'off') {
    // Use profile GPU if available, otherwise generate from PRNG
    const vendors = [
      { v: 'Google Inc. (NVIDIA)', r: 'ANGLE (NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
      { v: 'Google Inc. (Apple)', r: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)' },
      { v: 'Google Inc. (Intel)', r: 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
    ];
    const gpu = vendors[prng.nextInt(0, vendors.length - 1)];
    const vendorOk = callCore('setWebGLVendor', gpu.v);
    const rendererOk = callCore('setWebGLRenderer', gpu.r);
    if (vendorOk && rendererOk) {
      handled.add('graphics.webgl');
    }
  }

  // WebRTC — setWebRTCIPv4(ip: string), setWebRTCIPv6(ip: string)
  if (settings.network?.webrtc !== 'off') {
    const a = prng.nextInt(1, 254);
    const b = prng.nextInt(1, 254);
    const ipv4 = `192.168.${a}.${b}`;
    const ipv6Seg = () => prng.nextInt(0, 65535).toString(16).padStart(4, '0');
    const ipv6 = `fd00:${ipv6Seg()}:${ipv6Seg()}::${ipv6Seg()}`;
    const v4ok = callCore('setWebRTCIPv4', ipv4);
    const v6ok = callCore('setWebRTCIPv6', ipv6);
    if (v4ok || v6ok) handled.add('network.webrtc');
  }

  // Timezone — setTimezone(tz: string)
  if (settings.timezone?.intl !== 'off') {
    const timezones = [
      'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
      'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Asia/Tokyo', 'Asia/Shanghai',
    ];
    const tz = timezones[prng.nextInt(0, timezones.length - 1)];
    if (callCore('setTimezone', tz)) {
      handled.add('timezone.intl');
      handled.add('timezone.date');
    }
  }

  // Speech — setSpeechVoices(voices: string)
  if (settings.speech?.synthesis !== 'off') {
    if (callCore('setSpeechVoices', 'Google US English,Google UK English Female,Microsoft David')) {
      handled.add('speech.synthesis');
    }
  }

  return handled;
}
