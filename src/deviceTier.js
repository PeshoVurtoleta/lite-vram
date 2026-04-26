/**
 * Device Tier Detection — Hardware-aware VRAM budget heuristic.
 *
 * Probes RAM, GPU renderer string, core count, and platform
 * to classify the device into LOW / MID / HIGH tiers.
 *
 * ⚠️ BROWSER SUPPORT NOTES:
 * - `navigator.deviceMemory` is Chrome/Edge only (not Firefox, not Safari).
 *   Chrome additionally clamps the value at 8GB for fingerprinting protection,
 *   so an 8GB report can mean any actual RAM ≥ 8GB.
 * - iPadOS 13+ spoofs its User-Agent as "Macintosh" — this module uses
 *   touch + standalone heuristics to detect modern iPads.
 * - `WEBGL_debug_renderer_info` is deprecated in some contexts but still
 *   the most reliable GPU signal. Falls back gracefully if unavailable.
 *
 * ── v1.1.0 Fix ──────────────────────────────────────────
 * Mac-spoofed iPads (iPadOS 13+) carry no `CPU OS X_X like Mac OS X`
 * token, so iOS version detection returned 0 and the tier reason was
 * "iOS ?".  v1.1 falls back to the Safari `Version/X` token, which
 * Apple aligns with iOS major versions on iPad.
 */

export const DeviceTier = {
    LOW:  1,
    MID:  2,
    HIGH: 3
};

/** @type {Record<number, string>} */
const TIER_NAMES = {
    [DeviceTier.LOW]:  'LOW',
    [DeviceTier.MID]:  'MID',
    [DeviceTier.HIGH]: 'HIGH'
};

/**
 * @typedef {Object} TierResult
 * @property {number} tier
 * @property {string} tierName
 * @property {Object} signals
 */

/**
 * Detects the device's performance tier for VRAM budget selection.
 * @returns {TierResult}
 */
export function detectDeviceTier() {
    const ua = navigator.userAgent || '';

    // ── Platform Detection ──────────────────────────────
    const isIOSClassic = /iPad|iPhone|iPod/.test(ua);

    const isIPadOS13Plus = !isIOSClassic
        && /Macintosh/.test(ua)
        && navigator.maxTouchPoints > 1;

    const isIPadLegacy = !isIOSClassic
        && !isIPadOS13Plus
        && /CPU OS/.test(ua)
        && /like Mac OS X/.test(ua);

    const isIOS = isIOSClassic || isIPadOS13Plus || isIPadLegacy;
    const isIPad = /iPad/.test(ua) || isIPadOS13Plus || isIPadLegacy;
    const isMobile = isIOS || /Mobi|Android/.test(ua);

    // ── iOS Version Detection ───────────────────────────
    let iOSVersion = 0;
    if (isIOS) {
        const match = ua.match(/(?:CPU (?:iPhone )?OS |OS )(\d+)[_\d]* like Mac OS X/);
        if (match) iOSVersion = parseInt(match[1], 10);

        // v1.1 fix: Mac-spoofed iPads carry no iOS token. Fall back to the
        // Safari Version/X.X.X. Apple aligns Safari major version with iOS
        // major version on iPad (Safari 15 ↔ iPadOS 15, Safari 17 ↔ iPadOS 17).
        if (iOSVersion === 0 && isIPadOS13Plus) {
            const safariMatch = ua.match(/Version\/(\d+)/);
            if (safariMatch) iOSVersion = parseInt(safariMatch[1], 10);
        }
    }

    // ── RAM Detection ───────────────────────────────────
    const memoryReal = typeof navigator.deviceMemory === 'number';
    const memory = memoryReal
        ? navigator.deviceMemory
        : (isIOS ? 2 : 4);

    // ── CPU Detection ───────────────────────────────────
    const cores = navigator.hardwareConcurrency || (isMobile ? 4 : 4);

    // ── GPU Detection ───────────────────────────────────
    const gpu = probeGPU();
    const gpuIsLow = isLowEndGPU(gpu);

    // ── Tier Decision ───────────────────────────────────
    let tier;
    let reason;

    // Rule 1: iOS tier detection using OS version as a device-generation proxy.
    // Safari NEVER exposes navigator.deviceMemory, so RAM is always unknown.
    // iOS version is the best available signal because Apple drops old devices
    // from new iOS releases on a predictable schedule:
    //   iOS ≤ 15: min device iPhone 6s (2GB) — includes iPhone 7 (2GB), SE2 (3GB)
    //   iOS 16:   min device iPhone 8 (2-3GB) — but also includes iPhone 14 (6GB)
    //   iOS ≥ 17: min device iPhone XS (4GB) — all modern, 4-6GB
    if (isIOS && !memoryReal && iOSVersion > 0 && iOSVersion >= 17) {
        tier = DeviceTier.HIGH;
        reason = `iOS ${iOSVersion} device (min iPhone XS, 4GB+)`;
    }
    else if (isIOS && !memoryReal && iOSVersion >= 16) {
        tier = DeviceTier.MID;
        reason = `iOS ${iOSVersion} device (mixed 2-6GB, conservative MID)`;
    }
    else if (isIOS && !memoryReal) {
        tier = DeviceTier.LOW;
        reason = `iOS ${iOSVersion || '?'} device (likely ≤3GB RAM)`;
    }
    else if (isIOS && memoryReal && memory <= 3) {
        tier = DeviceTier.LOW;
        reason = `iOS device with confirmed ≤3GB RAM (${memory}GB)`;
    }
    // Rule 2: Budget Android with ≤2GB RAM
    else if (isMobile && !isIOS && memoryReal && memory <= 2) {
        tier = DeviceTier.LOW;
        reason = `Budget Android with ≤2GB RAM (${memory}GB)`;
    }
    // Rule 3: Mobile device with known low-end GPU
    else if (isMobile && gpuIsLow) {
        tier = DeviceTier.LOW;
        reason = `Low-end mobile GPU detected: ${gpu}`;
    }
    // Rule 4: Desktop with low-end GPU — demote to MID, not LOW.
    else if (!isMobile && gpuIsLow) {
        tier = DeviceTier.MID;
        reason = `Desktop with low-end integrated GPU: ${gpu}`;
    }
    // Rule 5: Any device with ≤4GB RAM
    else if (memory <= 4) {
        tier = DeviceTier.MID;
        reason = `${isMobile ? 'Mobile' : 'Desktop'} with ≤4GB RAM (${memory}GB${memoryReal ? '' : ' estimated'})`;
    }
    // Rule 6: Low core count on desktop WITH modest RAM
    else if (!isMobile && cores <= 2 && memory <= 8) {
        tier = DeviceTier.MID;
        reason = `Desktop with only ${cores} cores and ≤8GB RAM (${memory}GB)`;
    }
    else {
        tier = DeviceTier.HIGH;
        reason = `${isMobile ? 'Mobile' : 'Desktop'} with ${memory}GB RAM, ${cores} cores, GPU: ${gpu}`;
    }

    return {
        tier,
        tierName: TIER_NAMES[tier],
        signals: { isIOS, isIPad, isMobile, iOSVersion, memory, memoryReal, cores, gpu, gpuIsLow, reason }
    };
}

/**
 * Probes the GPU renderer string via WebGL.
 * @returns {string}
 */
function probeGPU() {
    try {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
        if (!gl) return 'no-webgl';

        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        let renderer = 'webgl-no-debug-info';

        if (ext) {
            renderer = (gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || 'unknown').trim();
        }

        const loseCtx = gl.getExtension('WEBGL_lose_context');
        if (loseCtx) loseCtx.loseContext();
        return renderer;
    } catch (e) {
        return 'unknown';
    }
}

/**
 * Pattern-matches known low-end GPU families.
 * @param {string} gpu
 * @returns {boolean}
 */
function isLowEndGPU(gpu) {
    if (!gpu || gpu === 'unknown' || gpu === 'no-webgl' || gpu === 'webgl-no-debug-info') return false;

    const lower = gpu.toLowerCase();

    if (/intel.*(hd\s*(graphics\s*)?(2000|3000|4000|4[0-6]00|5[0-3]00|5[1-3]\d|6[0-2]\d))/i.test(lower)) return true;
    if (/mali[\s-]*(t6|t7|g31|g51)/i.test(lower)) return true;
    if (/adreno.*([345][0-3]\d)/i.test(lower)) return true;
    if (/apple.*a[7-9]\b/i.test(lower)) return true;
    if (/powervr/i.test(lower)) return true;
    if (/swiftshader|llvmpipe/i.test(lower)) return true;

    return false;
}
