// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// @phoenix/secrets: shared code for Passwords and Authenticator (the apps
// that hold secrets). See docs/SECURITY-APPS.md for the threat model.

export { base32Decode, base32Encode } from "./base32";
export {
    hotp, totp, totpCounter, totpRemaining, truncate, importOtpKey, groupCode, parseOtpauth, buildOtpauth, parseSecret, validateOtp,
    OtpUriError, OTP_DEFAULTS, OTP_ALGORITHMS,
} from "./otp";
export type { OtpParams, OtpAlgorithm, OtpType } from "./otp";
export {
    randomBytes, toBase64, fromBase64, deriveKey, newKdf, newDataKey, wrapKey, unwrapKey, seal, unseal, sealJson, unsealJson,
    sealWithPassphrase, unsealWithPassphrase, isPassphraseFile, SealError, PBKDF2_ITERATIONS,
} from "./seal";
export type { KdfParams, Sealed, PassphraseFile } from "./seal";
export { SecretClipboard, secretClipboard, CLIPBOARD_CLEAR_SECONDS } from "./clipboard";
export { AutoLock, CARD_ACTIVATION_EVENT } from "./autolock";
export type { AutoLockOptions, LockReason } from "./autolock";
