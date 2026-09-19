# Iqra Signature Salon: security review

Reviewed: 16 September 2026. Scope: the salon frontend, admin interface, shared REST API, Sites Worker/D1/R2 adapters, standalone Express/MongoDB adapter, upload storage, dependency lockfile and downloadable source archive.

This is a code review, dependency scan and automated regression assessment. It is not a third-party penetration-test certification, a guarantee against compromise, or an assessment of the hosting provider's infrastructure.

## Findings and changes

| Finding | Change | Verification |
| --- | --- | --- |
| Standalone request limits trusted a caller-supplied Cloudflare IP header. | The shared API receives the client address only from its runtime adapter. Express uses its socket address or explicitly trusted proxy addresses. | Repeated login attempts with changing forged forwarding headers are blocked. |
| Password changes removed only the first 2,000 listed sessions; racing old logins could remain valid. | Credentials have a random version checked on every authenticated request. Account updates use compare-and-swap; bulk session deletion has no listing cap. | More than 2,000 sessions, old cookies and a racing old-version session are invalidated. |
| Password hashing used 100,000 PBKDF2-SHA256 iterations. | New hashes use 600,000 iterations and random salts. Existing credentials upgrade on successful login. A standard portable implementation retains the full work factor where Workers caps WebCrypto iterations. | Native and portable implementations produce the same result; legacy login migration succeeds. |
| No second factor protected the app-owned admin login. | Optional TOTP authenticator enrollment with encrypted secrets, replay protection and eight hashed, one-use recovery codes. | Enrollment, concurrent token replay, recovery-code reuse, disabling MFA and session revocation are checked. Owner enrollment remains required. |
| Sessions lacked an inactivity deadline and HTTPS host-prefix protection. | Eight-hour absolute expiry, 30-minute inactivity expiry, HttpOnly/SameSite=Strict cookies, HTTPS Secure/__Host- cookies, logout revocation and session rotation. | Expiry, duplicate/forged cookies, logout and HTTPS attributes are checked. |
| File acceptance used a few signature bytes and trusted the requested panorama flag. | Inspect allowed signatures, actual type, extension, image dimensions, file size, font headers and panorama ratio on the server. Reject archives/documents/HTML/SVG before general file inspection. | Spoofed MIME/extensions, unsupported files, oversized/multiple files and non-panorama images are rejected. |
| Mentioning a private media path anywhere in published text made the file public. | Only exact media fields on eligible published records or explicit homepage/font selections grant access. | Text references stay private; publishing, byte ranges, HEAD, unpublishing and in-use deletion behave correctly. |
| The booking retry check compared only the phone number. | An idempotency fingerprint covers the submitted booking fields, including checks after a concurrent insert. | Changed retries are rejected; genuine retries retain one reference; public responses exclude client details. |
| Calendar validation accepted structurally valid but nonexistent dates. | Real calendar/date-window checks and typed schemas reject invalid dates, query objects and mass-assignment fields. | Invalid dates, NoSQL/SQL-shaped input and extra privileged fields are exercised. |
| Browser protections were incomplete. | Nonce-based hosted CSP; external-script-only Express CSP; no-sniff, referrer restrictions, permissions restrictions, framing rules, HTTPS HSTS and private response caching. Unused image proxies and framework write endpoints are disabled. | Express header and static-boundary tests; hosted artifact checks recorded below. |
| Default standalone service exposure was broad. | Bind to loopback by default; explicit proxy allowlists; HTTP timeouts/header limits; private file permissions; no symlink reads; restricted static directory. | Real Express HTTP tests, traversal attempts, source/config-file requests and symlink checks. |
| Dependencies included known vulnerabilities. | Patch React/RSC, Vite and affected transitive packages while retaining lockfile integrity and the release-age policy. | Before/after `pnpm audit` results are recorded below. |

## Dependency status

The initial audit reported **36 advisories: 20 high, 12 moderate and 4 low**. The final scan reports **2 high, 0 moderate, 0 low and 0 critical advisories**, both in `image-size`. The first remediation scan also reported two advisories in the newly selected file-detector version; that package was subsequently upgraded to `file-type@21.3.2`.

The `image-size@2.0.3` update is blocked by the existing seven-day minimum release age. Registry metadata says it was published **14 September 2026 at 15:57:47 UTC**; it becomes eligible **21 September 2026 after that time**. The policy was not relaxed and the blocked release was not installed.

`image-size@2.0.2` remains installed. Its two reported high-severity advisories concern ICNS, JXL and HEIF parsing. The application rejects those formats, restricts uploads to JPEG/PNG/WebP, and explicitly disables every other dimension parser. The framework's unused image-proxy endpoints are blocked before framework dispatch. Vinext's other use of this library reads trusted repository metadata at build time. These measures reduce exposure; they do not erase the dependency findings or replace installing a mature patched release.

After 21 September, update both the direct dependency and the override to a then-current patched mature `image-size` version, regenerate the lockfile, rerun security tests and both builds, and redeploy. Do not remove the upload allowlist or enable the image proxy to silence audit output.

References: [image-size ICNS advisory](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr), [image-size JXL/HEIF advisory](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq), [OWASP password storage guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html), [OWASP upload guidance](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html), [Next.js nonce/CSP documentation](https://nextjs.org/docs/app/guides/content-security-policy).

## Owner actions and limits

1. Sign in again after deployment, then open **Admin → Account → Two-step verification**. Enroll your own authenticator and save the recovery codes privately. The assistant cannot enroll a device on your behalf.
2. Keep a unique admin password and protect your ChatGPT account, domain registrar and hosting accounts with MFA. The Sites publication remains private to its owner; this review does not change the audience.
3. Preserve `AUTH_SECRET` with the private database/media backups. Changing it without a migration prevents decryption of existing authenticator secrets. Live secrets, sessions and customer data are excluded from the code ZIP.
4. For an independent MERN deployment, configure authenticated MongoDB access, TLS, a database-specific account and a network allowlist. No live MongoDB instance or credentials were available for an integration test in this workspace; the adapter was reviewed, while executed API/storage tests use SQLite/D1 semantics. MongoDB production configuration remains unverified.
5. Configure your provider's traffic controls, monitoring, alerts, backups and restore testing. Per-IP/account limits help with abuse but do not constitute distributed denial-of-service protection. No external CAPTCHA, antivirus scanner or automated incident alert service is connected.
6. File signature/dimension inspection does not prove that media is malware-free or strip private EXIF metadata. Only the authenticated owner can upload. Obtain client permission before publication and remove unneeded personal records.
7. No destructive tests were run against live salon data. Browser/WebGL/device compatibility, external infrastructure, OS security and a real MongoDB connection are outside the executed tests. Automated tests cannot prove the absence of all vulnerabilities.

## Validation record

Completed against the revised source on 16 September 2026:

| Check | Result |
| --- | --- |
| API and security regression suite | 14 passed; 0 failed; 0 skipped. Includes temporary persistent SQLite/D1 semantics and real Express HTTP requests. |
| TypeScript | Passed, with no errors. |
| Sites production build | Passed. Includes the custom Worker entrypoint, browser assets and the additive rate-limit expiry-index migration. |
| Standalone MERN frontend build | Passed. This compiles the React frontend; it is not a live MongoDB connection test. |
| Compiled Worker in isolated Miniflare/workerd | Passed: SQL migrations, D1/R2 upload and range reads, private/published media transitions, admin authentication, HTTPS cookies, full-cost password hashing, encrypted MFA enrollment, fresh page CSP nonces, attacker-supplied middleware/nonce headers and disabled framework endpoints. |
| Dependency scan | 2 high advisories remain, with the format and route mitigations described above. The audit command therefore still exits nonzero. |
| Secret and source boundaries | Live setup/encryption secrets are absent from tracked source and both builds. Express denies source/configuration files; the downloadable ZIP is generated only from committed source. |

The upload failure seen during the first compiled-runtime check was in the test transport: Node FormData crossed into Miniflare's separate fetch classes as plain text. The harness now encodes the actual multipart bytes before dispatch; the production upload handler then passed unchanged.

These are automated local/runtime checks. No external penetration test, real-browser end-to-end test, live MongoDB integration test or provider infrastructure assessment was performed. Re-run the checks after dependency, configuration or hosting changes.
